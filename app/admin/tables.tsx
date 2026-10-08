"use client"

// Column definitions live here, not in the page.
//
// `cell` and `sort` are functions, and functions can't cross the server/client
// boundary — the page does auth and queries, then hands over plain data.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { AssetTable, ItemControls, PlanToggle, RenameUser, UserControls } from "./actions"
import { DataTable, LazySection, type Column } from "./data-table"
import { KINDS, type KindKey } from "./kinds"


export type ItemRow = {
  id: string
  kind: string
  name: string
  author: string
  likeCount: number
  visibility: string
  createdAt: string
  usedInScenes: number
  exportedIn: number
}

export type UserRow = {
  id: string
  email: string
  name: string
  username: string | null
  image: string | null
  banned: boolean
  bannedAt: string | null
  banReason: string | null
  plan: "free" | "premium"
  emailVerified: boolean
  providers: string
  createdAt: string
  /** published count and likes earned, per kind */
  perKind: Record<KindKey, { n: number; likes: number }>
}

/** Stored UTC, shown in US Eastern. Absolute, not relative: moderation is forensic
 *  work, and "2 days ago" can't answer "what happened right before this". */
const stamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "—"

function SceneUrl({ author, id }: { author: string; id: string }) {
  const [copied, setCopied] = useState(false)
  const path = `/${author}/${id}`
  return (
    <span className="flex items-center gap-1.5">
      <a href={path} target="_blank" rel="noreferrer" className="font-mono text-blue-400 hover:underline">
        reze.design{path}
      </a>
      <button
        aria-label="Copy URL"
        onClick={() => {
          void navigator.clipboard.writeText(`https://reze.design${path}`).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  )
}

export function ItemTables({ counts }: { counts: Record<KindKey, number> }) {
  return (
    <>
      {KINDS.map((k) => (
        <LazySection key={k.kind} title={k.label} count={counts[k.kind]}>
          <ItemSection kind={k.kind} label={k.label} />
        </LazySection>
      ))}
    </>
  )
}

/** Mounts when its section opens, and fetches that one kind then. */
function ItemSection({ kind, label }: { kind: KindKey; label: string }) {
  const [rows, setRows] = useState<ItemRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      fetch(`/api/admin/items?kind=${kind}`)
        .then(async (r) => {
          const d = (await r.json()) as { items?: ItemRow[]; error?: string }
          if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`)
          setRows(d.items ?? [])
        })
        .catch((e: Error) => setError(e.message)),
    [kind],
  )

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo(() => itemColumns(kind, () => void load()), [kind, load])

  if (error) return <p className="mt-3 text-xs text-red-400 select-text">{error}</p>
  if (rows === null) return <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
  return (
    <DataTable
      rows={rows}
      columns={columns}
      empty={`No ${label.toLowerCase()} yet.`}
      initialSort={{ key: "created", desc: true }}
    />
  )
}

function itemColumns(kind: string, reload: () => void): Column<ItemRow>[] {
  return [
    {
      key: "name",
      header: "Name",
      sort: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <>
          <div>{r.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground/60">{r.id}</div>
        </>
      ),
    },
    { key: "author", header: "Author", sort: (r) => r.author, cell: (r) => <span className="font-mono">{r.author}</span> },
    // Scenes are the only kind with a public address — the exact link the Share
    // dialog hands out, so it can be opened or copied straight from here.
    ...(kind === "scene"
      ? [
          {
            key: "url",
            header: "Public URL",
            cell: (r: ItemRow) => <SceneUrl author={r.author} id={r.id} />,
          },
        ]
      : []),
    {
      key: "likes",
      header: "Likes",
      sort: (r) => r.likeCount,
      cell: (r) => <span className="font-mono">{r.likeCount}</span>,
    },
    // Scenes have nothing referencing them, so the column would always be zero.
    ...(kind === "scene"
      ? []
      : [
          {
            key: "scenes",
            header: "In scenes",
            sort: (r: ItemRow) => r.usedInScenes,
            cell: (r: ItemRow) => <span className="font-mono">{r.usedInScenes}</span>,
          },
          // Its own column, never folded into the one beside it: publishes are
          // counted from rows that exist, exports are reported anonymously by
          // whoever opted in. Two different degrees of certainty do not belong
          // in one number, and the gap between them is the interesting part.
          {
            key: "exports",
            header: "In exports",
            sort: (r: ItemRow) => r.exportedIn,
            cell: (r: ItemRow) => <span className="font-mono">{r.exportedIn}</span>,
          },
        ]),
    {
      key: "created",
      header: "Created (ET)",
      sort: (r) => r.createdAt,
      cell: (r) => <span className="font-mono text-muted-foreground">{stamp(r.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => <ItemControls id={r.id} onDeleted={reload} />,
    },
  ]
}

export function UserTable({ users, selfId }: { users: UserRow[]; selfId: string }) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      q
        ? users.filter((u) =>
            [u.username, u.name, u.email, u.providers, u.id].some((f) => f?.toLowerCase().includes(q)),
          )
        : users,
    [users, q],
  )

  const columns: Column<UserRow>[] = [
    {
      key: "handle",
      header: "Handle",
      sort: (u) => u.username ?? "",
      cell: (u) => (
        <>
          <div className="flex items-center gap-2">
            {u.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.image} alt="" className="size-5 rounded-full" />
            ) : (
              <span className="size-5 rounded-full bg-white/10" />
            )}
            <span className="font-mono">{u.username ?? "—"}</span>
            <RenameUser id={u.id} username={u.username} isSelf={u.id === selfId} />
            {u.banned && (
              <span className="shrink-0 rounded border border-amber-400/30 px-1 text-[10px] text-amber-400">
                suspended
              </span>
            )}
          </div>
          {u.banned && (
            <div className="mt-0.5 pl-7 text-[10px] text-muted-foreground/70">
              {stamp(u.bannedAt)}
              {u.banReason ? ` · ${u.banReason}` : ""}
            </div>
          )}
        </>
      ),
    },
    {
      key: "name",
      header: "Provider name",
      sort: (u) => u.name,
      cell: (u) => <span className="text-muted-foreground">{u.name}</span>,
    },
    {
      key: "via",
      header: "Via",
      sort: (u) => u.providers,
      cell: (u) => <span className="font-mono text-muted-foreground">{u.providers}</span>,
    },
    {
      key: "email",
      header: "Email",
      sort: (u) => u.email,
      cell: (u) => (
        <span className="text-muted-foreground">
          {u.email}
          {!u.emailVerified && <span className="ml-1 text-[10px] text-amber-400">unverified</span>}
        </span>
      ),
    },
    // One column per kind: published · likes earned. Sortable, so "who are the
    // strongest shader authors" is a click rather than a query.
    ...KINDS.map(
      (k): Column<UserRow> => ({
        key: k.kind,
        header: k.label,
        sort: (u) => u.perKind[k.kind]?.likes ?? 0,
        cell: (u) => {
          const s = u.perKind[k.kind]
          if (!s?.n) return <span className="text-muted-foreground/40">—</span>
          return (
            <span className="font-mono">
              {s.n}
              <span className="text-muted-foreground/60"> · {s.likes}</span>
            </span>
          )
        },
      }),
    ),
    {
      key: "joined",
      header: "Joined (ET)",
      sort: (u) => u.createdAt,
      cell: (u) => <span className="font-mono text-muted-foreground">{stamp(u.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (u) => (
        <div className="flex items-center gap-2">
          <PlanToggle id={u.id} premium={u.plan === "premium"} isSelf={u.id === selfId} />
          <UserControls id={u.id} banned={u.banned} isSelf={u.id === selfId} />
        </div>
      ),
    },
  ]

  return (
    <>
      <div className="relative mt-3 w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search handle, name, email or id"
          className="h-8 pl-8 text-xs md:text-xs"
        />
      </div>
      <DataTable
        rows={shown}
        columns={columns}
        empty={q ? "No accounts match." : "No accounts yet."}
        initialSort={{ key: "joined", desc: true }}
      />
    </>
  )
}

export { AssetTable }
