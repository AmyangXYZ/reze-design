"use client"

// Shader-graph library — the shared dock on the right of the cover (library-shell).

import { toast } from "sonner"
import { useCallback, useMemo, useState } from "react"
import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DETAIL_ACTION,
  LibraryDock,
  LibraryCards,
  LibraryDetail,
  useLibraryBrowse,
  type BrowseFacet,
  type CardMeta,
  VisibilityMenu,
  useMakePublic,
  itemState,
  RenameField,
} from "@/components/editor/library-shell"
import { conflictingName, nameKey, normalizeName, type GraphItem } from "@/lib/library"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useReport } from "@/hooks/use-report"
import { draftOrigin } from "@/lib/drafts"
import { useCommunity } from "@/hooks/use-community"
import { useBuiltins } from "@/hooks/use-builtins"
import {
  addCommunityItem,
  isMine,
  removeCommunityItem,
  setCommunityVisibility,
} from "@/lib/community-store"
import { useDrafts } from "@/hooks/use-drafts"
import { noteItemPublished, useLibraryStats } from "@/hooks/use-library-stats"
import { useZOrder } from "@/hooks/use-z-order"
import { PublishButton } from "@/components/editor/publish-button"
import { builtinDescription, builtinName, builtinSearchText } from "@/lib/builtin-text"
import { useI18n } from "@/lib/i18n"


type LibraryProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Facet the library opens on — the account tab opens straight to "yours". */
  initialFacet?: BrowseFacet
  /** The style group a pick lands on: the one chosen in the Materials pane
   *  beside the library. Null while none is, and picking only reads. */
  targetId: string | null
  /** The chosen group's name, said under the title. */
  targetLabel: string | null
  /** Open the standalone graph editor — a library act, never gated on a group. */
  /** Absent where the node editor is not offered (touch): the library still
   *  browses and applies. */
  onEdit?: (id: string, name: string, graph: ShaderGraph) => void
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
  return props.open ? <LibraryContent {...props} /> : null
}

function LibraryContent({ targetId, targetLabel, currentGraphName, usedNames = [], onApply, onRenamed, onEdit, onOpenChange, initialFacet, freshDraftId }: LibraryProps) {
  const onClose = () => onOpenChange(false)
  const { t, locale } = useI18n()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { drafts, update: updateDraft, remove: removeDraft } = useDrafts<GraphItem>("graph")
  // Built-ins lead in name order; drafts follow in creation order.
  const builtins = useBuiltins("graph")
  const community = useCommunity<GraphItem>("graph")
  const ROWS = useMemo(
    // Built-ins carry no idea who is asking; the fetched rows do.
    () => [...builtins.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [builtins, community, drafts],
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

  // The group chosen in the Materials pane beside the library: its graph is
  // the one shown, and brought into view, whenever the choice moves.
  // Choosing another GROUP is what moves it; a pick here changes what the
  // group wears, and the shelf stays where it was.
  const [seenTarget, setSeenTarget] = useState(targetId)
  const [reveal, setReveal] = useState<string | null>(() => ROWS.find(isCurrent)?.id ?? null)
  if (targetId !== seenTarget) {
    setSeenTarget(targetId)
    const wearing = ROWS.find(isCurrent)
    if (wearing) {
      setSelectedId(wearing.id)
      setReveal(wearing.id)
    }
  }

  const numbers = useCallback(
    (id: string) => {
      const st = statFor(id)
      return { likes: st.likeCount, uses: st.scenes, liked: st.liked, trend: st.trend }
    },
    [statFor],
  )
  // Built-in names and descriptions are chrome and translate; the library ranks,
  // searches and sorts on what the reader sees, and answers to either language.
  const displayName = useCallback((r: (typeof ROWS)[number]) => builtinName("graph", r, locale), [locale])
  const searchText = useCallback((r: (typeof ROWS)[number]) => builtinSearchText("graph", r), [])
  const browse = useLibraryBrowse(ROWS, numbers, { initialFacet, displayName, searchText })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The name someone typed that is already in use. Rename REFUSES rather than
  // silently saving under "… 2": a suffix you did not ask for is how a library
  // fills up with things whose names mean nothing.
  const [renameError, setRenameError] = useState<string | null>(null)
  const report = useReport()
  /** Which row a delete is being confirmed for, and whether it is a local
   *  draft or a published row — the two ask different questions. */
  // Private → public is permanent, so it asks first (useMakePublic).
  const makePublic = useMakePublic()
  const [confirming, setConfirming] = useState<{ id: string; draft: boolean } | null>(null)
  const commitRename = (item: GraphItem, raw: string) => {
    const wanted = normalizeName(raw)
    if (!wanted || wanted === item.name) {
      setRenamingId(null)
      setRenameError(null)
      return
    }
    const clash = conflictingName(
      wanted,
      [...builtins, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
    )
    if (clash) {
      // Stays in edit mode with the message attached, so the fix is one keystroke
      // away rather than a rename that silently did something else.
      setRenameError(t.library.nameTakenBy(clash))
      toast.error(t.library.nameTakenBy(clash))
      return
    }
    setRenamingId(null)
    setRenameError(null)
    const name = wanted
    updateDraft(item.id, { name, payload: { graph: { ...item.payload.graph, name } } })
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
    preview: null,
    applied: isCurrent(r),
    nameNode:
      renamingId === r.id ? (
        <RenameField
          name={r.name}
          error={!!renameError}
          onCommit={(value) => commitRename(r, value)}
          onCancel={() => {
            setRenameError(null)
            setRenamingId(null)
          }}
          onEdit={() => renameError && setRenameError(null)}
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
        <ContextMenuContent className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
          {onEdit && (
            <ContextMenuItem onSelect={() => onEdit(r.id, r.name, r.payload.graph)}>{t.library.editGraph}</ContextMenuItem>
          )}
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
                setConfirming({ id: r.id, draft: true })
              }}
            >
              {inUse(r) ? t.library.deleteInUse : t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <VisibilityMenu
              current={r.visibility ?? "public"}
              onMakePublic={() =>
                makePublic.ask(() => {
                  void fetch(`/api/library/${r.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ visibility: "public" }),
                  }).then(async (res) => {
                    if (await report(Promise.resolve(res), t.library.madePublic)) setCommunityVisibility(r.id, "public")
                  })
                })
              }
            />
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => setConfirming({ id: r.id, draft: false })}
            >
              {t.library.deletePublished}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
    </ContextMenu>
    )
  }

  // PICKING IS TRYING: with a group to land on, a picked card goes straight
  // onto it and the canvas shows it. With none yet, picking only reads.
  const pick = (r: GraphItem) => {
    setSelectedId(r.id)
    if (targetId && !isCurrent(r)) onApply(r.payload.graph, r.name)
  }

  return (
    <LibraryDock
      title={t.library.title}
      browse={browse}
      onClose={onClose}
      // What a pick lands on, or where to choose it: the Materials pane.
      context={
        targetLabel ? (
          <>
            {t.library.onGroup}{" "}
            <span className="underline decoration-blue-400 decoration-[1.5px] underline-offset-3">{targetLabel}</span>
          </>
        ) : (
          t.library.chooseGroupLeft
        )
      }
      onNew={onEdit && (() => onEdit("", t.library.newGraph, structuredClone(DEFAULT_GRAPH)))}
      z={z}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      detail={
        selected && (
          <LibraryDetail
            name={displayName(selected)}
            author={selected.author}
            draft={itemState(selected) === "draft"}
            like={
              itemState(selected) === "draft"
                ? undefined
                : {
                    count: statFor(selected.id).likeCount,
                    liked: statFor(selected.id).liked,
                    canLike: signedIn,
                    onToggle: () => void toggleLike(selected.id),
                  }
            }
            description={selected.description ? builtinDescription("graph", selected, locale) : undefined}
            actions={
              <>
                {onEdit && (
                  <Button variant="bare" onClick={() => onEdit(selected.id, selected.name, selected.payload.graph)} className={DETAIL_ACTION}>
                    <PenLine />
                    {t.lab.ctl.edit}
                  </Button>
                )}
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
                    className={DETAIL_ACTION}
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
                      noteItemPublished(item.id)
                      removeDraft(selected.id)
                    }}
                  />
                )}
              </>
            }
          />
        )
      }
      cards={
        <LibraryCards<(typeof ROWS)[number]>
          rows
          reveal={reveal}
          watch={["community", "library-stats"]}
          browse={browse}
          selectedId={selectedId}
          onSelect={pick}
          meta={meta}
          displayName={displayName}
          wrap={wrap}
          empty={browse.query ? t.library.noMatch(browse.query) : t.rail.yoursEmpty}
        />
      }
    >
      {makePublic.dialog}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming?.draft ? t.library.deleteDraft : t.library.deletePublished}
        body={confirming?.draft ? t.library.deleteDraftConfirm : t.library.deletePublishedConfirm}
        confirmLabel={t.library.deleteConfirmLabel}
        cancelLabel={t.library.cancel}
        onConfirm={() => {
          const target = confirming
          setConfirming(null)
          if (!target) return
          // A draft is local; there is nothing to report and nothing to refuse.
          if (target.draft) return removeDraft(target.id)
          void report(fetch(`/api/library/${target.id}`, { method: "DELETE" }), t.library.deleted).then(
            (ok) => ok && removeCommunityItem(target.id),
          )
        }}
      />
    </LibraryDock>
  )
}
