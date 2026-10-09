// Library items for the admin page, fetched when a view opens: one kind
// (?kind=), or everything one account published (?owner=).

import { NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase, db, schema } from "@/lib/db"
import { sceneUsage } from "@/lib/db/stats"
import { KINDS } from "@/app/admin/kinds"
import type { ItemRow } from "@/app/admin/types"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!(await requireAdmin(request.headers))) return NextResponse.json({ error: "not found" }, { status: 404 })
  const params = new URL(request.url).searchParams
  const param = params.get("kind")
  const owner = params.get("owner")
  const kind = KINDS.find((k) => k.kind === param)?.kind
  if (!kind && !owner) return NextResponse.json({ error: "invalid kind" }, { status: 400 })
  const t = schema.libraryItems
  const where = kind && owner ? and(eq(t.kind, kind), eq(t.ownerId, owner)) : kind ? eq(t.kind, kind) : eq(t.ownerId, owner!)

  const [rows, usage] = await Promise.all([
    db.select().from(t).where(where).orderBy(desc(t.createdAt)),
    // Nothing references a scene, so its usage would always be zero.
    kind === "scene" ? new Map<string, number>() : sceneUsage(),
  ])

  const items: ItemRow[] = rows.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    author: i.author,
    likeCount: i.likeCount,
    visibility: i.visibility,
    createdAt: i.createdAt.toISOString(),
    usedInScenes: usage.get(i.id) ?? 0,
    exportedIn: i.exportCount,
    description: i.description,
    poster: i.posterKey && process.env.R2_PUBLIC_BASE_URL ? `${process.env.R2_PUBLIC_BASE_URL}/${i.posterKey}` : null,
  }))
  return NextResponse.json({ items })
}
