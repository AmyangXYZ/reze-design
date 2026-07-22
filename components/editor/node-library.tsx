"use client"

// Node-graph library — a "pick a shader for this material" browser (the internal
// role/slot stays hidden). Left ~70%: a sortable table — click a column header to
// sort (chevron shows the active column + direction) — each row with a real graph
// minimap. Right ~30%: the selected look's larger preview (live sphere later) +
// Apply. Applying spans the material's similar siblings by default (engine shades
// per role) — an opt-out checkbox, not a scary note. Also mounts at /library later.

import { useMemo, useState } from "react"
import type { StyleGraph } from "reze-engine"
import { ChevronDown, ChevronUp, Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { LIBRARY_PACKS } from "@/lib/node-library"
import { SLOT_LABELS } from "@/lib/materials"
import { cn } from "@/lib/utils"

type Row = { id: string; name: string; category: string; pack: string; author: string; created: string; tags: string[]; graph: StyleGraph }

const ROWS: Row[] = LIBRARY_PACKS.flatMap((p) =>
  p.entries.map((e) => ({
    id: e.id,
    name: e.name,
    category: SLOT_LABELS[e.tags[0]] ?? "—",
    pack: p.name,
    author: e.author,
    created: e.created,
    tags: e.tags.map((t) => SLOT_LABELS[t]),
    graph: e.graph,
  })),
)

type SortKey = "name" | "category" | "pack" | "author" | "created"
const COLUMNS: { key: SortKey; label: string; end?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "pack", label: "Pack" },
  { key: "author", label: "Author" },
  { key: "created", label: "Date", end: true },
]
// Preview · Name · Category · Pack · Author · Date — shared by header and rows.
const GRID = "grid grid-cols-[3.25rem_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_4rem] items-center gap-2"

export function NodeLibrary({
  open,
  onOpenChange,
  targetMaterial,
  canApply,
  affects,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The material a picked look applies to (label only — no slot shown). */
  targetMaterial: string | null
  /** Whether a target exists yet (a role has been resolved for the material). */
  canApply: boolean
  /** How many materials share this look (drives the opt-out "also apply" box). */
  affects: number
  onApply: (graph: StyleGraph, name: string, applyToSimilar: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [applySimilar, setApplySimilar] = useState(true)

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "created" ? "desc" : "asc")
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = ROWS.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.pack.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q),
    )
    const dir = sortDir === "asc" ? 1 : -1
    return filtered.sort((a, b) => dir * String(a[sortKey]).localeCompare(String(b[sortKey])))
  }, [query, sortKey, sortDir])
  const selected = useMemo(() => ROWS.find((r) => r.id === selectedId) ?? null, [selectedId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[78vh] max-h-[78vh] w-[92vw] max-w-5xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-5xl"
      >
        <DialogHeader className="border-b border-white/10 px-4 py-2.5">
          <DialogTitle className="text-sm font-medium">Node graph library</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── Left: search + sortable table ── */}
          <div className="flex min-h-0 flex-1 flex-col border-r border-white/10">
            <div className="border-b border-white/5 px-4 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search looks, packs, authors…"
                  className="h-7 border-white/10 bg-white/5 pl-8 text-xs"
                />
              </div>
            </div>

            {/* Column headers (fixed above the scrolling body). */}
            <div className={cn(GRID, "border-b border-white/10 px-3 py-1.5")}>
              <span />
              {COLUMNS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={cn(
                    "flex min-w-0 items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground",
                    c.end && "justify-end",
                  )}
                >
                  <span className="truncate">{c.label}</span>
                  {sortKey === c.key &&
                    (sortDir === "asc" ? <ChevronUp className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />)}
                </button>
              ))}
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="py-1">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      GRID,
                      "w-full px-3 py-1 text-left text-xs transition-colors",
                      r.id === selectedId ? "bg-blue-400/[0.08]" : "hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="h-8 w-11 shrink-0 rounded bg-zinc-900/60 text-zinc-400">
                      <GraphMinimap graph={r.graph} className="h-full w-full p-0.5" />
                    </div>
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="truncate text-muted-foreground">{r.category}</span>
                    <span className="truncate text-muted-foreground">{r.pack}</span>
                    <span className="truncate text-muted-foreground">{r.author}</span>
                    <span className="text-right text-muted-foreground tabular-nums">{r.created.slice(0, 7)}</span>
                  </button>
                ))}
                {rows.length === 0 && <div className="py-16 text-center text-xs text-muted-foreground">No looks match “{query}”.</div>}
              </div>
            </ScrollArea>
          </div>

          {/* ── Right: preview + apply ── */}
          <div className="flex w-[30%] min-w-[260px] flex-col p-4">
            <div className="aspect-square w-full rounded-lg border border-white/10 bg-zinc-900/60 text-zinc-400">
              {selected ? (
                <GraphMinimap graph={selected.graph} className="h-full w-full p-4" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a look</div>
              )}
            </div>
            <div className="mt-1 text-center text-xs text-muted-foreground">graph preview · live sphere coming soon</div>

            {selected && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {selected.pack} · {selected.author} · {selected.created.slice(0, 7)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.tags.map((t) => (
                    <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-auto space-y-2 pt-4">
                  {canApply && affects > 1 && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                      <Checkbox
                        checked={applySimilar}
                        onCheckedChange={(v) => setApplySimilar(v === true)}
                        className="size-3.5 rounded-[4px] border-white/20"
                      />
                      Also apply to {affects - 1} similar materials
                    </label>
                  )}
                  <Button
                    size="sm"
                    disabled={!canApply}
                    onClick={() => {
                      onApply(selected.graph, selected.name, applySimilar)
                      onOpenChange(false)
                    }}
                    className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
                  >
                    {canApply ? (targetMaterial ? `Apply to ${targetMaterial}` : "Apply") : "Select a material first"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
