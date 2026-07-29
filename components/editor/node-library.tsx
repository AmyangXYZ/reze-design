"use client"

// Shader-graph library — the shared library shell (facet rail · thumbnail grid · slim inspector).

import { useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { Plus, Search, SquarePen, Workflow, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { LIBRARY_SHELL, LibraryRail, LibraryStats, LibraryTags } from "@/components/editor/library-rail"
import { matchesFacet, matchesQuery, type GraphItem, type LibraryFacet } from "@/lib/library"
import { useLibraryStats } from "@/hooks/use-library-stats"
import { useZOrder } from "@/hooks/use-z-order"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const ROWS: GraphItem[] = GRAPH_LIBRARY

type LibraryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The target group's name — the library is scoped to the group it opened from. */
  targetLabel: string | null
  /** Whether a target group exists yet for the material. */
  canApply: boolean
  /** How many materials the target's group holds (shown as info */
  affects: number
  /** The group's currently-applied shader graph (pre-selected + tagged "current"). */
  currentGraphName: string | null
  /** `edit` pops the shader-graph editor on the fork so the user can customize it. */
  onApply: (graph: ShaderGraph, name: string, edit: boolean) => void
}

export function NodeLibrary(props: LibraryProps) {
  return (
    // Non-modal + no backdrop so it coexists with the (higher-z) floating editor
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

function LibraryContent({ targetLabel, canApply, affects, currentGraphName, onApply, onOpenChange }: LibraryProps) {
  const onClose = () => onOpenChange(false)
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { stats, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture } = useZOrder(undefined, onClose)
  const [query, setQuery] = useState("")
  const [facet, setFacet] = useState<LibraryFacet>("all")
  const isCurrent = (r: GraphItem) => r.name === currentGraphName || r.payload.graph.name === currentGraphName
  const [selectedId, setSelectedId] = useState<string | null>(() => ROWS.find(isCurrent)?.id ?? ROWS[0]?.id ?? null)

  const rows = useMemo(
    () =>
      ROWS.filter((r) => matchesFacet(r, facet) && matchesQuery(r, query)).sort((a, b) => a.name.localeCompare(b.name)),
    [query, facet],
  )
  const selected = useMemo(() => ROWS.find((r) => r.id === selectedId) ?? null, [selectedId])

  return (
    <DialogContent
      showCloseButton={false}
      overlay={false}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
      // Don't pull focus into the search field — it made Escape land in a text
      // input the moment the library opened.
      onOpenAutoFocus={(e) => e.preventDefault()}
      // Don't return focus to the opener on close
      onCloseAutoFocus={(e) => e.preventDefault()}
      // sm:max-w repeat is load-bearing (DialogContent base carries sm:max-w-lg).
      style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        className={LIBRARY_SHELL}
    >
      <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 bg-zinc-950 px-4 py-2 text-left">
        <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Workflow className="size-4 text-blue-400" />
          {t.library.title}
        </DialogTitle>
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
        <LibraryRail items={ROWS} facet={facet} onFacetChange={setFacet} />

        {/* ── Minimap grid ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] content-start gap-3 p-3">
              {rows.map((r) => {
                const sel = r.id === selectedId
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault()
                        setSelectedId(r.id)
                      }
                    }}
                    onClick={() => setSelectedId(r.id)}
                    // Double-click forks straight into the graph editor (same as the inspector preview's hover
                    onDoubleClick={() => canApply && onApply(r.payload.graph, r.name, true)}
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition-colors",
                      sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                    )}
                  >
                    <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900/80 text-zinc-200">
                      <GraphMinimap graph={r.payload.graph} className="h-full w-full p-1.5" />
                      {isCurrent(r) && (
                        <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                          {t.library.current}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-xs font-medium">{r.name}</div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-muted-foreground/70">{r.author}</span>
                        <LibraryStats
                          likeCount={stats[r.id]?.likeCount ?? 0}
                          liked={stats[r.id]?.liked ?? false}
                          scenes={stats[r.id]?.scenes ?? 0}
                          canLike={signedIn}
                          onToggle={() => void toggleLike(r.id)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
              {rows.length === 0 && (
                <div className="col-span-full py-16 text-center text-xs text-muted-foreground">
                  {facet === "yours" && !query ? t.rail.yoursEmpty : t.library.noMatch(query)}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* ── Inspector: preview (= fork-&-edit) · meta · Apply pinned ── */}
        <div className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[20rem]">
          {selected ? (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance */}
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={() => canApply && onApply(selected.payload.graph, selected.name, true)}
                  className="group/prev relative block aspect-[16/10] w-full overflow-hidden rounded-md border border-white/10 bg-zinc-900/60 text-zinc-200 disabled:cursor-default"
                >
                  <GraphMinimap graph={selected.payload.graph} className="h-full w-full p-2" />
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
                <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                  {selected.author} · v{selected.version}
                </div>
                {selected.description && (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <LibraryTags tags={selected.tags} />
              </div>
              <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                <Button
                  size="sm"
                  disabled={!canApply}
                  onClick={() => onApply(selected.payload.graph, selected.name, false)}
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
