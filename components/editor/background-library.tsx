"use client"

// Backgrounds library — the shared three-column shell (facet rail · thumbnail grid · slim

import { useMemo, useState } from "react"
import { Plus, Search, Sparkles, SquarePen, Trash2, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  applyDefaults,
  BACKGROUND_EFFECTS,
  NEW_EFFECT_TEMPLATE,
  type AppliedBackgroundEffect,
} from "@/lib/background-effects"
import { EffectPreview } from "@/components/editor/effect-preview"
import { LIBRARY_SHELL, LibraryRail, LibraryStats, LibraryTags } from "@/components/editor/library-rail"
import { matchesFacet, matchesQuery, type EffectItem, type LibraryFacet } from "@/lib/library"
import { useLibraryStats } from "@/hooks/use-library-stats"
import { useZOrder } from "@/hooks/use-z-order"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type LibraryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  applied: AppliedBackgroundEffect | null
  onApply: (effect: AppliedBackgroundEffect) => void
  onRemove: () => void
  /** Open the page-level floating WGSL editor on this effect (independent panel, same idiom */
  onEdit: (fx: AppliedBackgroundEffect) => void
}

export function BackgroundLibrary(props: LibraryProps) {
  return (
    // Non-modal + no overlay, mirroring the shader-graph library
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {/* Mounted fresh per open: browsing state (query/facet/selection/draft) seeds itself */}
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

/** Seed the inspector's param draft */
const seedDraft = (selected: EffectItem | null, applied: AppliedBackgroundEffect | null): AppliedBackgroundEffect | null =>
  selected ? (applied?.id === selected.id ? { ...applied } : applyDefaults(selected)) : null

function LibraryContent({ onOpenChange, applied, onApply, onRemove, onEdit }: LibraryProps) {
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { stats, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [query, setQuery] = useState("")
  const [facet, setFacet] = useState<LibraryFacet>("all")
  const [selectedId, setSelectedId] = useState<string | null>(applied?.id ?? BACKGROUND_EFFECTS[0]?.id ?? null)
  // Follow the applied effect when it CHANGES — creating or editing one should move
  // the selection with it, rather than leaving the ring on the previous entry.
  const [lastApplied, setLastApplied] = useState(applied?.id ?? null)
  if ((applied?.id ?? null) !== lastApplied) {
    setLastApplied(applied?.id ?? null)
    if (applied) setSelectedId(applied.id)
  }

  const all = BACKGROUND_EFFECTS
  const selected: EffectItem | null = useMemo(() => all.find((e) => e.id === selectedId) ?? null, [all, selectedId])
  // Draft = what Apply applies for the current selection.
  const [draft, setDraft] = useState<AppliedBackgroundEffect | null>(() => seedDraft(selected, applied))
  const [draftFor, setDraftFor] = useState(selectedId)
  if (selectedId !== draftFor) {
    setDraftFor(selectedId)
    setDraft(seedDraft(selected, applied))
  }

  const rows = useMemo(() => all.filter((e) => matchesFacet(e, facet) && matchesQuery(e, query)), [all, query, facet])

  const isAppliedSelected = applied !== null && selected !== null && applied.id === selected.id

  // "New effect": open the floating editor on a template-seeded custom subject.
  const startNew = () => onEdit({ id: "custom", name: t.bgLibrary.untitled, wgsl: NEW_EFFECT_TEMPLATE })

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
        // Same footprint as the shader-graph library.
        style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        className={LIBRARY_SHELL}
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 bg-zinc-950 px-4 py-2 text-left">
          <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-blue-400" />
            {t.scene.bgEffects}
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
          {/* Creation lives in the header */}
          <button
            onClick={startNew}
            className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
          >
            <Plus className="size-3.5" />
            {t.bgLibrary.newEffect}
          </button>
          <DialogClose className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
            <X className="size-4" />
            <span className="sr-only">{t.library.close}</span>
          </DialogClose>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <LibraryRail items={all} facet={facet} onFacetChange={setFacet} />

          {/* Thumbnail grid + pinned "New effect" (the graph library's New-graph idiom */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] content-start gap-3 p-3">
              {rows.map((e) => {
                const sel = e.id === selectedId
                return (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault()
                        setSelectedId(e.id)
                      }
                    }}
                    onClick={() => setSelectedId(e.id)}
                    onDoubleClick={() => onEdit(seedDraft(e, applied)!)} // straight into the code
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition-colors",
                      sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                    )}
                  >
                    <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900">
                      <EffectPreview wgsl={e.payload.wgsl} />
                      {applied?.id === e.id && (
                        <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                          {t.bgLibrary.applied}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="truncate text-xs font-medium">{e.name}</div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-muted-foreground/70">{e.author}</span>
                        <LibraryStats
                          likeCount={stats[e.id]?.likeCount ?? 0}
                          liked={stats[e.id]?.liked ?? false}
                          scenes={stats[e.id]?.scenes ?? 0}
                          canLike={signedIn}
                          onToggle={() => void toggleLike(e.id)}
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

          {/* Inspector: preview · meta · params · Apply (pinned, but the column scrolls */}
          <div className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[20rem]">
            {selected && draft ? (
              <>
                <div className="p-3 pb-0">
                  {/* The preview IS the edit affordance, exactly like the graph library */}
                  <button
                    type="button"
                    onClick={() => onEdit(draft)}
                    className="group/prev relative block aspect-[16/10] w-full overflow-hidden rounded-md border border-white/10"
                  >
                    {/* The draft's code, not the def's — a forked/edited effect previews as forked. */}
                    <EffectPreview wgsl={draft.wgsl} />
                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                      <SquarePen className="size-4" />
                      {t.bgLibrary.editShader}
                    </div>
                  </button>
                </div>
                <div className="min-h-0 p-3">
                  <div className="truncate text-sm font-semibold">{selected.name}</div>
                  <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                    {selected.author} · v{selected.version}
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{selected.description}</p>
                  <LibraryTags tags={selected.tags} />
                </div>

                {/* Pinned action: red destructive Remove when applied (the counterpart of the blue Apply) */}
                <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                  {isAppliedSelected ? (
                    <Button
                      size="sm"
                      onClick={onRemove}
                      className="h-8 w-full bg-red-500/90 text-xs font-medium text-white hover:bg-red-500"
                    >
                      <Trash2 className="size-3.5" />
                      {t.bgLibrary.remove}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        onApply(draft)
                        onOpenChange(false) // show the scene — it IS the result
                      }}
                      className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
                    >
                      {t.bgLibrary.apply}
                    </Button>
                  )}
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
