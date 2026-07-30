// Your own portfolio numbers, for the account menu.
//
// Separate from /api/library/stats (which is per-item, for the library grids):
// this is "what have I published, and how did it land".

import { NextResponse } from "next/server"
import { eq, sql } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { hasDatabase, db, schema } from "@/lib/db"

export type MeStats = { scene: number; effect: number; grade: number; graph: number; likes: number }

export async function GET(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const rows = await db
    .select({
      kind: schema.libraryItems.kind,
      n: sql<number>`count(*)::int`,
      likes: sql<number>`coalesce(sum(${schema.libraryItems.likeCount}), 0)::int`,
    })
    .from(schema.libraryItems)
    .where(eq(schema.libraryItems.ownerId, session.user.id))
    .groupBy(schema.libraryItems.kind)

  const stats: MeStats = { scene: 0, effect: 0, grade: 0, graph: 0, likes: 0 }
  for (const r of rows) {
    if (r.kind === "scene" || r.kind === "effect" || r.kind === "grade" || r.kind === "graph") stats[r.kind] = r.n
    stats.likes += r.likes
  }
  return NextResponse.json({ stats })
}

export const revalidate = 0
