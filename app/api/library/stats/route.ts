// Per-item social stats for the libraries: like count and how many
// published scenes use it. Whether YOU liked it is /api/library/mine.
//
// One request for the whole library rather than one per card — a grid of twenty
// items should not make twenty round trips, especially to Singapore.
//
// Keyed by the item's permanent uuid. It used to be `kind:name`, from when
// builtins were assumed to carry no stored id. Every item has one, so the name
// key bought nothing and cost correctness twice. Names are unique per AUTHOR now, so two people
// publishing a "Neon" grade collapsed into one entry: one of them showed the
// other's likes, and liking it liked the other's row. And a scene records what it
// uses by id, so a name-keyed usage count could not be joined to anyway.

import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"
import { and, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { hasDatabase, db, schema } from "@/lib/db"
import { LIBRARY_TAG } from "@/lib/public-pages"
import { publicJson } from "@/lib/cdn"
import { TREND_HALF_LIFE, isDefaultLook, trendScore } from "@/lib/trend"

/** Everyone's counts for an item. Whether you liked it is /api/library/mine. */
export type SharedStats = { likeCount: number; scenes: number; trend: number }

export async function GET() {
  // No database configured: an honest empty answer, not a 500 the client has to
  // interpret. See lib/db — running without one is supported.
  if (!hasDatabase) return NextResponse.json({ stats: {} })
  // Everyone's counts, the same for everyone, so cached at the CDN (lib/cdn).
  // Which ones YOU liked is personal and comes from /api/library/mine.
  return publicJson({ stats: await sharedStats() })
}

/** Every item's counts, cached until a write marks the library stale
 *  (lib/public-pages). */
const sharedStats = unstable_cache(
  async () => {
    // The scene side of scene_uses, so one table can be joined to itself.
    const scenes = alias(schema.libraryItems, "scenes")
    const [items, usage, likes, picks, sceneLikes] = await Promise.all([
      db
        .select({
          id: schema.libraryItems.id,
          kind: schema.libraryItems.kind,
          name: schema.libraryItems.name,
          tags: schema.libraryItems.tags,
          createdAt: schema.libraryItems.createdAt,
          likeCount: schema.libraryItems.likeCount,
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
      // A like on someone else's public scene that wears it: attention the look
      // earned second-hand, so HALF an event (see below). Only likes, which are
      // already public; nothing about who opened or exported what.
      db
        .select({ itemId: schema.sceneUses.itemId, at: schema.likes.createdAt })
        .from(schema.likes)
        .innerJoin(schema.sceneUses, eq(schema.sceneUses.sceneId, schema.likes.itemId))
        .innerJoin(scenes, eq(scenes.id, schema.sceneUses.sceneId))
        .innerJoin(schema.libraryItems, eq(schema.libraryItems.id, schema.sceneUses.itemId))
        .where(
          and(
            eq(scenes.visibility, "public"),
            isNull(scenes.deletedAt),
            sql`${scenes.ownerId} is distinct from ${schema.libraryItems.ownerId}`,
            // Nor the look's own maker liking a scene that wears it.
            sql`${schema.likes.userId} is distinct from ${schema.libraryItems.ownerId}`,
          ),
        ),
    ])
    const scenesUsing = new Map(usage.map((u) => [u.itemId, u.n]))
    const events = new Map<string, number[]>()
    const push = (id: string, at: Date | string) => {
      const list = events.get(id)
      if (list) list.push(new Date(at).getTime())
      else events.set(id, [new Date(at).getTime()])
    }
    for (const l of likes) push(l.itemId, l.at)
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const p of picks) {
      const i = byId.get(p.itemId)
      if (i && !isDefaultLook(i.kind, i.name, i.tags)) push(p.itemId, p.at)
    }
    // Half an event is a whole one a half-life earlier: the weights halve with
    // time, so moving one back by TREND_HALF_LIFE halves it exactly.
    for (const l of sceneLikes) {
      const i = byId.get(l.itemId)
      if (i && !isDefaultLook(i.kind, i.name, i.tags)) push(l.itemId, new Date(new Date(l.at).getTime() - TREND_HALF_LIFE))
    }
    const out: Record<string, SharedStats> = {}
    for (const i of items)
      out[i.id] = {
        likeCount: i.likeCount,
        scenes: scenesUsing.get(i.id) ?? 0,
        trend: trendScore([i.createdAt.getTime(), ...(events.get(i.id) ?? [])]),
      }
    return out
  },
  ["library-stats"],
  { tags: [LIBRARY_TAG] },
)

export const revalidate = 0
