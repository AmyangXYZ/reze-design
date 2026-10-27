"use client"

// What people published, as walls of poster cards. Each kind loads when its
// view opens.

import { Stamp } from "@/components/stamp"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Clapperboard, Copy, ExternalLink, Eye, Heart, Lock, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { KindKey } from "./kinds"
import type { ItemRow } from "./types"
import { DeleteItemAction } from "./user-actions"

export function useItems(kind: KindKey) {
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
      {sorts.length > 0 && (
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
      )}
    </div>
  )
}

function useShown(rows: ItemRow[] | null, query: string, sort: Sort) {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (rows ?? []).filter((r) => !q || [r.name, r.author, r.id].some((f) => f.toLowerCase().includes(q)))
    const key = (r: ItemRow) => (sort === "likes" ? r.likeCount : sort === "used" ? r.usedInScenes : Date.parse(r.createdAt))
    return [...list].sort((a, b) => key(b) - key(a))
  }, [rows, query, sort])
}

function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="icon-xs"
      variant="ghost"
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

/** What an item's poster says about who can reach it: private, or (a scene)
 *  watch-only. Public and forkable carries no mark. */
export function Reach({ item }: { item: ItemRow }) {
  const marks = [
    item.visibility === "private" && { icon: Lock, label: "Private" },
    item.displayOnly && { icon: Eye, label: "View only" },
  ].filter((m): m is { icon: typeof Lock; label: string } => !!m)
  if (!marks.length) return null
  return (
    <div className="absolute top-2 right-2 flex gap-1">
      {marks.map((m) => (
        <span key={m.label} title={m.label} aria-label={m.label} className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs">
          <m.icon className="size-3.5" />
        </span>
      ))}
    </div>
  )
}

/** Scenes, effects, grades or shader graphs: a wall of cards, each its poster
 *  with who can reach it marked on it, then its name, its author, and its
 *  numbers, a line each. */
export function ItemsView({ kind, noun }: { kind: KindKey; noun: string }) {
  const { rows, error, reload } = useItems(kind)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("new")
  const shown = useShown(rows, query, sort)
  const scene = kind === "scene"
  if (error) return <p className="text-[13px] text-amber-600">{error}</p>
  if (!rows) return <p className="text-[13px] text-muted-foreground">Loading…</p>
  return (
    <div className="space-y-4">
      <Toolbar query={query} setQuery={setQuery} sort={sort} setSort={setSort} sorts={scene ? ["new", "likes"] : ["new", "likes", "used"]} count={shown.length} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
        {shown.map((s) => {
          const path = scene ? `/${s.author}/${s.id}` : null
          const poster = s.poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored poster
            <img src={s.poster} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted-foreground">No poster</span>
          )
          return (
            <article key={s.id} className="overflow-hidden rounded-surface border border-line bg-card">
              <div className="relative aspect-video bg-muted">
                {path ? (
                  <a href={path} target="_blank" rel="noreferrer" className="block size-full">
                    {poster}
                  </a>
                ) : (
                  poster
                )}
                <Reach item={s} />
              </div>
              <div className="space-y-1 p-3 text-[13px]">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate font-medium" title={s.description || undefined}>
                    {s.name}
                  </div>
                  <div className="-my-1 flex shrink-0 gap-0.5">
                    {path && (
                      <>
                        <Button size="icon-xs" variant="ghost" asChild className="text-muted-foreground hover:bg-accent hover:text-foreground">
                          <a href={path} target="_blank" rel="noreferrer" aria-label="Open the public page">
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                        <CopyLink path={path} />
                      </>
                    )}
                    <DeleteItemAction id={s.id} name={s.name} variant="icon" onDone={() => void reload()} />
                  </div>
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">@{s.author}</div>
                <div className="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" title="Likes">
                    <Heart className="size-3" />
                    <span className="font-mono">{s.likeCount}</span>
                  </span>
                  {!scene && (
                    <span className="flex items-center gap-1" title="Published scenes that use it">
                      <Clapperboard className="size-3" />
                      <span className="font-mono">{s.usedInScenes}</span>
                    </span>
                  )}
                  <Stamp iso={s.createdAt} className="ml-auto font-mono" />
                </div>
              </div>
            </article>
          )
        })}
      </div>
      {shown.length === 0 && <p className="text-[13px] text-muted-foreground">{query ? `No ${noun} match.` : `No ${noun} yet.`}</p>}
    </div>
  )
}
