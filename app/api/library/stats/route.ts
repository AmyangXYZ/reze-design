// Per-item social stats for the libraries: like count, whether you liked it, and
// how many published scenes use it.
//
// One request for the whole library rather than one per card — a grid of twenty
// items should not make twenty round trips, especially to Singapore.
//
// Built-ins are included because they're mirrored into library_items by the seed.
// "Used by N scenes" is the most interesting number in the product: it says which
// curated looks people actually reach for.

import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"

export type ItemStats = { likeCount: number; liked: boolean; scenes: number }

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })

  const [items, mine, sceneRefs] = await Promise.all([
    db
      .select({ id: schema.libraryItems.id, likeCount: schema.libraryItems.likeCount })
      .from(schema.libraryItems),
    session
      ? db.select({ itemId: schema.likes.itemId }).from(schema.likes).where(eq(schema.likes.userId, session.user.id))
      : Promise.resolve([] as { itemId: string }[]),
    // Read INTO the payload rather than maintaining a join table: a scene records
    // which grade and effect it uses, so this cannot drift from what it describes.
    db
      .select({
        grade: sql<string | null>`${schema.libraryItems.payload}->'doc'->'settings'->'grade'->>'preset'`,
        effect: sql<string | null>`coalesce(
          ${schema.libraryItems.payload}->'doc'->>'backgroundEffect',
          ${schema.libraryItems.payload}->'doc'->'backgroundEffect'->>'id'
        )`,
      })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.kind, "scene")),
  ])

  const liked = new Set(mine.map((m) => m.itemId))
  const usage = new Map<string, number>()
  for (const r of sceneRefs) {
    for (const ref of [r.grade, r.effect]) {
      if (ref) usage.set(ref, (usage.get(ref) ?? 0) + 1)
    }
  }

  const stats: Record<string, ItemStats> = {}
  for (const i of items) {
    stats[i.id] = { likeCount: i.likeCount, liked: liked.has(i.id), scenes: usage.get(i.id) ?? 0 }
  }
  return NextResponse.json({ stats, signedIn: !!session })
}

export const revalidate = 0
