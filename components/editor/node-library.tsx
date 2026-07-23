"use client"

// Node-graph library — a "pick a shader for this group" browser. Left ~70%: a
// sortable table — click a column header to sort (chevron shows the active column
// + direction) — each row with a real graph minimap. Right ~30%: the selected
// look's larger preview (live sphere later) + Apply / Fork & edit; a toolbar
// "New graph" starts a blank look. A look always styles the target material's
// whole group (the styling unit); per-material splits live in group management.
// Also mounts at /library later.

import { useEffect, useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { ChevronDown, ChevronUp, Plus, Search, SquarePen } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { LIBRARY_PACKS } from "@/lib/node-library"
import { SLOT_LABELS } from "@/lib/materials"
import { cn } from "@/lib/utils"

type Row = { id: string; name: string; description: string; category: string; pack: string; author: string; created: string; tags: string[]; graph: ShaderGraph }

const ROWS: Row[] = LIBRARY_PACKS.flatMap((p) =>
  p.entries.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    category: SLOT_LABELS[e.tags[0]] ?? "—",
    pack: p.name,
    author: e.author,
    created: e.created,
    tags: e.tags.map((t) => SLOT_LABELS[t]),
    graph: e.graph,
  })),
)

type SortKey = "name" | "pack" | "author" | "created"
const COLUMNS: { key: SortKey; label: string; end?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "pack", label: "Pack" },
  { key: "author", label: "Author" },
  { key: "created", label: "Date", end: true },
]
// Preview · Name · Pack · Author · Date — shared by header and rows.
const GRID = "grid grid-cols-[3.25rem_minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_4rem] items-center gap-2"

export function NodeLibrary({
  open,
  onOpenChange,
  targetLabel,
  canApply,
  affects,
  currentGraphName,
  onApply,
  onEditCurrent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The target group's name — shown in the title and the "applies to" line. */
  targetLabel: string | null
  /** Whether a target group exists yet for the material. */
  canApply: boolean
  /** How many materials the target's group holds (shown as info — the whole
   *  group shares one shader graph). */
  affects: number
  /** The group's currently-applied shader graph (pre-selected + drives "Edit current"). */
  currentGraphName: string | null
  /** `edit` pops the shader-graph editor on the fork so the user can customize it. */
  onApply: (graph: ShaderGraph, name: string, edit: boolean) => void
  /** Open the editor on the group's current shader graph. */
  onEditCurrent: () => void
}) {
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // On open, pre-select the group's currently-applied shader graph so the list
  // shows what's live and "Edit current" reads in context. Match on the display
  // name (set when applied from the library) OR the underlying graph name (what
  // auto-grouped presets carry).
  useEffect(() => {
    if (!open || !currentGraphName) return
    const row = ROWS.find((r) => r.name === currentGraphName || r.graph.name === currentGraphName)
    setSelectedId(row?.id ?? null)
  }, [open, currentGraphName])

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
          <DialogTitle className="flex items-baseline gap-2 text-sm font-medium">
            Shader graph library
            {targetLabel && <span className="truncate text-xs font-normal text-muted-foreground">· {targetLabel}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── Left: search + sortable table ── */}
          <div className="flex min-h-0 flex-1 flex-col border-r border-white/10">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search shader graphs, packs, authors…"
                  className="h-7 border-white/10 bg-white/5 pl-8 text-xs"
                />
              </div>
              {/* Edit the group's current shader graph directly (no re-pick). */}
              {currentGraphName && (
                <Button
                  size="sm"
                  onClick={onEditCurrent}
                  className="h-7 shrink-0 gap-1 border border-white/10 bg-white/5 text-xs font-medium text-foreground hover:bg-white/10"
                >
                  <SquarePen className="size-3.5" />
                  Edit current
                </Button>
              )}
              {/* Start a blank shader graph from the default and jump into the editor. */}
              <Button
                size="sm"
                disabled={!canApply}
                onClick={() => onApply(structuredClone(DEFAULT_GRAPH), "Untitled shader", true)}
                className="h-7 shrink-0 gap-1 border border-white/10 bg-white/5 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
              >
                <Plus className="size-3.5" />
                New graph
              </Button>
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
                    <div className="h-8 w-11 shrink-0 rounded bg-zinc-900/60 text-zinc-200">
                      <GraphMinimap graph={r.graph} className="h-full w-full p-0.5" />
                    </div>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{r.name}</span>
                      {(r.name === currentGraphName || r.graph.name === currentGraphName) && (
                        <span className="shrink-0 rounded-full bg-blue-400/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">current</span>
                      )}
                    </span>
                    <span className="truncate text-muted-foreground">{r.pack}</span>
                    <span className="truncate text-muted-foreground">{r.author}</span>
                    <span className="text-right text-muted-foreground tabular-nums">{r.created.slice(0, 7)}</span>
                  </button>
                ))}
                {rows.length === 0 && <div className="py-16 text-center text-xs text-muted-foreground">No shader graphs match “{query}”.</div>}
              </div>
            </ScrollArea>
          </div>

          {/* ── Right: preview + apply ── */}
          <div className="flex w-[30%] min-w-[260px] flex-col p-4">
            <div className="aspect-square w-full rounded-lg border border-white/10 bg-zinc-900/60 text-zinc-200">
              {selected ? (
                <GraphMinimap graph={selected.graph} className="h-full w-full p-4" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a shader graph</div>
              )}
            </div>
            <div className="mt-1 text-center text-xs text-muted-foreground">graph preview · live sphere coming soon</div>

            {selected && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col">
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {selected.pack} · {selected.author} · {selected.created.slice(0, 7)}
                </div>
                {selected.description && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {selected.tags.map((t) => (
                    <span key={t} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-auto space-y-2 pt-4">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!canApply}
                      onClick={() => onApply(selected.graph, selected.name, false)}
                      className="h-8 flex-1 bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
                    >
                      {canApply ? "Apply" : "Select a material first"}
                    </Button>
                    {/* Edit = the group gets its own editable copy, editor opens on it. */}
                    <Button
                      size="sm"
                      disabled={!canApply}
                      onClick={() => onApply(selected.graph, selected.name, true)}
                      className="h-8 shrink-0 gap-1.5 border border-white/10 bg-white/5 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40"
                    >
                      <SquarePen className="size-3.5" />
                      Edit
                    </Button>
                  </div>
                  {canApply && (
                    <div className="text-center text-xs text-muted-foreground">
                      → applies to{" "}
                      <span className="text-foreground">
                        {affects} material{affects === 1 ? "" : "s"}
                      </span>{" "}
                      of the {targetLabel} group
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
