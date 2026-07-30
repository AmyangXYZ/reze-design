// Publishing: the only route into the library.
//
// Built-ins ship in the repo and never come from here. A row appears when
// someone publishes, which is also the moment content acquires an owner, a
// stable id and a name under which others will see it.

import { NextResponse } from "next/server"
import { asc, eq, inArray, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"
import type { LibraryKind } from "@/lib/library"

const KINDS: LibraryKind[] = ["grade", "graph", "effect", "scene"]
const MAX_NAME = 60
const MAX_DESCRIPTION = 500
const MAX_TAGS = 8
const MAX_CREDITS = 4000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Base58: no 0/O/I/l ambiguity — these ids live in shareable URLs.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
function shortId(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes, (b) => BASE58[b % 58]).join("")
}

/**
 * The community library: every public row, all kinds — the client filters by
 * kind. One request feeds the three libraries, the quick-picks, and name
 * resolution, mirroring how /stats already works. `mine` marks the caller's own
 * rows so the "Yours" facet can include published work next to local drafts.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  const rows = await db
    .select({
      id: schema.libraryItems.id,
      kind: schema.libraryItems.kind,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      description: schema.libraryItems.description,
      tags: schema.libraryItems.tags,
      version: schema.libraryItems.version,
      payload: schema.libraryItems.payload,
      ownerId: schema.libraryItems.ownerId,
    })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.visibility, "public"))
    // Oldest first — new arrivals land at the end, like everywhere else.
    .orderBy(asc(schema.libraryItems.createdAt))
  const items = rows.map(({ ownerId, ...r }) => ({
    ...r,
    owner: "user" as const,
    mine: !!session && ownerId === session.user.id,
  }))
  return NextResponse.json({ items })
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "sign in to publish" }, { status: 401 })

  // Every account is given a handle at sign-up, so this is unreachable — but the
  // fallbacks are the user's real name or their email, and publishing either
  // would be worse than refusing.
  if (session.user.banned) return NextResponse.json({ error: "account suspended" }, { status: 403 })

  const author = session.user.username
  if (!author) return NextResponse.json({ error: "set a handle before publishing" }, { status: 409 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  const { id, kind, name, description, tags, payload, credits, changelog, bundleKey, bundleBytes, forkedFromId, uses } =
    (body ?? {}) as Record<string, unknown>
  if (typeof kind !== "string" || !KINDS.includes(kind as LibraryKind)) {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 })
  }
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }
  if (payload == null || typeof payload !== "object") {
    return NextResponse.json({ error: "payload is required" }, { status: 400 })
  }
  // A scene redistributes other people's models, motions and music. The 借物表 is
  // the community's own norm for that, so it is required rather than encouraged.
  if (kind === "scene" && (typeof credits !== "string" || !credits.trim())) {
    return NextResponse.json({ error: "credits are required" }, { status: 400 })
  }

  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")
  const common = {
    name: name.trim(),
    author,
    description: text(description, MAX_DESCRIPTION),
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string").slice(0, MAX_TAGS) : [],
    payload: payload as never,
    ownerId: session.user.id,
  }

  // ── Scenes ───────────────────────────────────────────────────────────────────
  // Short id, because the id IS the share URL. No version rows: nothing imports a
  // scene, so there is nothing for anyone to pin.
  if (kind === "scene") {
    // Pins the client says this document makes. Filtered against real version rows
    // below rather than trusted — a bad edge would inflate someone's usage count.
    const pins = Array.isArray(uses)
      ? uses.filter(
          (u): u is { id: string; version: number } =>
            typeof u === "object" && u !== null && typeof (u as { id: unknown }).id === "string" &&
            Number.isInteger((u as { version: unknown }).version),
        )
      : []

    const [scene] = await db
      .insert(schema.libraryItems)
      .values({
        ...common,
        id: shortId(),
        kind: "scene",
        credits: text(credits, MAX_CREDITS),
        bundleKey: typeof bundleKey === "string" ? bundleKey : null,
        bundleBytes: typeof bundleBytes === "number" ? bundleBytes : 0,
        // Recorded automatically when the session began from someone else's scene
        // — there is no fork button, publishing IS the fork.
        forkedFromId: typeof forkedFromId === "string" ? forkedFromId : null,
        // Published means visible. Private is the column default so an accidental
        // insert stays invisible, but this route is an explicit act.
        visibility: "public",
      })
      .returning()

    if (pins.length > 0) {
      const real = await db
        .select({ itemId: schema.libraryItemVersions.itemId, version: schema.libraryItemVersions.version })
        .from(schema.libraryItemVersions)
        .where(
          inArray(
            schema.libraryItemVersions.itemId,
            pins.map((p) => p.id),
          ),
        )
      const valid = pins.filter((p) => real.some((r) => r.itemId === p.id && r.version === p.version))
      if (valid.length > 0) {
        await db.transaction(async (tx) => {
          await tx
            .insert(schema.sceneUses)
            .values(valid.map((p) => ({ sceneId: scene.id, itemId: p.id, itemVersion: p.version })))
          // Denormalised so a library card needs no join.
          await tx
            .update(schema.libraryItems)
            .set({ usageCount: sql`${schema.libraryItems.usageCount} + 1` })
            .where(
              inArray(
                schema.libraryItems.id,
                valid.map((p) => p.id),
              ),
            )
        })
      }
    }
    return NextResponse.json({ item: scene }, { status: 201 })
  }

  // ── Presets ──────────────────────────────────────────────────────────────────
  // The client sends the draft's uuid, so a preset is the SAME entity before and
  // after it goes public. Publishing over one you already own writes the next
  // immutable version rather than a second item.
  const itemId = typeof id === "string" && UUID.test(id) ? id : crypto.randomUUID()
  const [existing] = await db
    .select({ ownerId: schema.libraryItems.ownerId, version: schema.libraryItems.version })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.id, itemId))
    .limit(1)
  if (existing && existing.ownerId !== session.user.id) {
    return NextResponse.json({ error: "not yours" }, { status: 403 })
  }
  const version = existing ? existing.version + 1 : 1

  let row
  try {
    row = await db.transaction(async (tx) => {
      const [item] = existing
        ? await tx
            .update(schema.libraryItems)
            .set({ ...common, version, deletedAt: null, updatedAt: new Date() })
            .where(eq(schema.libraryItems.id, itemId))
            .returning()
        : await tx
            .insert(schema.libraryItems)
            .values({
              ...common,
              id: itemId,
              kind: kind as LibraryKind,
              version,
              visibility: "public",
              // Derived from someone else's preset — their item is untouched, this
              // is yours, and the trail back to them is kept.
              forkedFromId: typeof forkedFromId === "string" ? forkedFromId : null,
            })
            .returning()
      // Immutable: written once, never updated. This row is what a scene pins.
      await tx.insert(schema.libraryItemVersions).values({
        itemId,
        version,
        payload: payload as never,
        changelog: text(changelog, MAX_DESCRIPTION) || null,
      })
      return item
    })
  } catch {
    // The unique (owner, kind, name) index — you already have one by that name.
    return NextResponse.json({ error: "name-taken" }, { status: 409 })
  }

  return NextResponse.json({ item: row }, { status: 201 })
}
