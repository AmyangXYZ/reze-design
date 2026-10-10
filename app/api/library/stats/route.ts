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
import { unstable_cache } from "next/cache"
import { and, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"
import { LIBRARY_TAG } from "@/lib/public-pages"
import { isDefaultLook, trendScore } from "@/lib/trend"

export type ItemStats = { likeCount: number; liked: boolean; scenes: number; exports: number; trend: number }

export async function GET(request: Request) {
  // No database configured: an honest empty answer, not a 500 the client has to
  // interpret. See lib/db — running without one is supported.
  if (!hasDatabase) return NextResponse.json({ stats: {}, signedIn: false })

  // The counts are everyone's and cached; only which ones YOU liked is read live,
  // and only when someone is signed in.
  const session = await auth.api.getSession({ headers: request.headers })
  const [shared, mine] = await Promise.all([
    sharedStats(),
    session
      ? db.select({ itemId: schema.likes.itemId }).from(schema.likes).where(eq(schema.likes.userId, session.user.id))
      : Promise.resolve([] as { itemId: string }[]),
  ])

  const liked = new Set(mine.map((m) => m.itemId))
  const stats: Record<string, ItemStats> = {}
  for (const [id, s] of Object.entries(shared)) stats[id] = { ...s, liked: liked.has(id) }
  return NextResponse.json({ stats, signedIn: !!session })
}

/** Every item's counts, cached until a write marks the library stale
 *  (lib/public-pages). */
const sharedStats = unstable_cache(
  async () => {
    // The scene side of scene_uses, so one table can be joined to itself.
    const scenes = alias(schema.libraryItems, "scenes")
    const [items, usage, likes, picks] = await Promise.all([
      db
        .select({
          id: schema.libraryItems.id,
          kind: schema.libraryItems.kind,
          name: schema.libraryItems.name,
          tags: schema.libraryItems.tags,
          createdAt: schema.libraryItems.createdAt,
          likeCount: schema.libraryItems.likeCount,
          // Counted, not joined: export_stats has no scene id to group by — see the
          // table. The counter on the item IS the aggregate, which is also what
          // lets the raw rows expire without taking the number with them.
          exportCount: schema.libraryItems.exportCount,
        })
        .from(schema.libraryItems),
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
      // The events lib/trend.ts sums: every like, and every pick — someone
      // else publishing a scene that wears the item, once per person, at their
      // latest such scene. Your own scenes wearing your own look are no pick.
      db.select({ itemId: schema.likes.itemId, at: schema.likes.createdAt }).from(schema.likes),
      db
        .select({ itemId: schema.sceneUses.itemId, at: sql<string>`max(${scenes.createdAt})` })
        .from(schema.sceneUses)
        .innerJoin(scenes, eq(scenes.id, schema.sceneUses.sceneId))
        .innerJoin(schema.libraryItems, eq(schema.libraryItems.id, schema.sceneUses.itemId))
        .where(
          and(
            eq(scenes.visibility, "public"),
            isNull(scenes.deletedAt),
            sql`${scenes.ownerId} is distinct from ${schema.libraryItems.ownerId}`,
          ),
        )
        .groupBy(schema.sceneUses.itemId, scenes.ownerId),
    ])
    const scenesUsing = new Map(usage.map((u) => [u.itemId, u.n]))
    const events = new Map<string, number[]>()
    const push = (id: string, at: Date | string) => events.set(id, [...(events.get(id) ?? []), new Date(at).getTime()])
    for (const l of likes) push(l.itemId, l.at)
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const p of picks) {
      const i = byId.get(p.itemId)
      if (i && !isDefaultLook(i.kind, i.name, i.tags)) push(p.itemId, p.at)
    }
    const out: Record<string, Omit<ItemStats, "liked">> = {}
    for (const i of items)
      out[i.id] = {
        likeCount: i.likeCount,
        scenes: scenesUsing.get(i.id) ?? 0,
        exports: i.exportCount,
        trend: trendScore([i.createdAt.getTime(), ...(events.get(i.id) ?? [])]),
      }
    return out
  },
  ["library-stats"],
  { tags: [LIBRARY_TAG] },
)

export const revalidate = 0
