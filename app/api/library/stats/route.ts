// Per-item social stats for the libraries: like count, whether you liked it, and
// how many published scenes use it.
//
// One request for the whole library rather than one per card — a grid of twenty
// items should not make twenty round trips, especially to Singapore.
//
// Keyed by the item's permanent uuid. It used to be `kind:name`, from when
// builtins were assumed to carry no stored id — they do, authored in
// content/*.json and seeded under that same uuid, so the name key bought nothing
// and cost correctness twice. Names are unique per AUTHOR now, so two people
// publishing a "Neon" grade collapsed into one entry: one of them showed the
// other's likes, and liking it liked the other's row. And a scene records what it
// uses by id, so a name-keyed usage count could not be joined to anyway.

import { NextResponse } from "next/server"
import { and, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"

export type ItemStats = { likeCount: number; liked: boolean; scenes: number }

export async function GET(request: Request) {
  // No database configured: an honest empty answer, not a 500 the client has to
  // interpret. See lib/db — running without one is supported.
  if (!hasDatabase) return NextResponse.json({ stats: {}, signedIn: false })

  const session = await auth.api.getSession({ headers: request.headers })

  // The scene side of scene_uses, so one table can be joined to itself.
  const scenes = alias(schema.libraryItems, "scenes")

  const [items, mine, usage] = await Promise.all([
    db
      .select({
        id: schema.libraryItems.id,
        likeCount: schema.libraryItems.likeCount,
      })
      .from(schema.libraryItems),
    session
      ? db.select({ itemId: schema.likes.itemId }).from(schema.likes).where(eq(schema.likes.userId, session.user.id))
      : Promise.resolve([] as { itemId: string }[]),
    // scene_uses, extracted from each document at publish, rather than a scan
    // through the scene's JSON. The scan predated the table and had gone stale in
    // three ways: it read `settings.grade.preset` and `settings.background.effect`
    // as NAMES, when both are `{ id }` pins now (see sceneRefs in
    // lib/scene.ts); it counted no shader graphs at all, so every graph in the
    // library read as used by nobody; and it matched on a name that is no longer
    // unique. `scene_uses_item_idx` exists for exactly this query.
    db
      .select({ itemId: schema.sceneUses.itemId, n: sql<number>`count(*)::int` })
      .from(schema.sceneUses)
      .innerJoin(scenes, eq(scenes.id, schema.sceneUses.sceneId))
      // Only scenes someone can actually go and look at. usage_count on the item
      // is incremented at publish and never decremented, so counting here is what
      // keeps "used in N scenes" true after a scene is taken down.
      .where(and(eq(scenes.visibility, "public"), isNull(scenes.deletedAt)))
      .groupBy(schema.sceneUses.itemId),
  ])

  const liked = new Set(mine.map((m) => m.itemId))
  const scenesUsing = new Map(usage.map((u) => [u.itemId, u.n]))

  const stats: Record<string, ItemStats> = {}
  for (const i of items) {
    stats[i.id] = { likeCount: i.likeCount, liked: liked.has(i.id), scenes: scenesUsing.get(i.id) ?? 0 }
  }
  return NextResponse.json({ stats, signedIn: !!session })
}

export const revalidate = 0
