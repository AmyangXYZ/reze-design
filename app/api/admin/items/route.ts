// One kind of library item for the admin page, fetched when its section opens.

import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase, db, schema } from "@/lib/db"
import { sceneUsage } from "@/lib/db/stats"
import { KINDS } from "@/app/admin/kinds"
import type { ItemRow } from "@/app/admin/tables"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  // No database configured — see lib/db. Nothing to publish to, and nothing to
  // sign in as, so the honest answer is that this deployment cannot do it.
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!(await requireAdmin(request.headers))) return NextResponse.json({ error: "not found" }, { status: 404 })
  const param = new URL(request.url).searchParams.get("kind")
  const kind = KINDS.find((k) => k.kind === param)?.kind
  if (!kind) return NextResponse.json({ error: "invalid kind" }, { status: 400 })

  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.kind, kind))
      .orderBy(desc(schema.libraryItems.createdAt)),
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
  }))
  return NextResponse.json({ items })
}
