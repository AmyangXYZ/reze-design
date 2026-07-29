import "server-only"

// Aggregates for the admin page.
//
// Usage counts read INTO the payload: a published scene stores which grade and
// which effect it uses, so "how many scenes use this preset" is a jsonb query
// rather than a join table we would have to keep in step. Slower, but it cannot
// drift from the thing it describes.

import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { libraryItems } from "@/lib/db/schema"

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
 * How many published scenes reference each grade and each background effect.
 *
 * Built-ins are referenced by bare id, so this counts usage of `content/*.json`
 * entries too — which is the interesting number: it says which of the curated
 * looks people actually reach for.
 */
export async function presetUsage(): Promise<{ grade: Record<string, number>; effect: Record<string, number> }> {
  const rows = await db
    .select({
      grade: sql<string | null>`${libraryItems.payload}->'doc'->'settings'->'grade'->>'preset'`,
      // A built-in effect travels as a bare id string; an edited one as an object
      // carrying its own id.
      effect: sql<string | null>`coalesce(
        ${libraryItems.payload}->'doc'->>'backgroundEffect',
        ${libraryItems.payload}->'doc'->'backgroundEffect'->>'id'
      )`,
    })
    .from(libraryItems)
    .where(eq(libraryItems.kind, "scene"))

  const grade: Record<string, number> = {}
  const effect: Record<string, number> = {}
  for (const r of rows) {
    if (r.grade) grade[r.grade] = (grade[r.grade] ?? 0) + 1
    if (r.effect) effect[r.effect] = (effect[r.effect] ?? 0) + 1
  }
  return { grade, effect }
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
