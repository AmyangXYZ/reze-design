// Resolving a scene's pins: `{ id, version }` → the exact immutable payload.
//
// One request for every pin in a document rather than one per pin — a scene with
// six styled groups shouldn't cost six round trips. Built-ins never arrive here
// at all; they ship in the app bundle and resolve with no network, which is what
// keeps a clone with no database working.
//
// Public: a pinned version is content someone chose to publish, and the scene
// showing it is already public. No session needed, and none is read.

import { NextResponse } from "next/server"
import { and, eq, inArray, or } from "drizzle-orm"
import { db, schema } from "@/lib/db"

const MAX_REFS = 64

export async function POST(request: Request) {
  const { refs } = ((await request.json().catch(() => ({}))) ?? {}) as { refs?: unknown }
  if (!Array.isArray(refs)) return NextResponse.json({ error: "refs required" }, { status: 400 })

  const wanted = refs
    .filter(
      (r): r is { id: string; version: number } =>
        typeof r === "object" && r !== null && typeof (r as { id: unknown }).id === "string" &&
        Number.isInteger((r as { version: unknown }).version),
    )
    .slice(0, MAX_REFS)
  if (wanted.length === 0) return NextResponse.json({ payloads: {} })

  // One statement, one OR per pin: a version row is immutable, so this is the
  // whole answer — no need to consult the item's current state.
  const rows = await db
    .select({
      itemId: schema.libraryItemVersions.itemId,
      version: schema.libraryItemVersions.version,
      payload: schema.libraryItemVersions.payload,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
    })
    .from(schema.libraryItemVersions)
    .innerJoin(schema.libraryItems, eq(schema.libraryItems.id, schema.libraryItemVersions.itemId))
    .where(
      and(
        inArray(
          schema.libraryItemVersions.itemId,
          wanted.map((r) => r.id),
        ),
        or(...wanted.map((r) => and(eq(schema.libraryItemVersions.itemId, r.id), eq(schema.libraryItemVersions.version, r.version)))),
      ),
    )

  // Keyed "id@version" — a document can legitimately pin two versions of one item
  // (two groups, one retuned since), so the id alone is not a key.
  const payloads: Record<string, { payload: unknown; name: string; author: string }> = {}
  for (const r of rows) payloads[`${r.itemId}@${r.version}`] = { payload: r.payload, name: r.name, author: r.author }
  return NextResponse.json({ payloads })
}

export const revalidate = 0
