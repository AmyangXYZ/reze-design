"use client"

// Shader-graph library — the shared library shell (category rail · thumbnail
// grid · slim inspector), same language as the Backgrounds library. Cards carry
// real graph minimaps; the inspector's big preview doubles as the fork-&-edit
// button (hover → Edit graph), with Apply pinned at the bottom. A look always
// styles the target material's whole GROUP (the styling unit); per-material
// splits live in group management. Also mounts at /library later.
//
// Mobile rules baked in (the old table layout's lesson): dvh height, scrolling
// inspector, shrink-0 pinned actions, rail hidden on narrow screens.

import { useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { Plus, Search, SquarePen, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { LIBRARY_PACKS } from "@/lib/node-library"
import { SLOT_LABELS } from "@/lib/materials"
import { useT } from "@/lib/i18n"
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

type LibraryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The target group's name — the library is scoped to the group it opened from. */
  targetLabel: string | null
  /** Whether a target group exists yet for the material. */
  canApply: boolean
  /** How many materials the target's group holds (shown as info — the whole
   *  group shares one shader graph). */
  affects: number
  /** The group's currently-applied shader graph (pre-selected + tagged "current"). */
  currentGraphName: string | null
  /** `edit` pops the shader-graph editor on the fork so the user can customize it. */
  onApply: (graph: ShaderGraph, name: string, edit: boolean) => void
}

export function NodeLibrary(props: LibraryProps) {
  return (
    // Non-modal + no backdrop so it coexists with the (higher-z) floating editor
    // as an independent panel — open a look's editor without the library closing
    // or blocking. Content mounts fresh per open: browsing state seeds itself.
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

function LibraryContent({ targetLabel, canApply, affects, currentGraphName, onApply }: LibraryProps) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const isCurrent = (r: Row) => r.name === currentGraphName || r.graph.name === currentGraphName
  const [selectedId, setSelectedId] = useState<string | null>(() => ROWS.find(isCurrent)?.id ?? ROWS[0]?.id ?? null)

  const categories = useMemo(() => [...new Set(ROWS.map((r) => r.category))], [])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ROWS.filter(
      (r) =>
        (!category || r.category === category) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.pack.toLowerCase().includes(q) ||
          r.author.toLowerCase().includes(q)),
    ).sort((a, b) => a.name.localeCompare(b.name))
  }, [query, category])
  const selected = useMemo(() => ROWS.find((r) => r.id === selectedId) ?? null, [selectedId])

  return (
    <DialogContent
      showCloseButton={false}
      overlay={false}
      onInteractOutside={(e) => e.preventDefault()}
      // Don't return focus to the opener on close — it drew a stuck-looking
      // focus ring on the Library pill (see globals.css focus-visible rule).
      onCloseAutoFocus={(e) => e.preventDefault()}
      // sm:max-w repeat is load-bearing (DialogContent base carries sm:max-w-lg).
      className="z-40 flex h-[74dvh] max-h-[74dvh] w-[88vw] max-w-4xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-4xl"
    >
      <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 px-4 py-2 text-left">
        <DialogTitle className="shrink-0 text-sm font-medium">{t.library.title}</DialogTitle>
        <div className="relative ml-auto w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.library.searchPlaceholder}
            className="h-7 border-white/10 bg-white/5 pl-8 text-xs"
          />
        </div>
        {/* Creation lives in the header — same spot as the Backgrounds library. */}
        <button
          disabled={!canApply}
          onClick={() => onApply(structuredClone(DEFAULT_GRAPH), t.library.untitledShader, true)}
          className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90 disabled:opacity-40 disabled:hover:bg-white"
        >
          <Plus className="size-3.5" />
          {t.library.newGraph}
        </button>
        <DialogClose className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">{t.library.close}</span>
        </DialogClose>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        {/* ── Category rail (hidden on narrow screens — search still filters) ── */}
        <div className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-white/10 p-2 md:flex">
          <div className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
            {t.bgLibrary.browse}
          </div>
          {[null, ...categories].map((c) => {
            const count = c === null ? ROWS.length : ROWS.filter((r) => r.category === c).length
            const on = category === c
            return (
              <button
                key={c ?? "all"}
                onClick={() => setCategory(c)}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors",
                  on ? "bg-blue-400/15 font-medium text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-left">{c ?? t.bgLibrary.all}</span>
                <span className={cn("font-mono text-[11px]", on ? "text-blue-400/80" : "text-muted-foreground/60")}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* ── Minimap grid ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-3 p-3">
              {rows.map((r) => {
                const sel = r.id === selectedId
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    // Double-click forks straight into the graph editor (same as
                    // the inspector preview's hover affordance, one step sooner).
                    onDoubleClick={() => canApply && onApply(r.graph, r.name, true)}
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition-colors",
                      sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                    )}
                  >
                    <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900/80 text-zinc-200">
                      <GraphMinimap graph={r.graph} className="h-full w-full p-1.5" />
                      {isCurrent(r) && (
                        <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                          {t.library.current}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-xs font-medium">{r.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground/70">
                        {r.pack} · {r.author}
                      </div>
                    </div>
                  </button>
                )
              })}
              {rows.length === 0 && (
                <div className="col-span-full py-16 text-center text-xs text-muted-foreground">{t.library.noMatch(query)}</div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Inspector: preview (= fork-&-edit) · meta · Apply pinned ── */}
        <div className="flex w-[15.5rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[16.5rem]">
          {selected ? (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance: hover → "Edit graph", click
                    forks this look onto the group and opens the editor. */}
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() => canApply && onApply(selected.graph, selected.name, true)}
                  className="group/prev relative block aspect-[16/10] w-full overflow-hidden rounded-md border border-white/10 bg-zinc-900/60 text-zinc-200 disabled:cursor-default"
                >
                  <GraphMinimap graph={selected.graph} className="h-full w-full p-2" />
                  {canApply && (
                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                      <SquarePen className="size-4" />
                      {t.library.editGraph}
                    </div>
                  )}
                </button>
              </div>
              <div className="min-h-0 p-3">
                <div className="truncate text-sm font-semibold">{selected.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                  {selected.pack} · {selected.author} · {selected.created.slice(0, 7)}
                </div>
                {selected.description && (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {/* Indexed key: role labels could repeat once entries carry several tags. */}
                  {selected.tags.map((tag, i) => (
                    <span key={`${tag}-${i}`} className="rounded border border-white/5 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                <Button
                  size="sm"
                  disabled={!canApply}
                  onClick={() => onApply(selected.graph, selected.name, false)}
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
                >
                  <span className="truncate">{canApply ? t.library.applyTo(targetLabel ?? "") : t.library.selectFirst}</span>
                </Button>
                {canApply && <div className="text-center text-[11px] text-muted-foreground">{t.library.materialCount(affects)}</div>}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
              {t.library.selectGraph}
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  )
}
