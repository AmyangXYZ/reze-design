// Drop every cached library item and scene page. Admin only.
//
// The pages read their rows through unstable_cache, which only an app-side
// write marks stale. A content migration run against the database directly (a
// one-time conversion of published payloads) leaves every page serving the
// payload it cached before; this is the step that follows one.

import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase } from "@/lib/db"
import { refreshEveryItem } from "@/lib/public-pages"

export async function POST(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  const admin = await requireAdmin(request.headers)
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 })
  refreshEveryItem()
  return NextResponse.json({ refreshed: true })
}
