// AI usage on this server's key (Premium), for the admin page: tokens per day
// per account, and each account's totals, over the last N days — or for one
// account (?user=). Fetched when its view opens.
//
// A person's own key never comes through here, so it never shows: this is
// exactly what this server pays for.

import { NextResponse } from "next/server"
import { and, eq, gte, sql } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { hasDatabase, db, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

export const dynamic = "force-dynamic"

export type UsageDay = { day: string; user: string; input: number; cached: number; output: number; turns: number }
export type UsageUser = {
  id: string
  username: string | null
  name: string
  image: string | null
  input: number
  cached: number
  output: number
  turns: number
  last: string
  models: string[]
}
export type UsageReport = { since: string; days: string[]; series: UsageDay[]; users: UsageUser[]; missing?: true }

/** Every day in the window, oldest first, as YYYY-MM-DD (UTC). */
function daysSince(since: Date): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()))
  const end = new Date()
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export async function GET(request: Request) {
  if (!hasDatabase) return NextResponse.json({ error: "no database on this deployment" }, { status: 503 })
  if (!(await requireAdmin(request.headers))) return NextResponse.json({ error: "not found" }, { status: 404 })
  const params = new URL(request.url).searchParams
  const window = Math.min(365, Math.max(1, Number(params.get("days")) || 30))
  const only = params.get("user")
  const since = new Date(Date.now() - (window - 1) * 86_400_000)
  since.setUTCHours(0, 0, 0, 0)
  const t = schema.aiUsage
  const where = only ? and(gte(t.at, since), eq(t.userId, only)) : gte(t.at, since)
  const day = sql<string>`to_char(date_trunc('day', ${t.at}), 'YYYY-MM-DD')`

  try {
    const [series, totals] = await Promise.all([
      db
        .select({
          day,
          user: t.userId,
          input: sql<number>`sum(${t.inputTokens})::int`,
          cached: sql<number>`sum(${t.cachedTokens})::int`,
          output: sql<number>`sum(${t.outputTokens})::int`,
          turns: sql<number>`count(*)::int`,
        })
        .from(t)
        .where(where)
        .groupBy(day, t.userId),
      db
        .select({
          id: t.userId,
          username: user.username,
          name: user.name,
          image: user.image,
          input: sql<number>`sum(${t.inputTokens})::int`,
          cached: sql<number>`sum(${t.cachedTokens})::int`,
          output: sql<number>`sum(${t.outputTokens})::int`,
          turns: sql<number>`count(*)::int`,
          last: sql<string>`max(${t.at})`,
          models: sql<string[]>`array_agg(distinct ${t.model})`,
        })
        .from(t)
        .innerJoin(user, eq(user.id, t.userId))
        .where(where)
        .groupBy(t.userId, user.username, user.name, user.image),
    ])
    const users: UsageUser[] = totals.map((u) => ({ ...u, last: new Date(u.last).toISOString() }))
    return NextResponse.json({ since: since.toISOString(), days: daysSince(since), series, users } satisfies UsageReport)
  } catch (e) {
    // Before the ai_usage migration has run there is no table: say so, not 500.
    if (String((e as { code?: string })?.code ?? e).includes("42P01") || /ai_usage/.test(String(e))) {
      return NextResponse.json({ since: since.toISOString(), days: daysSince(since), series: [], users: [], missing: true } satisfies UsageReport)
    }
    throw e
  }
}
