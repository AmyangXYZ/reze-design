"use client"

// People: who has an account, how they sign in, what they publish and what the
// AI costs for them — and the account panel, where an admin acts on one.

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { KINDS } from "./kinds"
import type { ItemRow, UserRow } from "./types"
import { DeleteAccountAction, DeleteItemAction, PlanAction, RenameAction, SuspendAction } from "./user-actions"
import { UsageView, tokens } from "./usage"

type Filter = "all" | "premium" | "suspended"

export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : "—")
export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-CA", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short", hour12: false }) : "—"

export function Avatar({ user, size = 7 }: { user: Pick<UserRow, "image" | "name">; size?: 7 | 10 }) {
  const box = size === 10 ? "size-10" : "size-7"
  return user.image ? (
    // eslint-disable-next-line @next/next/no-img-element -- a provider's avatar URL
    <img src={user.image} alt="" className={cn(box, "shrink-0 rounded-full")} />
  ) : (
    <span className={cn(box, "flex shrink-0 items-center justify-center rounded-full bg-accent text-[13px] text-muted-foreground")}>
      {user.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Pill({ tone, children, title }: { tone: "accent" | "warning" | "muted"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-chip border px-1.5 py-px text-xs whitespace-nowrap",
        tone === "accent" && "border-blue-500/40 text-blue-600",
        tone === "warning" && "border-amber-500/40 text-amber-600",
        tone === "muted" && "border-line-strong text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

/** "3 scenes · 2 effects", what they published, with likes earned. */
function published(u: UserRow) {
  const parts = KINDS.flatMap((k) => (u.perKind[k.kind]?.n ? [`${u.perKind[k.kind].n} ${k.label.toLowerCase()}`] : []))
  const likes = KINDS.reduce((s, k) => s + (u.perKind[k.kind]?.likes ?? 0), 0)
  return { text: parts.join(" · "), likes, count: KINDS.reduce((s, k) => s + (u.perKind[k.kind]?.n ?? 0), 0) }
}

export function UsersView({ users, selfId }: { users: UserRow[]; selfId: string }) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [open, setOpen] = useState<string | null>(null)
  const [sort, setSort] = useState<"joined" | "published" | "ai">("joined")

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => {
    const list = users.filter(
      (u) =>
        (filter === "all" || (filter === "premium" ? u.plan === "premium" : u.banned)) &&
        (!q || [u.username, u.name, u.email, u.id, ...u.providers].some((f) => f?.toLowerCase().includes(q))),
    )
    const key = (u: UserRow) => (sort === "published" ? published(u).count : sort === "ai" ? u.aiTokens30 : Date.parse(u.createdAt))
    return [...list].sort((a, b) => key(b) - key(a))
  }, [users, q, filter, sort])

  const counts = { all: users.length, premium: users.filter((u) => u.plan === "premium").length, suspended: users.filter((u) => u.banned).length }
  const current = users.find((u) => u.id === open) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, handle, email or id" className="h-8 pl-8 text-[13px] md:text-[13px]" />
        </div>
        <div className="flex gap-1" role="group" aria-label="Show">
          {(["all", "premium", "suspended"] as const).map((f) => (
            <Button
              key={f}
              size="xs"
              variant="ghost"
              onClick={() => setFilter(f)}
              className={cn("h-7 rounded-chip px-2.5 text-[13px] capitalize", filter === f ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              {f} <span className="font-mono text-muted-foreground">{counts[f]}</span>
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 text-[13px] text-muted-foreground" role="group" aria-label="Sort">
          Sort
          {(["joined", "published", "ai"] as const).map((s) => (
            <Button
              key={s}
              size="xs"
              variant="ghost"
              onClick={() => setSort(s)}
              className={cn("h-7 rounded-chip px-2.5 text-[13px]", sort === s ? "bg-accent text-foreground" : "text-muted-foreground")}
            >
              {s === "joined" ? "Newest" : s === "published" ? "Most published" : "AI use"}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-surface border border-line">
        <table className="w-full text-[13px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-line text-left">
              <th className="px-3.5 py-2.5 font-medium">Account</th>
              <th className="px-3.5 py-2.5 font-medium">Status</th>
              <th className="px-3.5 py-2.5 font-medium">Signs in with</th>
              <th className="px-3.5 py-2.5 font-medium">Published</th>
              <th className="px-3.5 py-2.5 font-medium">AI, 30 days</th>
              <th className="px-3.5 py-2.5 font-medium">Joined</th>
              <th className="px-3.5 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const p = published(u)
              const isSelf = u.id === selfId
              return (
                <tr
                  key={u.id}
                  onClick={() => setOpen(u.id)}
                  className={cn("cursor-pointer border-b border-line last:border-0 hover:bg-muted/60", open === u.id && "bg-accent")}
                >
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar user={u} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{u.name}</span>
                          {u.username && <span className="truncate font-mono text-muted-foreground">@{u.username}</span>}
                          {isSelf && <Pill tone="muted">you</Pill>}
                        </div>
                        <div className="truncate text-muted-foreground">
                          {u.email}
                          {!u.emailVerified && <span className="ml-1 text-amber-600">unverified</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.plan === "premium" ? <Pill tone="accent">Premium</Pill> : <Pill tone="muted">Free</Pill>}
                      {u.banned && (
                        <Pill tone="warning" title={u.banReason ?? undefined}>
                          Suspended
                        </Pill>
                      )}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-muted-foreground capitalize">{u.providers.join(", ") || "—"}</td>
                  <td className="px-3.5 py-2.5">
                    {p.count ? (
                      <>
                        <div>{p.text}</div>
                        <div className="text-muted-foreground">{p.likes} likes</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono">{u.aiTokens30 ? tokens(u.aiTokens30) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{date(u.createdAt)}</td>
                  {/* The row opens the panel; these act without opening it. */}
                  <td className="px-3.5 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-0.5">
                      <PlanAction id={u.id} premium={u.plan === "premium"} isSelf={isSelf} variant="icon" />
                      <SuspendAction id={u.id} banned={u.banned} isSelf={isSelf} variant="icon" />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{q || filter !== "all" ? "No accounts match." : "No accounts yet."}</p>}
      </div>

      {current && <AccountPanel user={current} isSelf={current.id === selfId} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** One account: who they are, what can be done to the account (each action
 *  named and explained), everything they published, and their AI use. */
function AccountPanel({ user: u, isSelf, onClose }: { user: UserRow; isSelf: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ItemRow[] | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    fetch(`/api/admin/items?owner=${encodeURIComponent(u.id)}`)
      .then((r) => r.json() as Promise<{ items?: ItemRow[] }>)
      .then((d) => live && setItems(d.items ?? []))
      .catch(() => live && setItems([]))
    return () => {
      live = false
    }
  }, [u.id, nonce])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <aside className="fixed top-3 right-3 bottom-3 z-40 flex w-[32rem] flex-col overflow-hidden rounded-surface border border-line-strong bg-surface shadow-float">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <Avatar user={u} size={10} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">{u.name}</div>
          <div className="truncate font-mono text-[13px] text-muted-foreground">{u.username ? `@${u.username}` : "no handle"}</div>
          <div className="truncate text-[13px] text-muted-foreground">{u.email}</div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close" className="size-7 text-muted-foreground">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 text-[13px]">
        <section className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact label="Plan" value={u.plan === "premium" ? "Premium" : "Free"} />
          <Fact label="Status" value={u.banned ? `Suspended ${date(u.bannedAt)}${u.banReason ? ` — ${u.banReason}` : ""}` : "Active"} />
          <Fact label="Signs in with" value={u.providers.join(", ") || "—"} />
          <Fact label="Joined" value={dateTime(u.createdAt)} />
          <Fact label="Account id" value={u.id} mono />
        </section>

        <section className="space-y-2">
          <Heading>Account</Heading>
          <div className="flex flex-wrap gap-2">
            <PlanAction id={u.id} premium={u.plan === "premium"} isSelf={isSelf} variant="labelled" />
            <RenameAction id={u.id} username={u.username} isSelf={isSelf} variant="labelled" />
            <SuspendAction id={u.id} banned={u.banned} isSelf={isSelf} variant="labelled" />
            <DeleteAccountAction id={u.id} isSelf={isSelf} variant="labelled" onDone={onClose} />
          </div>
        </section>

        <section className="space-y-2">
          <Heading>AI use on this server’s key</Heading>
          <UsageView user={u.id} compact />
        </section>

        <section className="space-y-2">
          <Heading>Published{items ? ` · ${items.length}` : ""}</Heading>
          {items === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">Nothing published.</p>
          ) : (
            <ul className="divide-y divide-line rounded-interior border border-line">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  {i.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a stored poster
                    <img src={i.poster} alt="" className="h-9 w-16 shrink-0 rounded-chip object-cover" />
                  ) : (
                    <span className="flex h-9 w-16 shrink-0 items-center justify-center rounded-chip bg-muted text-[11px] text-muted-foreground capitalize">{i.kind}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{i.name}</div>
                    <div className="text-muted-foreground">
                      <span className="capitalize">{i.kind}</span> · {i.likeCount} likes · {i.visibility} · {date(i.createdAt)}
                    </div>
                  </div>
                  {i.kind === "scene" && (
                    <Button size="icon-xs" variant="ghost" asChild tooltip="Open the scene page" className="text-muted-foreground hover:bg-accent hover:text-foreground">
                      <a href={`/${i.author}/${i.id}`} target="_blank" rel="noreferrer" aria-label="Open the scene page">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  )}
                  <DeleteItemAction id={i.id} name={i.name} variant="icon" onDone={() => setNonce((n) => n + 1)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{children}</h3>
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("truncate", mono && "font-mono text-xs")} title={value}>
        {value}
      </div>
    </div>
  )
}
