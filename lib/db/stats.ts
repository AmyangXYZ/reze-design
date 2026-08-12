import "server-only"

// Aggregates for the admin page.
//
// Usage counts read INTO the payload: a published scene stores which grade and
// which effect it uses, so "how many scenes use this preset" is a jsonb query
// rather than a join table we would have to keep in step. Slower, but it cannot
// drift from the thing it describes.

import { and, eq, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { libraryItems, sceneUses } from "@/lib/db/schema"

export type SiteStats = {
  users: number
  bannedUsers: number
  publicItems: number
  byKind: { kind: string; count: number }[]
}

export async function siteStats(): Promise<SiteStats> {
  const [[users], [banned], [pub], byKind] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(user),
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(eq(user.banned, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(libraryItems).where(eq(libraryItems.visibility, "public")),
    db
      .select({ kind: libraryItems.kind, count: sql<number>`count(*)::int` })
      .from(libraryItems)
      .groupBy(libraryItems.kind),
  ])
  return { users: users.n, bannedUsers: banned.n, publicItems: pub.n, byKind }
}

/**
 * How many live published scenes use each library item, by item id.
 *
 * This scanned each scene's JSON for `doc.backgroundEffect` and
 * `doc.settings.grade.preset`. Neither has existed for a while: a grade is
 * `settings.grade.from` and an effect is `settings.background.effect`, both
 * `{ id, version }` pins (see sceneRefs in lib/scene.ts). It also keyed by NAME
 * while the admin page looked the result up by ID, and never counted shader
 * graphs at all — so every number on that page was either zero or an accident.
 *
 * scene_uses is what publish actually writes, keyed by id, covering every kind.
 * Built-ins are in it like anything else, which is the interesting number: it says
 * which of the curated looks people reach for.
 */
export async function sceneUsage(): Promise<Map<string, number>> {
  const scenes = alias(libraryItems, "scenes")
  const rows = await db
    .select({ itemId: sceneUses.itemId, n: sql<number>`count(*)::int` })
    .from(sceneUses)
    .innerJoin(scenes, eq(scenes.id, sceneUses.sceneId))
    // Only scenes someone can still go and look at — usage_count on the item is
    // incremented at publish and never decremented, so counting here is what keeps
    // the number true after a takedown.
    .where(and(eq(scenes.visibility, "public"), isNull(scenes.deletedAt)))
    .groupBy(sceneUses.itemId)
  return new Map(rows.map((r) => [r.itemId, r.n]))
}

/**
 * Reputation, split by kind. Grouped totals hide the interesting shape — someone
 * with 400 likes on one scene is a different contributor from someone with 400
 * spread across thirty shader graphs.
 */
export type AuthorStats = {
  ownerId: string | null
  scene: { n: number; likes: number }
  graph: { n: number; likes: number }
  effect: { n: number; likes: number }
  grade: { n: number; likes: number }
  likes: number
}

const EMPTY = { n: 0, likes: 0 }

export async function authorStats(): Promise<Map<string, AuthorStats>> {
  const rows = await db
    .select({
      ownerId: libraryItems.ownerId,
      kind: libraryItems.kind,
      n: sql<number>`count(*)::int`,
      likes: sql<number>`coalesce(sum(${libraryItems.likeCount}), 0)::int`,
    })
    .from(libraryItems)
    .groupBy(libraryItems.ownerId, libraryItems.kind)

  const out = new Map<string, AuthorStats>()
  for (const r of rows) {
    if (!r.ownerId) continue
    const cur =
      out.get(r.ownerId) ??
      ({ ownerId: r.ownerId, scene: EMPTY, graph: EMPTY, effect: EMPTY, grade: EMPTY, likes: 0 } as AuthorStats)
    if (r.kind === "scene" || r.kind === "graph" || r.kind === "effect" || r.kind === "grade") {
      cur[r.kind] = { n: r.n, likes: r.likes }
    }
    cur.likes += r.likes
    out.set(r.ownerId, cur)
  }
  return out
}
