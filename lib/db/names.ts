import "server-only"

// One name per kind, for everybody — the server's half of lib/names.ts.
//
// Not per author, which is what the (owner, kind, name) index alone allowed. The
// editor resolves a look BY NAME: the quick switch matches a group to a library
// row that way, and applying one looks it up that way. So a second "Neon Hair"
// does not read as two artists' takes on one idea — it makes one of them
// unreachable, and which one you get is list order.
//
// Scenes are exempt. They are addressed by short id in a URL, nothing resolves
// one by name, and two people naming a scene "Rain" is not a conflict.

import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { nameKey, type LibraryKind } from "@/lib/library"

/**
 * The published name `wanted` would collide with, or null.
 *
 * Compared with case and spacing folded — nameKey's rule, in SQL — because a
 * library where "neon hair" and "Neon  Hair" are different things is a library
 * nobody can search.
 *
 * `exceptId` is the row being written: republishing your own preset keeps its
 * name, which would otherwise collide with itself.
 */
export async function nameClash(kind: LibraryKind, wanted: string, exceptId: string): Promise<string | null> {
  if (kind === "scene") return null
  const [row] = await db
    .select({ name: schema.libraryItems.name })
    .from(schema.libraryItems)
    .where(
      and(
        eq(schema.libraryItems.kind, kind),
        isNull(schema.libraryItems.deletedAt),
        ne(schema.libraryItems.id, exceptId),
        // nameKey's rule in SQL. The backslash is doubled because this is a
        // template literal: '\s' in one collapses to a plain 's', which would
        // quietly compare against the letter instead of whitespace.
        sql`lower(btrim(regexp_replace(${schema.libraryItems.name}, '\\s+', ' ', 'g'))) = ${nameKey(wanted)}`,
      ),
    )
    .limit(1)
  return row?.name ?? null
}
