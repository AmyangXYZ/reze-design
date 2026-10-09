"use client"

// What people published: scenes as a wall of posters, effects, grades and
// shader graphs as tables. Each kind loads when its view opens.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, ExternalLink, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { KindKey } from "./kinds"
import type { ItemRow } from "./types"
import { DeleteItemAction } from "./user-actions"
import { date } from "./users"

function useItems(kind: KindKey) {
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
  return { rows, error, reload: load }
}

type Sort = "new" | "likes" | "used"

function Toolbar({ query, setQuery, sort, setSort, sorts, count }: { query: string; setQuery: (q: string) => void; sort: Sort; setSort: (s: Sort) => void; sorts: Sort[]; count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, author or id" className="h-8 pl-8 text-[13px] md:text-[13px]" />
      </div>
      <span className="font-mono text-[13px] text-muted-foreground">{count}</span>
      <div className="ml-auto flex items-center gap-1 text-[13px] text-muted-foreground" role="group" aria-label="Sort">
        Sort
        {sorts.map((s) => (
          <Button
            key={s}
            size="xs"
            variant="ghost"
            onClick={() => setSort(s)}
            className={cn("h-7 rounded-chip px-2.5 text-[13px]", sort === s ? "bg-accent text-foreground" : "text-muted-foreground")}
          >
            {s === "new" ? "Newest" : s === "likes" ? "Most liked" : "Most used"}
          </Button>
        ))}
      </div>
    </div>
  )
}

function useShown(rows: ItemRow[] | null, query: string, sort: Sort) {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (rows ?? []).filter((r) => !q || [r.name, r.author, r.id].some((f) => f.toLowerCase().includes(q)))
    const key = (r: ItemRow) => (sort === "likes" ? r.likeCount : sort === "used" ? r.usedInScenes + r.exportedIn : Date.parse(r.createdAt))
    return [...list].sort((a, b) => key(b) - key(a))
  }, [rows, query, sort])
}

function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      tooltip="Copy the public link"
      aria-label="Copy the public link"
      className="text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() =>
        void navigator.clipboard.writeText(`https://reze.design${path}`).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export function ScenesView() {
  const { rows, error, reload } = useItems("scene")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("new")
  const shown = useShown(rows, query, sort)
  if (error) return <p className="text-xs text-amber-600">{error}</p>
  if (!rows) return <p className="text-xs text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-4">
      <Toolbar query={query} setQuery={setQuery} sort={sort} setSort={setSort} sorts={["new", "likes"]} count={shown.length} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {shown.map((s) => {
          const path = `/${s.author}/${s.id}`
          return (
            <article key={s.id} className="overflow-hidden rounded-surface border border-line bg-card">
              <a href={path} target="_blank" rel="noreferrer" className="block aspect-video bg-muted">
                {s.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a stored poster
                  <img src={s.poster} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-muted-foreground">No poster</span>
                )}
              </a>
              <div className="flex items-start gap-2 p-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-muted-foreground">
                    @{s.author} · {s.likeCount} likes · {s.visibility}
                  </div>
                  <div className="font-mono text-muted-foreground">{date(s.createdAt)}</div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button size="icon-xs" variant="ghost" asChild tooltip="Open the public page" className="text-muted-foreground hover:bg-accent hover:text-foreground">
                    <a href={path} target="_blank" rel="noreferrer" aria-label="Open the public page">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                  <CopyLink path={path} />
                  <DeleteItemAction id={s.id} name={s.name} variant="icon" onDone={() => void reload()} />
                </div>
              </div>
            </article>
          )
        })}
      </div>
      {shown.length === 0 && <p className="text-xs text-muted-foreground">{query ? "No scenes match." : "No scenes yet."}</p>}
    </div>
  )
}

/** Effects, grades or shader graphs: a table, since there is no picture to show. */
export function ItemsView({ kind, noun }: { kind: Exclude<KindKey, "scene">; noun: string }) {
  const { rows, error, reload } = useItems(kind)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("new")
  const shown = useShown(rows, query, sort)
  if (error) return <p className="text-[13px] text-amber-600">{error}</p>
  if (!rows) return <p className="text-[13px] text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-4">
      <Toolbar query={query} setQuery={setQuery} sort={sort} setSort={setSort} sorts={["new", "likes", "used"]} count={shown.length} />
      <div className="overflow-hidden rounded-surface border border-line">
        <table className="w-full text-[13px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-line text-left">
              <th className="px-3.5 py-2.5 font-medium">Name</th>
              <th className="px-3.5 py-2.5 font-medium">Author</th>
              <th className="px-3.5 py-2.5 font-medium">Likes</th>
              <th className="px-3.5 py-2.5 font-medium" title="Published scenes that use it">In scenes</th>
              <th className="px-3.5 py-2.5 font-medium" title="Videos exported with it, from those who share export stats">In exports</th>
              <th className="px-3.5 py-2.5 font-medium">Visibility</th>
              <th className="px-3.5 py-2.5 font-medium">Created</th>
              <th className="px-3.5 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-3.5 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  {r.description && <div className="max-w-md truncate text-muted-foreground">{r.description}</div>}
                </td>
                <td className="px-3.5 py-2.5 font-mono text-muted-foreground">@{r.author}</td>
                <td className="px-3.5 py-2.5 font-mono">{r.likeCount}</td>
                <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{r.usedInScenes}</td>
                <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{r.exportedIn}</td>
                <td className="px-3.5 py-2.5 text-muted-foreground">{r.visibility}</td>
                <td className="px-3.5 py-2.5 font-mono text-muted-foreground">{date(r.createdAt)}</td>
                <td className="px-3.5 py-2.5 text-right">
                  <DeleteItemAction id={r.id} name={r.name} variant="icon" onDone={() => void reload()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{query ? `No ${noun} match.` : `No ${noun} yet.`}</p>}
      </div>
    </div>
  )
}
