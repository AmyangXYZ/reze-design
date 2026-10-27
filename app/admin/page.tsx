// The admin page: people and what they publish.
//
// This half does auth and the queries the first view needs, then hands PLAIN
// DATA to the client app (admin-app.tsx) — functions can't cross the
// server/client boundary. Everything else loads when its view opens.
//
// Never cached: a stale moderation view is worse than none.

import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { desc, sql } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { authorStats, siteStats } from "@/lib/db/stats"
import { db, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { AdminApp } from "./admin-app"
import { KINDS, type KindKey } from "./kinds"
import type { UserRow } from "./types"

export const dynamic = "force-dynamic"

const NO_ITEMS = { n: 0, likes: 0 }

export default async function AdminPage() {
  const session = await requireAdmin(await headers())
  // 404, not 403 — a non-admin shouldn't learn the page is here.
  if (!session) notFound()

  const [kindCounts, rawUsers, stats, authors, [fresh]] = await Promise.all([
    db
      .select({ kind: schema.libraryItems.kind, n: sql<number>`count(*)::int` })
      .from(schema.libraryItems)
      .groupBy(schema.libraryItems.kind),
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        image: user.image,
        banned: user.banned,
        bannedAt: user.bannedAt,
        banReason: user.banReason,
        verified: user.verified,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        // How they sign in. The outer row is named in full: a bare column here
        // binds to account's own id inside the subquery and matched nothing,
        // which is why the old "Via" column read "—" for everyone.
        providers: sql<string[]>`(select coalesce(array_agg(distinct a.provider_id), '{}') from account a where a.user_id = "user"."id")`,
      })
      .from(user)
      .orderBy(desc(user.createdAt)),
    siteStats(),
    authorStats(),
    db.select({ n: sql<number>`count(*)::int` }).from(user).where(sql`${user.createdAt} > now() - interval '7 days'`),
  ])

  const counts = Object.fromEntries(KINDS.map((k) => [k.kind, kindCounts.find((c) => c.kind === k.kind)?.n ?? 0])) as Record<KindKey, number>

  const users: UserRow[] = rawUsers.map((u) => {
    const a = authors.get(u.id)
    return {
      ...u,
      providers: Array.isArray(u.providers) ? u.providers : [],
      bannedAt: u.bannedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      perKind: Object.fromEntries(KINDS.map((k) => [k.kind, a?.[k.kind] ?? NO_ITEMS])) as Record<KindKey, { n: number; likes: number }>,
    }
  })

  return (
    <AdminApp
      selfId={session.user.id}
      selfEmail={session.user.email}
      users={users}
      counts={counts}
      stats={{
        publicItems: stats.publicItems,
        likes: users.reduce((s, u) => s + KINDS.reduce((t, k) => t + (u.perKind[k.kind]?.likes ?? 0), 0), 0),
        newThisWeek: fresh?.n ?? 0,
      }}
    />
  )
}
