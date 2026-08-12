"use client"

// Effects library — the shared three-column shell (facet rail · thumbnail grid · slim
// inspector).
//
// Named for what the items ARE, not for where the first ones happened to sit. The
// kind has been `effect` in the envelope, the database and the publish route since
// they existed; only the UI still said "background", and an effect has not been
// confined to the background since it learned where the cast is. The scene
// document's own `settings.background.effect` keeps its name — that shape is frozen
// once scenes are in the wild, and it is still literally where the effect is layered.

import { useMemo, useState } from "react"
import { Check, Plus, Search, Sparkles, SquarePen, X } from "lucide-react"
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
import { LIBRARY_GRID, LIBRARY_SHELL, LibraryItemStats, LibraryRail, LibraryShelf, LibraryShelves, LibraryStats, LibraryTags, ShelfCount, ShelfHandle } from "@/components/editor/library-rail"
import {
  conflictingName,
  matchesFacet,
  matchesQuery,
  normalizeName,
  type EffectItem,
  type LibraryFacet,
} from "@/lib/library"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { draftOrigin } from "@/lib/drafts"
import {
  addCommunityItem,
  builtinAuthor,
  isMine,
  removeCommunityItem,
  renameCommunityItem,
  useCommunity,
} from "@/hooks/use-community"
import { useDrafts } from "@/hooks/use-drafts"
import { noteItemPublished, useLibraryStats } from "@/hooks/use-library-stats"
import { useZOrder } from "@/hooks/use-z-order"
import { PublishButton } from "@/components/editor/publish-button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type LibraryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Facet the library opens on — the account tab opens straight to "yours". */
  initialFacet?: LibraryFacet
  applied: AppliedBackgroundEffect | null
  onApply: (effect: AppliedBackgroundEffect) => void
  /** A draft was renamed — re-point anything applied by the old name. */
  onRenamed?: (oldName: string, newName: string) => void
  onRemove: () => void
  /** Open the page-level floating WGSL editor on this effect (independent panel, same idiom
   *  as the graph editor). Optional: a host without the editor omits it, and
   *  every edit/new affordance hides rather than sitting there doing nothing. */
  onEdit?: (effect: AppliedBackgroundEffect) => void
}

export function EffectLibrary(props: LibraryProps) {
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

function LibraryContent({ onOpenChange, initialFacet, applied, onApply, onRemove, onRenamed, onEdit }: LibraryProps) {
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [query, setQuery] = useState("")
  const [facet, setFacet] = useState<LibraryFacet>(initialFacet ?? "all")
  const [tag, setTag] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(applied?.id ?? BACKGROUND_EFFECTS[0]?.id ?? null)
  // Follow the applied effect when it CHANGES — creating or editing one should move
  // the selection with it, rather than leaving the ring on the previous entry.
  const [lastApplied, setLastApplied] = useState(applied?.id ?? null)
  if ((applied?.id ?? null) !== lastApplied) {
    setLastApplied(applied?.id ?? null)
    if (applied) setSelectedId(applied.id)
  }

  const { drafts, update: updateDraft, remove: removeDraft, clear: clearDrafts } = useDrafts<EffectItem>("effect")
  // Built-ins lead in name order; drafts follow in creation order.
  const community = useCommunity<EffectItem>("effect")
  const all = useMemo(
    // Bundled items carry no idea who is asking; the fetched rows do.
    () => [...BACKGROUND_EFFECTS.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [community, drafts],
  )
  const selected: EffectItem | null = useMemo(() => all.find((e) => e.id === selectedId) ?? null, [all, selectedId])
  // Draft = what Apply applies for the current selection.
  const [draft, setDraft] = useState<AppliedBackgroundEffect | null>(() => seedDraft(selected, applied))
  const [draftFor, setDraftFor] = useState(selectedId)
  if (selectedId !== draftFor) {
    setDraftFor(selectedId)
    setDraft(seedDraft(selected, applied))
  }

  const rows = useMemo(() => all.filter((e) => matchesFacet(e, facet, statFor(e.id).liked) && (!tag || e.tags.includes(tag)) && matchesQuery(e, query)), [all, query, facet, tag, statFor])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // A typed name that is already in use — see the graph library's commitRename.
  const [renameError, setRenameError] = useState<string | null>(null)
  const commitRename = (item: EffectItem, raw: string) => {
    const wanted = normalizeName(raw)
    if (!wanted || wanted === item.name) {
      setRenamingId(null)
      setRenameError(null)
      return
    }
    // Refused, not silently suffixed — see the graph library's commitRename.
    const clash = conflictingName(
      wanted,
      [...BACKGROUND_EFFECTS, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
    )
    if (clash) {
      setRenameError(t.library.nameTakenBy(clash))
      return
    }
    setRenamingId(null)
    setRenameError(null)
    const name = wanted
    if (item.owner === "local") updateDraft(item.id, { name })
    else {
      // Published: the server owns the row, and rejects a name you already used.
      void fetch(`/api/library/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((res) => res.ok && renameCommunityItem(item.id, name))
    }
    onRenamed?.(item.name, name)
  }

  // Built-ins by name (a fixed set you learn the shape of, so it must not move);
  // community in server order, which is newest first, because nobody knows those
  // names and recency is the only signal there is. Drafts pin below both.
  const builtinRows = useMemo(
    () => rows.filter((x) => x.owner === "builtin").sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  )
  const communityRows = useMemo(() => rows.filter((x) => x.owner === "user"), [rows])
  const localRows = useMemo(() => rows.filter((x) => x.owner === "local"), [rows])
  // The applied effect cannot be deleted — see the graph library's `inUse`.
  const inUse = (e: EffectItem) => e.owner === "local" && applied?.id === e.id
  const clearable = localRows.filter((e) => !inUse(e))

  const isAppliedSelected = applied !== null && selected !== null && applied.id === selected.id

  // "New effect": open the floating editor on the template. Nothing is created —
  // the editor is a scratchpad, and save-on-close is what makes a draft.
  const startNew = () => onEdit?.({ id: "", name: t.effectLibrary.newEffect, wgsl: NEW_EFFECT_TEMPLATE })

  const renderCard = (e: EffectItem) => {
    const sel = e.id === selectedId
    const card = (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault()
                        setSelectedId(e.id)
                      }
                    }}
                    onClick={() => setSelectedId(e.id)}
                    onDoubleClick={() => onEdit?.(seedDraft(e, applied)!)} // straight into the code
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition-colors",
                      sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                    )}
                  >
                    <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900">
                      <EffectPreview wgsl={e.payload.wgsl} />
                      {applied?.id === e.id && (
                        <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                          {t.effectLibrary.applied}
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {renamingId === e.id ? (
                          <Input
                            autoFocus
                            defaultValue={e.name}
                            className={cn(
                              "h-5 min-w-0 flex-1 border-white/10 bg-white/5 px-1 text-xs md:text-xs",
                              renameError && "border-red-400/60",
                            )}
                            onClick={(ev) => ev.stopPropagation()}
                            onChange={() => renameError && setRenameError(null)}
                            onBlur={(ev) => commitRename(e, ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur()
                              if (ev.key === "Escape") {
                                setRenameError(null)
                                setRenamingId(null)
                              }
                            }}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{e.name}</span>
                        )}
                        <LibraryStats
                          likeCount={statFor(e.id).likeCount}
                          liked={statFor(e.id).liked}
                        />
                      </div>
                      {renamingId === e.id && renameError && (
                        <p className="mt-1 text-[10px] leading-tight text-red-400">{renameError}</p>
                      )}
                    </div>
                  </div>
    )
    // One menu on every card: right-click is the discoverable route to editing
    // (double-click still works). Rename and delete only where they apply.
    const isDraft = e.owner === "local"
    const mine = (e as { mine?: boolean }).mine === true
    return (
      <ContextMenu key={e.id}>
        <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          {onEdit && (
            <ContextMenuItem onSelect={() => onEdit(seedDraft(e, applied)!)}>{t.effectLibrary.editShader}</ContextMenuItem>
          )}
          {isDraft && <ContextMenuItem
              onSelect={() => {
                setRenameError(null)
                setRenamingId(e.id)
              }}
            >
              {t.graph.rename}
            </ContextMenuItem>}
          {isDraft && (
            <ContextMenuItem
              variant="danger"
              disabled={inUse(e)}
              onSelect={() => {
                if (confirm(t.library.deleteDraftConfirm)) removeDraft(e.id)
              }}
            >
              {inUse(e) ? t.library.deleteInUse : t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <ContextMenuItem
              onSelect={() => {
                setRenameError(null)
                setRenamingId(e.id)
              }}
            >
              {t.graph.rename}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => {
                if (!confirm(t.library.deletePublishedConfirm)) return
                void fetch(`/api/library/${e.id}`, { method: "DELETE" }).then((res) => {
                  if (res.ok) removeCommunityItem(e.id)
                })
              }}
            >
              {t.library.deletePublished}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

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
        onFocusCapture={onFocusCapture}
        className={LIBRARY_SHELL}
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 bg-zinc-950 px-4 py-2 text-left">
          <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-blue-400" />
            {t.effectLibrary.title}
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
          {onEdit && (
          <button
            onClick={startNew}
            className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
          >
            <Plus className="size-3.5" />
            {t.effectLibrary.newEffect}
          </button>
          )}
          <DialogClose className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
            <X className="size-4" />
            <span className="sr-only">{t.library.close}</span>
          </DialogClose>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <LibraryRail items={all} facet={facet} onFacetChange={setFacet} tag={tag} onTagChange={setTag} isLiked={(i) => statFor(i.id).liked} />

          {/* Thumbnail grid + pinned "New effect" (the graph library's New-graph idiom */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* THE SHELVES. 38 · 38 · 20 to start, then wherever you drag them — the
              split is per library and remembered; see LibraryShelves.

              A share can only aim: it is a fraction of a dialog measured in dvh,
              while a card row is a fraction of the column WIDTH (a 16:10
              thumbnail in one of five tracks) plus a label. The two are
              unrelated, so any share lands mid-card on some screen. That is now
              the reader's to fix by dragging, which is most of why the handles
              are here; holding a whole row COUNT instead still wants the
              measurement parked in library-rail.tsx — see useShelfCap. */}
          <LibraryShelves id="effect" hasLocal={localRows.length > 0}>
          <LibraryShelf id="builtin" defaultSize="38">
            <div className="shrink-0 px-3 pt-2 pb-1.5 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              {t.rail.builtin}
              <ShelfCount n={builtinRows.length} />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div data-shelf-grid className={cn(LIBRARY_GRID, "grid-cols-5 pb-1.5")}>
                {builtinRows.map(renderCard)}
                {rows.length === 0 && (
                  <div className="col-span-full py-16 text-center text-xs text-muted-foreground">
                    {facet === "yours" && !query ? t.rail.yoursEmpty : t.library.noMatch(query)}
                  </div>
                )}
              </div>
            </ScrollArea>
          </LibraryShelf>

          {/* Community is PINNED, like drafts, rather than scrolling below the
              built-ins. Both headers show even when empty: an empty Community is
              the only place in the app that says publishing is a thing you can
              do, and a section you must scroll to find cannot make that ask at
              all. Local stays conditional — your own drafts, and an empty one
              tells you nothing you did not know. */}
          <ShelfHandle />
          <LibraryShelf id="community" defaultSize="38">
            <div className="shrink-0 px-3 pt-2 pb-1.5 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{t.rail.community}
              <ShelfCount n={communityRows.length} />
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {communityRows.length > 0 ? (
                <div data-shelf-grid className={cn(LIBRARY_GRID, "grid-cols-5")}>{communityRows.map(renderCard)}</div>
              ) : (
                <div className="px-3 pb-3 text-xs text-muted-foreground/70">{t.rail.communityEmpty}</div>
              )}
            </ScrollArea>
          </LibraryShelf>
          {localRows.length > 0 && (
            <>
              <ShelfHandle />
              <LibraryShelf id="local" defaultSize="20">
              <div className="flex shrink-0 items-center justify-between px-3 pt-1.5 pb-1.5">
                <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{t.rail.local}
                  <ShelfCount n={localRows.length} />
                </span>
                {/* Clears exactly what is LISTED, not every draft of this kind — a
                    search or facet can be narrowing this section, and wiping rows
                    you cannot see is not something a visible count can warn about.
                    Unpublished work has no server copy, hence the confirm. */}
                <button
                  type="button"
                  disabled={clearable.length === 0}
                  title={clearable.length === 0 ? t.library.clearLocalNone : undefined}
                  onClick={() => {
                    const kept = localRows.length - clearable.length
                    const ask = t.library.clearLocalConfirm(clearable.length) + (kept > 0 ? t.library.clearLocalKept(kept) : "")
                    if (!confirm(ask)) return
                    clearDrafts(clearable.map((d) => d.id))
                  }}
                  className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-white/5 hover:text-red-400 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
                >
                  {t.library.clearLocal}
                </button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div data-shelf-grid className={cn(LIBRARY_GRID, "grid-cols-5")}>{localRows.map(renderCard)}</div>
              </ScrollArea>
            </LibraryShelf>
            </>
          )}
          </LibraryShelves>
          </div>

          {/* Inspector: preview · meta · params · Apply (pinned, but the column scrolls */}
          <div className="flex w-[15rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[17rem]">
            {selected && draft ? (
              <>
                <div className="p-3 pb-0">
                  {/* The preview IS the edit affordance, exactly like the graph library */}
                  <button
                    type="button"
                    disabled={!onEdit}
                    onClick={() => onEdit?.(draft)}
                    className="group/prev relative block aspect-[16/10] w-full overflow-hidden rounded-md border border-white/10"
                  >
                    {/* The draft's code, not the def's — a forked/edited effect previews as forked. */}
                    <EffectPreview wgsl={draft.wgsl} />
                    <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                      <SquarePen className="size-4" />
                      {t.effectLibrary.editShader}
                    </div>
                  </button>
                </div>
                <div className="min-h-0 p-3">
                  <div className="truncate text-sm font-semibold select-text">{selected.name}</div>
                  <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                    <span className="select-text">{builtinAuthor("effect", selected.name, selected.author)}</span> · v{selected.version}
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground select-text">{selected.description}</p>
                  <LibraryTags tags={selected.tags} />
                  <LibraryItemStats
                    likeCount={statFor(selected.id).likeCount}
                    liked={statFor(selected.id).liked}
                    canLike={signedIn && selected.owner !== "local"}
                    scenes={statFor(selected.id).scenes}
                    onToggle={() => void toggleLike(selected.id)}
                  />
                </div>

                {/* Pinned action: red destructive Remove when applied (the counterpart of the blue Apply) */}
                <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                {selected.owner === "local" && (
                  <PublishButton
                    kind="effect"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    itemId={draftOrigin("effect", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("effect", selected.id).forkedFromId}
                    className="h-8 w-full"
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
                      noteItemPublished(item.id)
                      removeDraft(selected.id)
                      onRenamed?.(selected.name, item.name)
                    }}
                  />
                )}
                  {isAppliedSelected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onRemove}
                      className="h-8 w-full border-white/10 bg-white/5 text-xs font-medium hover:bg-white/10"
                    >
                      <X className="size-3.5" />
                      {t.effectLibrary.remove}
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
                      <Check className="size-3.5" />
                      {t.effectLibrary.apply}
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
