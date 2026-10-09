"use client"

// The admin page's frame: a sidebar of views and the one that is open.
//
// Centred on people and what they publish. The view lives in the address
// (?view=users), so a reload or a shared link opens where you were. Every view
// but the overview and accounts loads its own data when opened.

import { useCallback, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BarChart3, Clapperboard, HardDrive, LayoutDashboard, Palette, Sparkles, Users, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AssetList } from "./actions"
import type { KindKey } from "./kinds"
import { ItemsView, ScenesView } from "./library"
import type { UserRow } from "./types"
import { UsageView } from "./usage"
import { Avatar, UsersView, date } from "./users"

const VIEWS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "scenes", label: "Scenes", icon: Clapperboard },
  { id: "effects", label: "Effects", icon: Sparkles },
  { id: "grades", label: "Grades", icon: Palette },
  { id: "graphs", label: "Shaders", icon: Workflow },
  { id: "usage", label: "AI usage", icon: BarChart3 },
  { id: "assets", label: "Storage", icon: HardDrive },
] as const
type ViewId = (typeof VIEWS)[number]["id"]

const COUNT_OF: Partial<Record<ViewId, KindKey>> = { scenes: "scene", effects: "effect", grades: "grade", graphs: "graph" }

export function AdminApp({
  selfId,
  selfEmail,
  users,
  counts,
  stats,
}: {
  selfId: string
  selfEmail: string
  users: UserRow[]
  counts: Record<KindKey, number>
  stats: { publicItems: number; likes: number; newThisWeek: number }
}) {
  const params = useSearchParams()
  // Opened from the address (a reload, a shared link), then switched IN THE
  // TAB: the address is rewritten with history.replaceState, which asks the
  // server for nothing. router.replace re-rendered this server page — every
  // account, every count — on each click, which is what made switching slow.
  const [view, setView] = useState<ViewId>(() => VIEWS.find((v) => v.id === params.get("view"))?.id ?? "overview")
  // Views opened so far. Each stays mounted once opened and is only hidden
  // when another is shown: switching back is instant, its data is not fetched
  // again, and its search, filter and scroll are where they were. A view
  // refetches only after an action in it (a delete) or a reload.
  const [opened, setOpened] = useState<Set<ViewId>>(() => new Set([view]))
  const go = useCallback((v: ViewId) => {
    setView(v)
    setOpened((s) => (s.has(v) ? s : new Set(s).add(v)))
    window.history.replaceState(null, "", v === "overview" ? "/admin" : `/admin?view=${v}`)
  }, [])
  const pane = (id: ViewId, node: React.ReactNode) =>
    opened.has(id) ? (
      <div key={id} hidden={view !== id}>
        {node}
      </div>
    ) : null

  const badge = (v: ViewId) => (v === "users" ? users.length : COUNT_OF[v] ? counts[COUNT_OF[v]!] : null)
  const title = VIEWS.find((v) => v.id === view)!.label

  return (
    // The root body carries the editor's scene colour; this page paints its own.
    <div className="admin-light flex min-h-screen w-full flex-1 bg-background text-[13px] text-foreground">
      <nav className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-0.5 border-r border-line px-3 py-6">
        <div className="mb-5 px-2">
          <div className="text-base font-semibold">Admin</div>
          <div className="truncate text-xs text-muted-foreground" title={selfEmail}>
            {selfEmail}
          </div>
        </div>
        {VIEWS.map((v) => {
          const n = badge(v.id)
          return (
            <Button
              key={v.id}
              variant="ghost"
              size="sm"
              onClick={() => go(v.id)}
              aria-current={view === v.id ? "page" : undefined}
              className={cn(
                "h-8 justify-start gap-2.5 rounded-interior px-2 text-[13px]",
                view === v.id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <v.icon className="size-4" />
              <span className="flex-1 text-left">{v.label}</span>
              {n !== null && <span className="font-mono text-xs text-muted-foreground">{n}</span>}
            </Button>
          )
        })}
        <p className="mt-auto px-2 text-[11px] text-muted-foreground">Everything here is enforced on the server.</p>
      </nav>

      <main className="min-w-0 flex-1 px-10 py-8">
        <h1 className="mb-6 text-xl font-semibold">{title}</h1>
        {pane("overview", <Overview users={users} counts={counts} stats={stats} go={go} />)}
        {pane("users", <UsersView users={users} selfId={selfId} />)}
        {pane("scenes", <ScenesView />)}
        {pane("effects", <ItemsView kind="effect" noun="effects" />)}
        {pane("grades", <ItemsView kind="grade" noun="grades" />)}
        {pane("graphs", <ItemsView kind="graph" noun="shaders" />)}
        {pane("usage", <UsageView />)}
        {pane("assets", <AssetList />)}
      </main>
    </div>
  )
}

function Tile({ label, value, note, onClick }: { label: string; value: number | string; note?: string | null; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </>
  )
  return onClick ? (
    <Button variant="ghost" onClick={onClick} className="h-auto flex-col items-start justify-start rounded-surface border border-line bg-card p-3 text-left font-normal hover:bg-accent">
      {body}
    </Button>
  ) : (
    <div className="rounded-surface border border-line bg-card p-3">{body}</div>
  )
}

function Overview({ users, counts, stats, go }: { users: UserRow[]; counts: Record<KindKey, number>; stats: { publicItems: number; likes: number; newThisWeek: number }; go: (v: ViewId) => void }) {
  const premium = users.filter((u) => u.plan === "premium").length
  const suspended = users.filter((u) => u.banned).length
  const week = stats.newThisWeek
  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile label="Accounts" value={users.length} note={week ? `${week} this week` : null} onClick={() => go("users")} />
        <Tile label="Premium" value={premium} onClick={() => go("users")} />
        <Tile label="Suspended" value={suspended} onClick={() => go("users")} />
        <Tile label="Scenes" value={counts.scene} onClick={() => go("scenes")} />
        <Tile label="Effects" value={counts.effect} onClick={() => go("effects")} />
        <Tile label="Shaders" value={counts.graph} onClick={() => go("graphs")} />
        <Tile label="Likes" value={stats.likes} note={`${stats.publicItems} public items`} />
      </section>

      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-muted-foreground">AI usage on this server’s key</h2>
          <UsageView compact />
        </section>
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-muted-foreground">Newest accounts</h2>
          <ul className="divide-y divide-line rounded-surface border border-line">
            {users.slice(0, 8).map((u) => (
              <li key={u.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
                <Avatar user={u} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{u.name}</div>
                  <div className="truncate font-mono text-muted-foreground">{u.username ? `@${u.username}` : u.email}</div>
                </div>
                <span className="font-mono text-muted-foreground">{date(u.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
