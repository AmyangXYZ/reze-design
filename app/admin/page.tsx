// Moderation, so managing content never means opening a terminal.
//
// This half does auth and queries and hands PLAIN DATA to the tables — functions
// can't cross the server/client boundary, so column definitions live in
// tables.tsx alongside the component that uses them.
//
// Never cached: a stale moderation view is worse than none.

import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { desc, sql } from "drizzle-orm"
import { requireAdmin } from "@/lib/admin"
import { authorStats, sceneUsage, siteStats } from "@/lib/db/stats"
import { db, schema } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { AssetTable, ItemTables, UserTable, type ItemRow, type UserRow } from "./tables"
import { KINDS, type KindKey } from "./kinds"

export const dynamic = "force-dynamic"

const NO_ITEMS = { n: 0, likes: 0 }

export default async function AdminPage() {
  const session = await requireAdmin(await headers())
  // 404, not 403 — a non-admin shouldn't learn the page is here.
  if (!session) notFound()

  const [rawItems, rawUsers, stats, usage, authors] = await Promise.all([
    db.select().from(schema.libraryItems).orderBy(desc(schema.libraryItems.createdAt)),
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
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        // One email can arrive via both providers once linking fires.
        providers: sql<string>`(select coalesce(string_agg(distinct provider_id, ', '), '—')
          from account where account.user_id = ${user.id})`,
      })
      .from(user)
      .orderBy(desc(user.createdAt)),
    siteStats(),
    sceneUsage(),
    authorStats(),
  ])

  const items: ItemRow[] = rawItems.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.name,
    author: i.author,
    likeCount: i.likeCount,
    visibility: i.visibility,
    createdAt: i.createdAt.toISOString(),
    usedInScenes: usage.get(i.id) ?? 0,
  }))

  const users: UserRow[] = rawUsers.map((u) => {
    const a = authors.get(u.id)
    return {
      ...u,
      bannedAt: u.bannedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      perKind: Object.fromEntries(KINDS.map((k) => [k.kind, a?.[k.kind] ?? NO_ITEMS])) as Record<
        KindKey,
        { n: number; likes: number }
      >,
    }
  })

  const tiles = [
    { label: "Accounts", value: stats.users, note: stats.bannedUsers ? `${stats.bannedUsers} suspended` : null },
    { label: "Public", value: stats.publicItems, note: null },
    ...KINDS.map((k) => ({
      label: k.label,
      value: stats.byKind.find((b) => b.kind === k.kind)?.count ?? 0,
      note: null,
    })),
  ]

  return (
    <main className="w-full px-12 py-10 text-sm">
      <h1 className="text-lg font-semibold">Admin</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Signed in as {session.user.email}. Everything here is enforced server-side.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{t.label}</div>
            <div className="mt-1 font-mono text-xl">{t.value}</div>
            {t.note && <div className="text-[11px] text-muted-foreground/70">{t.note}</div>}
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Accounts · {users.length}
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Each kind column shows published count · likes earned. Sort by any of them.
        </p>
        <UserTable users={users} selfId={session.user.id} />
      </section>

      <ItemTables items={items} />

      <section className="mt-12">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Stored objects</h2>
        <AssetTable />
      </section>
    </main>
  )
}
