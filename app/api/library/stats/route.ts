// Per-item social stats for the libraries: like count, whether you liked it, and
// how many published scenes use it.
//
// One request for the whole library rather than one per card — a grid of twenty
// items should not make twenty round trips, especially to Singapore.
//
// Keyed by `kind:name` — the name is the human key the client actually holds
// (builtins carry no stored id), and kind disambiguates two kinds sharing a name.
// Each entry carries the row's machine-minted id, which is what the like route
// wants.

import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"

export type ItemStats = { id: string; likeCount: number; liked: boolean; scenes: number }

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })

  const [items, mine, sceneRefs] = await Promise.all([
    db
      .select({
        id: schema.libraryItems.id,
        kind: schema.libraryItems.kind,
        name: schema.libraryItems.name,
        likeCount: schema.libraryItems.likeCount,
      })
      .from(schema.libraryItems),
    session
      ? db.select({ itemId: schema.likes.itemId }).from(schema.likes).where(eq(schema.likes.userId, session.user.id))
      : Promise.resolve([] as { itemId: string }[]),
    // Read INTO the payload rather than maintaining a join table: a scene records
    // which grade and effect it uses (by name), so this cannot drift from what it
    // describes.
    db
      .select({
        grade: sql<string | null>`${schema.libraryItems.payload}->'doc'->'settings'->'grade'->>'preset'`,
        effect: sql<string | null>`coalesce(
          ${schema.libraryItems.payload}->'doc'->'settings'->'background'->>'effect',
          ${schema.libraryItems.payload}->'doc'->'settings'->'background'->'effect'->>'name'
        )`,
      })
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.kind, "scene")),
  ])

  const liked = new Set(mine.map((m) => m.itemId))
  const usage = new Map<string, number>()
  for (const r of sceneRefs) {
    for (const [kind, name] of [
      ["grade", r.grade],
      ["effect", r.effect],
    ] as const) {
      if (name) usage.set(`${kind}:${name}`, (usage.get(`${kind}:${name}`) ?? 0) + 1)
    }
  }

  const stats: Record<string, ItemStats> = {}
  for (const i of items) {
    const key = `${i.kind}:${i.name}`
    stats[key] = { id: i.id, likeCount: i.likeCount, liked: liked.has(i.id), scenes: usage.get(key) ?? 0 }
  }
  return NextResponse.json({ stats, signedIn: !!session })
}

export const revalidate = 0
