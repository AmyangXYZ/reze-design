// Removing a published item — by its owner, or by an admin. Moderation IS
// deletion: published means public until someone removes it, so there is no
// visibility state machine to shepherd. Both checks happen here because the
// admin page is only a convenience — the API is the boundary.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase, db, schema } from "@/lib/db"
import { nameClash } from "@/lib/db/names"
import { normalizeName, withGraphName } from "@/lib/library"
import type { Visibility } from "@/lib/db/schema"

const VISIBILITIES: Visibility[] = ["public", "private"]
/** The item id if this request may act on it, otherwise null. */
async function authorize(request: Request, id: string) {
  if (await requireAdmin(request.headers)) return { id, admin: true as const }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const [row] = await db
    .select({ ownerId: schema.libraryItems.ownerId })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  if (!row || row.ownerId !== session.user.id) return null
  return { id, admin: false as const }
}

/** A single PUBLIC item — how the viewer page resolves a share link. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const { id } = await ctx.params
  const [row] = await db
    .select({
      id: schema.libraryItems.id,
      kind: schema.libraryItems.kind,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      description: schema.libraryItems.description,
      tags: schema.libraryItems.tags,
      payload: schema.libraryItems.payload,
      likeCount: schema.libraryItems.likeCount,
      createdAt: schema.libraryItems.createdAt,
      visibility: schema.libraryItems.visibility,
    })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })
  // Private is a 404 to everyone but its owner: a 403 would confirm it exists.
  if (row.visibility === "private") {
    const session = await auth.api.getSession({ headers: _request.headers })
    const [owner] = await db
      .select({ ownerId: schema.libraryItems.ownerId })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.id, id))
      .limit(1)
    // 404, never 403: a stranger learns nothing about what exists.
    if (!session || owner?.ownerId !== session.user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 })
    }
  }
  // visibility is a gate, not payload — it never leaves the server.
  const item = { ...row, visibility: undefined }
  delete item.visibility
  return NextResponse.json({ item })
}

const MAX_NAME = 60

/**
 * Rename a published item. Safe for anyone already USING it, because scene
 * documents never reference community content by name — built-ins travel by
 * name, everything else by value.
 *
 * Not free of consequence in the library, though: the editor picks a look by
 * name, so the new one has to be as unique as the old — one name per kind, for
 * everybody, matched with case and spacing folded (see the publish route).
 *
 * A graph's payload carries the same name, and it moves with the row: leaving it
 * on the old one is how the two came to disagree in the first place.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const { id } = await ctx.params
  const ok = await authorize(request, id)
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 })

  const { name, visibility } = ((await request.json().catch(() => ({}))) ?? {}) as {
    name?: unknown
    visibility?: unknown
  }
  const [row] = await db
    .select({
      kind: schema.libraryItems.kind,
      payload: schema.libraryItems.payload,
      name: schema.libraryItems.name,
      visibility: schema.libraryItems.visibility,
    })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, id))
    .limit(1)
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })

  // ── Visibility ─────────────────────────────────────────────────────────────
  // One rule: nothing ever returns to private. Once an item is public, other
  // people's scenes can pin it, and taking it back would break their work.
  // Deleting is the way out, and it is deliberate.
  const wantVisibility =
    typeof visibility === "string" && VISIBILITIES.includes(visibility as Visibility)
      ? (visibility as Visibility)
      : null
  if (visibility !== undefined && !wantVisibility) {
    return NextResponse.json({ error: "invalid visibility" }, { status: 400 })
  }
  if (wantVisibility === "private" && row.visibility !== "private") {
    return NextResponse.json({ error: "cannot-unpublish" }, { status: 409 })
  }

  const renaming = name !== undefined
  if (renaming && (typeof name !== "string" || !name.trim() || name.length > MAX_NAME)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 })
  }
  const wanted = renaming ? normalizeName(name as string) : row.name
  // A private item reserves no name, so the check runs whenever it is or becomes
  // reachable — which is also the moment a clash would actually matter.
  if ((wantVisibility ?? row.visibility) !== "private") {
    const clash = await nameClash(row.kind, wanted, id)
    if (clash) return NextResponse.json({ error: "name-taken", taken: clash }, { status: 409 })
  }
  try {
    await db
      .update(schema.libraryItems)
      .set({
        ...(renaming
          ? {
              name: wanted,
              ...(row.kind === "graph" ? { payload: withGraphName(row.payload, wanted) as never } : {}),
            }
          : {}),
        ...(wantVisibility ? { visibility: wantVisibility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.libraryItems.id, id))
  } catch {
    // The unique (owner, kind, name) index — the database's own last word.
    return NextResponse.json({ error: "name-taken" }, { status: 409 })
  }
  return NextResponse.json({ id, name: wanted, visibility: wantVisibility ?? row.visibility })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const { id } = await ctx.params
  const ok = await authorize(request, id)
  // 404 rather than 403: a stranger probing ids learns nothing about what exists.
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 })
  await db.delete(schema.libraryItems).where(eq(schema.libraryItems.id, id))
  return NextResponse.json({ deleted: id })
}
