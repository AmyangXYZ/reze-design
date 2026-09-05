// Resolving a scene's pins: `{ id }` → the item's payload as it stands now.
//
// One request for every pin in a document rather than one per pin — a scene with
// six styled groups shouldn't cost six round trips. Built-ins never arrive here
// at all; they ship in the app bundle and resolve with no network, which is what
// keeps a clone with no database working.
//
// Public: a published item is content someone chose to publish, and the scene
// showing it is already public. No session needed, and none is read.

import { NextResponse } from "next/server"
import { inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"

const MAX_REFS = 64

export async function POST(request: Request) {
  // No database configured: an honest empty answer, not a 500 the client has to
  // interpret. See lib/db — running without one is supported.
  // Built-in pins resolve from the app bundle before this route is ever called.
  if (!hasDatabase) return NextResponse.json({ payloads: {} })

  const { refs } = ((await request.json().catch(() => ({}))) ?? {}) as { refs?: unknown }
  if (!Array.isArray(refs)) return NextResponse.json({ error: "refs required" }, { status: 400 })

  // A document written before pins dropped their version still sends one. It is
  // read past rather than rejected: the id is the whole pin now, and the version
  // it names is a payload nothing can return any more.
  const ids = [
    ...new Set(
      refs
        .filter(
          (r): r is { id: string } =>
            typeof r === "object" && r !== null && typeof (r as { id: unknown }).id === "string",
        )
        .map((r) => r.id),
    ),
  ].slice(0, MAX_REFS)
  if (ids.length === 0) return NextResponse.json({ payloads: {} })

  // Soft-deleted items are deliberately included. An item leaves the library
  // when its author retires it; a scene already using it keeps rendering, which
  // is the reason deletion is soft in the first place.
  //
  // PRIVATE does not. Private means never seen, and that only holds if this
  // route refuses to hand the payload to anyone but its owner — a pin is a bare
  // id, so without the check any id is a read. A private item simply has no key
  // in the answer, which is what a deleted one looks like.
  const rows = await db
    .select({
      id: schema.libraryItems.id,
      payload: schema.libraryItems.payload,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      visibility: schema.libraryItems.visibility,
      ownerId: schema.libraryItems.ownerId,
    })
    .from(schema.libraryItems)
    .where(inArray(schema.libraryItems.id, ids))

  // Read only when something private is actually in the answer — the common case
  // is a scene wearing public presets, and that must not wait on a session.
  const viewer = rows.some((r) => r.visibility === "private")
    ? await auth.api.getSession({ headers: request.headers })
    : null

  const payloads: Record<string, { payload: unknown; name: string; author: string }> = {}
  for (const r of rows) {
    if (r.visibility === "private" && (!viewer || r.ownerId !== viewer.user.id)) continue
    payloads[r.id] = { payload: r.payload, name: r.name, author: r.author }
  }
  return NextResponse.json({ payloads })
}

export const revalidate = 0
