"use client"

// Shader-graph library — the shared library shell (facet rail · thumbnail grid · slim inspector).

import { useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { Check, Plus, Search, SquarePen, Workflow, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { LIBRARY_GRID, LIBRARY_SHELL, LibraryItemStats, LibraryRail, LibraryShelf, LibraryShelves, LibraryStats, LibraryTags, ShelfCount, ShelfHandle } from "@/components/editor/library-rail"
import {
  conflictingName,
  matchesFacet,
  matchesQuery,
  nameKey,
  normalizeName,
  type GraphItem,
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
  /** Whether a target group exists yet for the material. */
  canApply: boolean
  /** Display name of the group Apply targets — null when opened with none. */
  targetLabel: string | null
  /** Open the standalone graph editor — a library act, never gated on a group. */
  onEdit: (id: string, name: string, graph: ShaderGraph) => void
  /** The group's currently-applied shader graph (pre-selected + tagged "current"). */
  currentGraphName: string | null
  /** Every look this scene is wearing, across all models. A draft one of them is
   *  built on cannot be deleted — see `inUse` below. */
  usedNames?: string[]
  /** `edit` pops the shader-graph editor on the fork so the user can customize it. */
  onApply: (graph: ShaderGraph, name: string) => void
  /** A draft was renamed — re-point the groups wearing it, or the scene keeps
   *  calling the look by a name the library no longer has. */
  onRenamed?: (oldName: string, newName: string) => void
  /**
   * A draft just made from this library, to open selected.
   *
   * Editing a built-in or a community graph from here saves a LOCAL COPY and
   * applies it to nothing — there may be no group to apply it to. So the usual
   * rule (select what the group is wearing) has nothing to say about it, and the
   * library reopened on the original, leaving the copy you had just made to be
   * hunted for on the Local shelf.
   */
  freshDraftId?: string | null
}

export function NodeLibrary(props: LibraryProps) {
  return (
    // Non-modal + no backdrop so it coexists with the (higher-z) floating editor
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

function LibraryContent({ canApply, targetLabel, currentGraphName, usedNames = [], onApply, onRenamed, onEdit, onOpenChange, initialFacet, freshDraftId }: LibraryProps) {
  const onClose = () => onOpenChange(false)
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { drafts, update: updateDraft, remove: removeDraft, clear: clearDrafts } = useDrafts<GraphItem>("graph")
  // Built-ins lead in name order; drafts follow in creation order.
  const community = useCommunity<GraphItem>("graph")
  const ROWS = useMemo(
    // Bundled items carry no idea who is asking; the fetched rows do.
    () => [...GRAPH_LIBRARY.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [community, drafts],
  )
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, onClose)
  const [query, setQuery] = useState("")
  const [facet, setFacet] = useState<LibraryFacet>(initialFacet ?? "all")
  const [tag, setTag] = useState<string | null>(null)
  const isCurrent = (r: GraphItem) => r.name === currentGraphName || r.payload.graph.name === currentGraphName
  // Opened FROM a group, the group's own graph is selected — that is the thing
  // you came to look at. Opened from the library button there is no such thing,
  // and falling through to the first row selected Body every time: a detail
  // panel about an item nobody asked for, and one stray Enter from applying it.
  // A draft just saved from here wins: it is the most recent thing you did, and
  // the reason you are looking at this library again.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => freshDraftId ?? ROWS.find(isCurrent)?.id ?? null,
  )
  // Adjusted during render rather than in an effect, because the library is
  // NEVER unmounted for this: the editor opens ABOVE it and saving happens with
  // this list still on screen behind it, so the initial state above only covers
  // the case where the library was closed the whole time. React supports exactly
  // this shape for "a prop changed and some state derived from it must move".
  const [seenFresh, setSeenFresh] = useState<string | null>(freshDraftId ?? null)
  if (freshDraftId && freshDraftId !== seenFresh) {
    setSeenFresh(freshDraftId)
    setSelectedId(freshDraftId)
  }

  // Filtering only — each section below sorts by what that section is FOR, and
  // one order across all three would either scramble the built-ins or bury the
  // newest community work.
  const rows = useMemo(
    () => ROWS.filter((r) => matchesFacet(r, facet, statFor(r.id).liked) && (!tag || r.tags.includes(tag)) && matchesQuery(r, query)),
    [ROWS, query, facet, tag, statFor],
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The name someone typed that is already in use. Rename REFUSES rather than
  // silently saving under "… 2": a suffix you did not ask for is how a library
  // fills up with things whose names mean nothing.
  const [renameError, setRenameError] = useState<string | null>(null)
  const commitRename = (item: GraphItem, raw: string) => {
    const wanted = normalizeName(raw)
    if (!wanted || wanted === item.name) {
      setRenamingId(null)
      setRenameError(null)
      return
    }
    const clash = conflictingName(
      wanted,
      [...GRAPH_LIBRARY, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
    )
    if (clash) {
      // Stays in edit mode with the message attached, so the fix is one keystroke
      // away rather than a rename that silently did something else.
      setRenameError(t.library.nameTakenBy(clash))
      return
    }
    setRenamingId(null)
    setRenameError(null)
    const name = wanted
    if (item.owner === "local") updateDraft(item.id, { name, payload: { graph: { ...item.payload.graph, name } } })
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

  // Built-ins in DECLARATION order, not by name: the shelf holds two sets — the
  // character looks first, then the stage materials — and sorting alphabetically
  // interleaved them, so Brick sat between Body and Concrete and neither set
  // read as a set. Declaration order is just as fixed as alphabetical, which is
  // the property that matters: a curated shelf you learn the shape of must not
  // move under you.
  const builtinRows = useMemo(() => rows.filter((x) => x.owner === "builtin"), [rows])
  // Community in server order, which is newest first — nobody knows these names,
  // so recency is the only signal there is.
  const communityRows = useMemo(() => rows.filter((x) => x.owner === "user"), [rows])
  const localRows = useMemo(() => rows.filter((x) => x.owner === "local"), [rows])
  const selected = useMemo(() => ROWS.find((r) => r.id === selectedId) ?? null, [ROWS, selectedId])

  // A draft a group in this scene is wearing cannot be deleted — the same rule as
  // an open file. Deleting it would not change the render (the scene carries the
  // graph by value), it would just strand the look: named after something no
  // library holds, and adopted straight back as a draft on the next load. So
  // "Clear all" appeared to keep things it had deleted. Publishing is exempt,
  // and is the way one of these leaves Local: it takes the same name with it.
  const used = useMemo(() => new Set(usedNames.map(nameKey)), [usedNames])
  const inUse = (r: GraphItem) => r.owner === "local" && used.has(nameKey(r.name))
  const clearable = localRows.filter((r) => !inUse(r))

  const renderCard = (r: GraphItem) => {
    const sel = r.id === selectedId
    const card = (
                  <div
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
                    onDoubleClick={() => onEdit(r.id, r.name, r.payload.graph)}
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
                      <div className="flex items-center gap-1.5">
                        {renamingId === r.id ? (
                          <Input
                            autoFocus
                            defaultValue={r.name}
                            className={cn(
                              "h-5 min-w-0 flex-1 border-white/10 bg-white/5 px-1 text-xs md:text-xs",
                              renameError && "border-red-400/60",
                            )}
                            onClick={(ev) => ev.stopPropagation()}
                            onChange={() => renameError && setRenameError(null)}
                            onBlur={(ev) => commitRename(r, ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur()
                              if (ev.key === "Escape") {
                                setRenameError(null)
                                setRenamingId(null)
                              }
                            }}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.name}</span>
                        )}
                        <LibraryStats
                          likeCount={statFor(r.id).likeCount}
                          liked={statFor(r.id).liked}
                        />
                      </div>
                      {renamingId === r.id && renameError && (
                        <p className="mt-1 text-[10px] leading-tight text-red-400">{renameError}</p>
                      )}
                    </div>
                  </div>
    )
    // One menu on every card: right-click is the discoverable route to editing
    // (double-click still works). Rename and delete only where they apply.
    const isDraft = r.owner === "local"
    const mine = (r as { mine?: boolean }).mine === true
    return (
      <ContextMenu key={r.id}>
        <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => onEdit(r.id, r.name, r.payload.graph)}>{t.library.editGraph}</ContextMenuItem>
          {isDraft && (
            <ContextMenuItem
              onSelect={() => {
                setRenameError(null)
                setRenamingId(r.id)
              }}
            >
              {t.graph.rename}
            </ContextMenuItem>
          )}
          {isDraft && (
            <ContextMenuItem
              variant="danger"
              disabled={inUse(r)}
              onSelect={() => {
                if (confirm(t.library.deleteDraftConfirm)) removeDraft(r.id)
              }}
            >
              {inUse(r) ? t.library.deleteInUse : t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <ContextMenuItem onSelect={() => setRenamingId(r.id)}>{t.graph.rename}</ContextMenuItem>
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => {
                if (!confirm(t.library.deletePublishedConfirm)) return
                void fetch(`/api/library/${r.id}`, { method: "DELETE" }).then((res) => {
                  if (res.ok) removeCommunityItem(r.id)
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
      // sm:max-w repeat is load-bearing (DialogContent base carries sm:max-w-lg).
      style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        onFocusCapture={onFocusCapture}
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
          onClick={() => onEdit("", t.library.newGraph, structuredClone(DEFAULT_GRAPH))}
          className="flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
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
        <LibraryRail items={ROWS} facet={facet} onFacetChange={setFacet} tag={tag} onTagChange={setTag} isLiked={(i) => statFor(i.id).liked} />

        {/* ── Minimap grid ── */}
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
          <LibraryShelves id="graph" hasLocal={localRows.length > 0}>
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
              do, and a section you have to scroll to find cannot make that ask
              at all. Local stays conditional — your own drafts, and an empty one
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
                    Drafts this scene is wearing are kept and SAID to be kept, so a
                    shelf that isn't empty afterwards is explained rather than
                    suspicious. Unpublished work has no server copy, hence the confirm. */}
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

        {/* ── Inspector: preview (= fork-&-edit) · meta · Apply pinned ── */}
        <div className="flex w-[15rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[17rem]">
          {selected ? (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance */}
                <button
                  type="button"
                  onClick={() => onEdit(selected.id, selected.name, selected.payload.graph)}
                  className="group/prev relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-md border border-white/10 bg-zinc-900/60 text-zinc-200"
                >
                  <GraphMinimap graph={selected.payload.graph} className="h-full w-full p-2" />
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                    <SquarePen className="size-4" />
                    {t.library.editGraph}
                  </div>
                </button>
              </div>
              <div className="min-h-0 p-3">
                <div className="truncate text-sm font-semibold select-text">{selected.name}</div>
                <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                  <span className="select-text">{builtinAuthor(selected.id, selected.author)}</span>
                </div>
                {selected.description && (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground select-text">{selected.description}</p>
                )}
                <LibraryTags tags={selected.tags} />
                <LibraryItemStats
                  likeCount={statFor(selected.id).likeCount}
                  liked={statFor(selected.id).liked}
                  canLike={signedIn && selected.owner !== "local"}
                  scenes={statFor(selected.id).scenes}
                  onToggle={() => void toggleLike(selected.id)}
                />
              </div>
              <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                {selected.owner === "local" && (
                  <PublishButton
                    kind="graph"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    itemId={draftOrigin("graph", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("graph", selected.id).forkedFromId}
                    className="h-8 w-full"
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
                      noteItemPublished(item.id)
                      removeDraft(selected.id)
                      
                    }}
                  />
                )}
                <Button
                  size="sm"
                  disabled={!canApply}
                  onClick={() => onApply(selected.payload.graph, selected.name)}
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
                >
                  <Check className="size-3.5 shrink-0" />
                  <span className="truncate">{canApply && targetLabel ? t.library.applyTo(targetLabel) : t.library.selectGroupFirst}</span>
                </Button>
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
