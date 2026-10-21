"use client"

// Effects library — the shared dock on the right of the cover (library-shell).
//
// Named for what the items ARE, not for where the first ones happened to sit. The
// kind has been `effect` in the envelope, the database and the publish route since
// they existed; only the UI still said "background", and an effect has not been
// confined to the background since it learned where the cast is. The scene
// document's own `settings.background.effect` keeps its name — that shape is frozen
// once scenes are in the wild, and it is still literally where the effect is layered.

import { toast } from "sonner"
import { useCallback, useMemo, useState } from "react"
import { PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  applyDefaults,
  EFFECTS,
  NEW_EFFECT_TEMPLATE,
  type AppliedEffect,
} from "@/lib/effects"
import { EffectPreview } from "@/components/editor/effect-preview"
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
import { conflictingName, normalizeName, type EffectItem } from "@/lib/library"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useReport } from "@/hooks/use-report"
import { draftOrigin } from "@/lib/drafts"
import { useCommunity } from "@/hooks/use-community"
import {
  addCommunityItem,
  builtinAuthor,
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
  /** Every effect the scene wears, in layer order. Membership, not a
   *  selection: applying adds and applying again takes off. */
  applied: AppliedEffect[]
  onApply: (effect: AppliedEffect) => void
  /** A draft was renamed — re-point anything applied by the old name. */
  onRenamed?: (oldName: string, newName: string) => void
  onRemove: (id: string) => void
  /** The effect chosen in the Effect pane beside the library: shown when it changes. */
  focusId?: string | null
  /** Open the page-level floating WGSL editor on this effect (independent panel, same idiom
   *  as the graph editor). Optional: a host without the editor omits it, and
   *  every edit/new affordance hides rather than sitting there doing nothing. */
  onEdit?: (effect: AppliedEffect) => void
}

export function EffectLibrary(props: LibraryProps) {
  // Mounted fresh per open: browsing state (query/facet/selection/draft) seeds itself.
  return props.open ? <LibraryContent {...props} /> : null
}

/** Seed the inspector's param draft */
/** The card's own applied entry when the scene wears it — so opening the editor
 *  on a card edits what is RUNNING rather than the library's pristine copy. */
const appliedById = (applied: AppliedEffect[], id: string | undefined) => applied.find((e) => e.id === id) ?? null

const seedDraft = (selected: EffectItem | null, applied: AppliedEffect[]): AppliedEffect | null =>
  selected ? ({ ...(appliedById(applied, selected.id) ?? applyDefaults(selected)) }) : null

function LibraryContent({ onOpenChange, initialFacet, applied, onApply, onRemove, onRenamed, onEdit, focusId = null }: LibraryProps) {
  const { t, locale } = useI18n()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { statFor } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? applied[0]?.id ?? EFFECTS[0]?.id ?? null)
  // Follow a layer when one is ADDED — creating or editing one should move the
  // selection with it, rather than leaving the ring on the previous entry. A
  // removal leaves the selection where it is: the detail stays on what you
  // just took off, ready to put back.
  const [lastApplied, setLastApplied] = useState(() => applied.map((a) => a.id))
  if (applied.length !== lastApplied.length || applied.some((a, i) => a.id !== lastApplied[i])) {
    setLastApplied(applied.map((a) => a.id))
    const added = applied.findLast((a) => !lastApplied.includes(a.id))
    if (added) setSelectedId(added.id)
  }

  const [seenFocus, setSeenFocus] = useState(focusId)
  if (focusId !== seenFocus) {
    setSeenFocus(focusId)
    if (focusId) setSelectedId(focusId)
  }

  const { drafts, update: updateDraft, remove: removeDraft } = useDrafts<EffectItem>("effect")
  // Built-ins lead in name order; drafts follow in creation order.
  const community = useCommunity<EffectItem>("effect")
  const all = useMemo(
    // Bundled items carry no idea who is asking; the fetched rows do.
    () => [...EFFECTS.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [community, drafts],
  )
  const selected: EffectItem | null = useMemo(() => all.find((e) => e.id === selectedId) ?? null, [all, selectedId])
  // Draft = what Apply applies for the current selection.
  const [draft, setDraft] = useState<AppliedEffect | null>(() => seedDraft(selected, applied))
  const [draftFor, setDraftFor] = useState(selectedId)
  if (selectedId !== draftFor) {
    setDraftFor(selectedId)
    setDraft(seedDraft(selected, applied))
  }

  // Likes and usage live in the stats snapshot, keyed by id — the library reads
  // them through here rather than keeping a second copy that could disagree.
  const numbers = useCallback(
    (id: string) => {
      const s = statFor(id)
      return { likes: s.likeCount, uses: s.scenes, liked: s.liked, trend: s.trend }
    },
    [statFor],
  )
  // Built-in names and descriptions are chrome and translate; the library ranks,
  // searches and sorts on what the reader sees, and answers to either language.
  const displayName = useCallback((e: EffectItem) => builtinName("effect", e, locale), [locale])
  const searchText = useCallback((e: EffectItem) => builtinSearchText("effect", e), [])
  const browse = useLibraryBrowse(all, numbers, { initialFacet, displayName, searchText })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // A typed name that is already in use — see the graph library's commitRename.
  const [renameError, setRenameError] = useState<string | null>(null)
  const report = useReport()
  // Which row a delete is being confirmed for. A draft and a published row ask
  // different questions — one is local, the other is other people's scenes — so
  // the kind travels with the id rather than being re-derived when it opens.
  // Private → public is permanent, so it asks first (useMakePublic).
  const makePublic = useMakePublic()
  const [confirming, setConfirming] = useState<{ id: string; draft: boolean } | null>(null)
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
      [...EFFECTS, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
    )
    if (clash) {
      setRenameError(t.library.nameTakenBy(clash))
      toast.error(t.library.nameTakenBy(clash))
      return
    }
    setRenamingId(null)
    setRenameError(null)
    const name = wanted
    updateDraft(item.id, { name })
    onRenamed?.(item.name, name)
  }

  // The applied effect cannot be deleted — see the graph library's `inUse`.
  const inUse = (e: EffectItem) => e.owner === "local" && applied.some((a) => a.id === e.id)


  // "New effect": open the floating editor on the template. Nothing is created —
  // the editor is a scratchpad, and save-on-close is what makes a draft.
  const startNew = () => onEdit?.({ id: "", name: t.effectLibrary.newEffect, wgsl: NEW_EFFECT_TEMPLATE })

  // The card's picture and its two states. Everything structural — grid, list,
  // selection ring, the state badge — belongs to the shared results component.
  const meta = (e: EffectItem): CardMeta => ({
    preview: <EffectPreview wgsl={e.payload.wgsl} />,
    applied: applied.some((a) => a.id === e.id),
    nameNode:
      renamingId === e.id ? (
        <RenameField
          name={e.name}
          error={!!renameError}
          onCommit={(value) => commitRename(e, value)}
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
  const wrap = (e: EffectItem, node: React.ReactNode) => {
    const isDraft = e.owner === "local"
    const mine = (e as { mine?: boolean }).mine === true
    const startRename = () => {
      setRenameError(null)
      setRenamingId(e.id)
    }
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>{node}</div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
          {onEdit && (
            <ContextMenuItem onSelect={() => onEdit(seedDraft(e, applied)!)}>{t.effectLibrary.editShader}</ContextMenuItem>
          )}
          {isDraft && <ContextMenuItem onSelect={startRename}>{t.graph.rename}</ContextMenuItem>}
          {isDraft && (
            <ContextMenuItem
              variant="danger"
              disabled={inUse(e)}
              onSelect={() => {
                setConfirming({ id: e.id, draft: true })
              }}
            >
              {inUse(e) ? t.library.deleteInUse : t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <VisibilityMenu
              current={e.visibility ?? "public"}
              onMakePublic={() =>
                makePublic.ask(() => {
                  void fetch(`/api/library/${e.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ visibility: "public" }),
                  }).then(async (res) => {
                    if (await report(Promise.resolve(res), t.library.madePublic)) setCommunityVisibility(e.id, "public")
                  })
                })
              }
            />
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => setConfirming({ id: e.id, draft: false })}
            >
              {t.library.deletePublished}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  // PICKING IS TRYING: a card you pick goes on the scene, and the next one you
  // pick takes its place, so browsing is watching the canvas. What was on the
  // scene before the library opened stays put; clicking the picked card again
  // takes it off.
  const [trying, setTrying] = useState<string | null>(null)
  const pick = (e: EffectItem) => {
    // Clicking the picked card again takes it off.
    if (applied.some((a) => a.id === e.id)) {
      if (selectedId === e.id) {
        if (trying === e.id) setTrying(null)
        onRemove(e.id)
      }
      setSelectedId(e.id)
      return
    }
    setSelectedId(e.id)
    if (trying && trying !== e.id && applied.some((a) => a.id === trying)) onRemove(trying)
    onApply(seedDraft(e, applied)!)
    setTrying(e.id)
  }

  return (
    <LibraryDock
      title={t.effectLibrary.title}
      browse={browse}
      onClose={() => onOpenChange(false)}
      onNew={onEdit && startNew}
      z={z}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      detail={
        selected &&
        draft && (
          <LibraryDetail
            name={displayName(selected)}
            author={builtinAuthor(selected.id, selected.author)}
            draft={itemState(selected) === "draft"}
            description={builtinDescription("effect", selected, locale)}
            actions={
              <>
                {onEdit && (
                  <Button variant="bare" onClick={() => onEdit(draft)} className={DETAIL_ACTION}>
                    <PenLine />
                    {t.lab.ctl.edit}
                  </Button>
                )}
                {selected.owner === "local" && (
                  <PublishButton
                    kind="effect"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    currentVisibility={selected.visibility}
                    itemId={draftOrigin("effect", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("effect", selected.id).forkedFromId}
                    className={DETAIL_ACTION}
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
              </>
            }
          />
        )
      }
      cards={
        <LibraryCards
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
          // A draft lives on this device only, so there is nothing to report
          // and nothing that can refuse.
          if (target.draft) return removeDraft(target.id)
          void report(fetch(`/api/library/${target.id}`, { method: "DELETE" }), t.library.deleted).then(
            (ok) => ok && removeCommunityItem(target.id),
          )
        }}
      />
    </LibraryDock>
  )
}
