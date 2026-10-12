import "server-only"
import { and, desc, eq, ne } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

/** Preset rows (scenes have the gallery) matching `where`, newest first. Shared
 *  by the public list (/api/library) and your own (/api/library/mine). */
export async function presetRows(where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      id: schema.libraryItems.id,
      kind: schema.libraryItems.kind,
      name: schema.libraryItems.name,
      author: schema.libraryItems.author,
      description: schema.libraryItems.description,
      tags: schema.libraryItems.tags,
      payload: schema.libraryItems.payload,
      createdAt: schema.libraryItems.createdAt,
      visibility: schema.libraryItems.visibility,
      // The author's avatar, so a library can show WHO made something rather
      // than a string. Joined here because `author` is denormalised onto the row
      // and an image is the one thing about a person that is not.
      authorImage: user.image,
      // Beside it, the check for a maker we vouch for — for the same reason.
      authorVerified: user.verified,
    })
    .from(schema.libraryItems)
    .leftJoin(user, eq(schema.libraryItems.ownerId, user.id))
    .where(and(ne(schema.libraryItems.kind, "scene"), where))
    .orderBy(desc(schema.libraryItems.createdAt))
  return rows.map(({ createdAt, ...r }) => ({ ...r, createdAt: createdAt.toISOString() }))
}
