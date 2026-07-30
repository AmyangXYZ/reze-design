"use client"

// Column definitions live here, not in the page.
//
// `cell` and `sort` are functions, and functions can't cross the server/client
// boundary — the page does auth and queries, then hands over plain data.

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { AssetTable, ItemControls, RenameUser, UserControls } from "./actions"
import { DataTable, type Column } from "./data-table"
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

export function ItemTables({ items }: { items: ItemRow[] }) {
  const columns = (kind: string): Column<ItemRow>[] => [
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
      cell: (r) => <ItemControls id={r.id} />,
    },
  ]

  return (
    <>
      {KINDS.map((k) => {
        const rows = items.filter((i) => i.kind === k.kind)
        return (
          <section key={k.kind} className="mt-10">
            <h2 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {k.label} · {rows.length}
            </h2>
            <DataTable
              rows={rows}
              columns={columns(k.kind)}
              empty={`No ${k.label.toLowerCase()} yet.`}
              initialSort={{ key: "created", desc: true }}
            />
          </section>
        )
      })}
    </>
  )
}

export function UserTable({ users, selfId }: { users: UserRow[]; selfId: string }) {
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
      cell: (u) => <UserControls id={u.id} banned={u.banned} isSelf={u.id === selfId} />,
    },
  ]

  return <DataTable rows={users} columns={columns} empty="No accounts yet." initialSort={{ key: "joined", desc: true }} />
}

export { AssetTable }
