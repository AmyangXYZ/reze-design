"use client"

// Shader-graph library — the shared library shell (facet rail · thumbnail grid · slim inspector).

import { useCallback, useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { Check, Plus, SquarePen, Workflow, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { LIBRARY_SHELL, LibraryItemStats, LibraryTags } from "@/components/editor/library-rail"
import {
  LibraryRailFilters,
  LibraryResults,
  LibraryToolbar,
  useLibraryBrowse,
  type BrowseFacet,
  type CardMeta,
  AuthorAvatar,
  VisibilityMenu,
  publishedOn,
} from "@/components/editor/library-shell"
import { conflictingName, nameKey, normalizeName, type GraphItem } from "@/lib/library"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { draftOrigin } from "@/lib/drafts"
import {
  addCommunityItem,
  builtinAuthor,
  isMine,
  removeCommunityItem,
  setCommunityVisibility,
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
  initialFacet?: BrowseFacet
  /** Whether a target group exists yet for the material. */
  /** Every group a graph could be applied to, and which one it would land on.
   *  The library CHOOSES the target rather than requiring one to have been
   *  chosen before it opened — browsing looks and deciding what wears them are
   *  the same act, and splitting them across two surfaces made the library
   *  reachable only from a popover about the graph you already had. */
  groups: { id: string; label: string }[]
  targetId: string | null
  onTargetChange: (id: string) => void
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

function LibraryContent({ groups, targetId, onTargetChange, targetLabel, currentGraphName, usedNames = [], onApply, onRenamed, onEdit, onOpenChange, initialFacet, freshDraftId }: LibraryProps) {
  const onClose = () => onOpenChange(false)
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { drafts, update: updateDraft, remove: removeDraft } = useDrafts<GraphItem>("graph")
  // Built-ins lead in name order; drafts follow in creation order.
  const community = useCommunity<GraphItem>("graph")
  const ROWS = useMemo(
    // Bundled items carry no idea who is asking; the fetched rows do.
    () => [...GRAPH_LIBRARY.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [community, drafts],
  )
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, onClose)
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

  const numbers = useCallback(
    (id: string) => {
      const st = statFor(id)
      return { likes: st.likeCount, uses: st.scenes, liked: st.liked }
    },
    [statFor],
  )
  const browse = useLibraryBrowse(ROWS, numbers, { initialFacet })
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
  const selected = useMemo(() => ROWS.find((r) => r.id === selectedId) ?? null, [ROWS, selectedId])

  // A draft a group in this scene is wearing cannot be deleted — the same rule as
  // an open file. Deleting it would not change the render (the scene carries the
  // graph by value), it would just strand the look: named after something no
  // library holds, and adopted straight back as a draft on the next load. So
  // "Clear all" appeared to keep things it had deleted. Publishing is exempt,
  // and is the way one of these leaves Local: it takes the same name with it.
  const used = useMemo(() => new Set(usedNames.map(nameKey)), [usedNames])
  const inUse = (r: GraphItem) => r.owner === "local" && used.has(nameKey(r.name))

  const meta = (r: GraphItem): CardMeta => ({
    preview: <GraphMinimap graph={r.payload.graph} />,
    applied: isCurrent(r),
    nameNode:
      renamingId === r.id ? (
        <Input
          autoFocus
          defaultValue={r.name}
          className={cn(
            "h-5 min-w-0 flex-1 border-line-strong bg-white/5 px-1 text-[13px] md:text-[13px]",
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
      ) : undefined,
  })

  // One menu on every card: right-click is the discoverable route to editing
  // (double-click still works). Rename and delete only where they apply.
  const wrap = (r: GraphItem, node: React.ReactNode) => {
    const isDraft = r.owner === "local"
    const mine = (r as { mine?: boolean }).mine === true
    return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{node}</div>
      </ContextMenuTrigger>
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
            <VisibilityMenu
              current={r.visibility ?? "public"}
              onChange={(next) => {
                void fetch(`/api/library/${r.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ visibility: next }),
                }).then((res) => res.ok && setCommunityVisibility(r.id, next))
              }}
            />
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
        <DialogTitle className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Workflow className="size-4 text-blue-400" />
          {t.library.title}
        </DialogTitle>
        <LibraryToolbar browse={browse} usedLabel={t.rail.used} />
        {/* Creation lives in the header. Just "New": the title says the kind. */}
        <button
          onClick={() => onEdit("", t.library.newGraph, structuredClone(DEFAULT_GRAPH))}
          className="flex h-6 shrink-0 items-center gap-1 rounded-chip border border-line-strong bg-white/5 px-2 text-[11px] font-medium transition-colors hover:bg-white/10"
        >
          <Plus className="size-3" />
          {t.library.new}
        </button>
        <DialogClose className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
          <X className="size-3.5" />
          <span className="sr-only">{t.library.close}</span>
        </DialogClose>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        <LibraryRailFilters browse={browse} />

        {/* ONE ranked list. No shelves: a built-in is a preset the admin
            account published, so splitting the grid by provenance sorted by who
            rather than by what. The rail still filters by maker. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LibraryResults
            browse={browse}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
            onActivate={(r) => onEdit(r.id, r.name, r.payload.graph)}
            meta={meta}
            numbers={numbers}
            wrap={wrap}
            usedLabel={t.rail.used}
            empty={browse.query ? t.library.noMatch(browse.query) : t.rail.yoursEmpty}
          />
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
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <AuthorAvatar name={builtinAuthor(selected.id, selected.author)} className="size-3.5" />
                  <span className="truncate select-text">{builtinAuthor(selected.id, selected.author)}</span>
                  {/* When it went public, the same fact the gallery's panel shows. */}
                  {publishedOn(selected.createdAt) && <span className="shrink-0">· {publishedOn(selected.createdAt)}</span>}
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
                    currentVisibility={selected.visibility}
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
                {/* WHAT it lands on, right above the button that lands it.
                    Nothing has to be selected before opening the library now. */}
                {groups.length > 0 && (
                  <Select value={targetId ?? ""} onValueChange={onTargetChange}>
                    <SelectTrigger
                      aria-label={t.library.applyToGroup}
                      className="h-8 w-full justify-between border-line-strong bg-white/5 text-xs"
                    >
                      <SelectValue placeholder={t.library.applyToGroup} />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id} className="text-xs">
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  disabled={!targetId}
                  onClick={() => onApply(selected.payload.graph, selected.name)}
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-40"
                >
                  <Check className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {targetLabel ? t.library.applyTo(targetLabel) : t.library.applyToGroup}
                  </span>
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
