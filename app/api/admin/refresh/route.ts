// Drop every cached library item and scene page.
//
// The pages read their rows through unstable_cache, which only an app-side
// write marks stale. A content migration run against the database directly (a
// one-time conversion of published payloads) leaves every page serving the
// payload it cached before; this is the step that follows one.
//
// Two ways in: an admin's session, from the browser, or the deployment's
// CACHE_REFRESH_TOKEN as a bearer token — what `npm run db:refresh` sends, so
// a migration script can finish its own job without anyone signed in.

import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase } from "@/lib/db"
import { refreshEveryItem } from "@/lib/public-pages"

/** The bearer token matches this deployment's, compared in constant time. */
function tokenOk(request: Request): boolean {
  const want = process.env.CACHE_REFRESH_TOKEN
  if (!want) return false
  const got = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/)?.[1] ?? ""
  const a = Buffer.from(got)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!tokenOk(request) && !(await requireAdmin(request.headers))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  refreshEveryItem()
  return NextResponse.json({ refreshed: true })
}
