// Removing a published item — by its owner, or by an admin. Moderation IS
// deletion: published means public until someone removes it, so there is no
// visibility state machine to shepherd. Both checks happen here because the
// admin page is only a convenience — the API is the boundary.

import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase, db, schema } from "@/lib/db"
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
  if (!row || row.visibility !== "public") return NextResponse.json({ error: "not found" }, { status: 404 })
  // visibility is a gate, not payload — it never leaves the server.
  const item = { ...row, visibility: undefined }
  delete item.visibility
  return NextResponse.json({ item })
}

const MAX_NAME = 60

/**
 * Rename a published item. Safe because scene documents never reference community
 * content by name — built-ins travel by name, everything else by value — so a
 * rename is purely cosmetic to anyone already using it.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const { id } = await ctx.params
  const ok = await authorize(request, id)
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 })

  const { name } = ((await request.json().catch(() => ({}))) ?? {}) as { name?: unknown }
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 })
  }
  try {
    await db
      .update(schema.libraryItems)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(schema.libraryItems.id, id))
  } catch {
    // The unique (owner, kind, name) index — you already have one by that name.
    return NextResponse.json({ error: "name-taken" }, { status: 409 })
  }
  return NextResponse.json({ id, name: name.trim() })
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
