"use client"

// Grades library — the shared dock on the right of the cover (library-shell).

import { toast } from "sonner"
import { useCallback, useMemo, useState } from "react"
import { PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GradePreview } from "@/components/editor/grade-preview"
import type { GradeEditorSubject } from "@/components/editor/grade-editor"
import {
  NEUTRAL_NAME,
  NEW_GRADE_SPEC,
  type GradeSettings,
} from "@/lib/grade"
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
import { conflictingName, nameKey, normalizeName, type GradeItem } from "@/lib/library"
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useReport } from "@/hooks/use-report"
import { builtinDescription, builtinName, builtinSearchText } from "@/lib/builtin-text"
import { useI18n } from "@/lib/i18n"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Facet the library opens on — the account tab opens straight to "yours". */
  initialFacet?: BrowseFacet
  grade: GradeSettings
  /** Apply a built-in by id. */
  onApplyPreset: (id: string) => void
  /** A draft was renamed — re-point anything applied by the old name. */
  onRenamed?: (oldName: string, newName: string) => void
  /** Open the page-level floating grade editor (independent panel, same idiom as the graph
   *  editor). Optional: a host without the editor omits it, and every edit/new
   *  affordance hides rather than sitting there doing nothing. */
  onEdit?: (subject: GradeEditorSubject) => void
}

export function GradeLibrary(props: Props) {
  return props.open ? <LibraryContent {...props} /> : null
}

function LibraryContent({ onOpenChange, initialFacet, grade, onApplyPreset, onRenamed, onEdit }: Props) {
  const { t, locale } = useI18n()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  // By id, like the other libraries: keyed by name, a rename had a render where
  // the row already wore its new name and the selection still held the old one,
  // and the panel flashed the first grade. Null is "the grade the scene wears".
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Applying a grade elsewhere (the quick-pick, or the editor) moves the selection.
  const [lastPreset, setLastPreset] = useState(grade.preset)
  if (grade.preset !== lastPreset) {
    setLastPreset(grade.preset)
    setSelectedId(null)
  }

  // Built-in names are UI chrome and translate by id; descriptions are AUTHOR
  // text and stay as written, exactly as the effects library already shows them.
  const nameOf = (g: GradeItem) => builtinName("grade", g, locale)

  const { drafts, update: updateDraft, remove: removeDraft } = useDrafts<GradeItem>("grade")
  // Drafts first: what you're working on is what you came back for.
  const builtins = useBuiltins("grade")
  const community = useCommunity<GradeItem>("grade")
  const all = useMemo(
    // Built-ins carry no idea who is asking; the fetched rows do.
    () => [...builtins.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [builtins, community, drafts],
  )
  const selected =
    all.find((g) => g.id === selectedId) ?? all.find((g) => g.name === grade.preset) ?? all[0]

  const numbers = useCallback(
    (id: string) => {
      const st = statFor(id)
      return { likes: st.likeCount, uses: st.scenes, liked: st.liked, trend: st.trend }
    },
    [statFor],
  )
  // Built-in names are chrome and translate, so the library must rank, search
  // and sort on what the reader actually sees.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const displayName = useCallback((g: GradeItem) => nameOf(g), [locale])
  const searchText = useCallback((g: GradeItem) => builtinSearchText("grade", g), [])
  const browse = useLibraryBrowse(all, numbers, { initialFacet, displayName, searchText })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // A typed name that is already in use — see the graph library's commitRename.
  const [renameError, setRenameError] = useState<string | null>(null)
  const report = useReport()
  /** Which row a delete is being confirmed for, and whether it is a local
   *  draft or a published row — the two ask different questions. */
  // Private → public is permanent, so it asks first (useMakePublic).
  const makePublic = useMakePublic()
  const [confirming, setConfirming] = useState<{ id: string; draft: boolean } | null>(null)
  const commitRename = (item: GradeItem, raw: string) => {
    const wanted = normalizeName(raw)
    if (!wanted || wanted === item.name) {
      setRenamingId(null)
      setRenameError(null)
      return
    }
    // Refused, not silently suffixed — see the graph library's commitRename.
    const clash = conflictingName(
      wanted,
      [...builtins, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
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

  // The applied grade cannot be deleted — see the graph library's `inUse`.
  const inUse = (g: GradeItem) => g.owner === "local" && nameKey(g.name) === nameKey(grade.preset)

  // PICKING IS TRYING: a picked grade goes on the scene, so browsing is
  // watching the canvas take each one. Clicking the grade the scene wears takes
  // it off, back to Neutral.
  const neutral = NEUTRAL_NAME
  const select = (g: GradeItem) => {
    if (grade.preset === g.name) {
      if (g.name !== neutral) onApplyPreset(neutral)
      return
    }
    setSelectedId(g.id)
    onApplyPreset(g.name)
  }

  /** Straight into the editor, no entry created */
  const startEdit = (g: GradeItem) => {
    if (!onEdit) return
    setSelectedId(g.id)
    onEdit({ id: g.id, name: g.name, spec: g.payload.spec, origin: g.owner === "builtin" ? g.name : undefined })
  }
  // Nothing is created here — the editor is a scratchpad, and the save-on-close
  // dialog is what turns the work into a draft.
  const startNew = () => onEdit?.({ id: "", name: t.gradeLibrary.newGrade, spec: NEW_GRADE_SPEC })

  /** Is this entry what the scene is currently showing? The scene stores the name. */
  const isApplied = (g: GradeItem) => grade.preset === g.name


  const meta = (g: GradeItem): CardMeta => ({
    preview: <GradePreview spec={g.payload.spec} />,
    applied: isApplied(g),
    nameNode:
      renamingId === g.id ? (
        <RenameField
          name={g.name}
          error={!!renameError}
          onCommit={(value) => commitRename(g, value)}
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
  const wrap = (g: GradeItem, node: React.ReactNode) => {
    const isDraft = g.owner === "local"
    const mine = (g as { mine?: boolean }).mine === true
    return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{node}</div>
      </ContextMenuTrigger>
        <ContextMenuContent className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
          {onEdit && <ContextMenuItem onSelect={() => startEdit(g)}>{t.gradeLibrary.edit}</ContextMenuItem>}
          {isDraft && <ContextMenuItem
              onSelect={() => {
                setRenameError(null)
                setRenamingId(g.id)
              }}
            >
              {t.graph.rename}
            </ContextMenuItem>}
          {isDraft && (
            <ContextMenuItem
              variant="danger"
              disabled={inUse(g)}
              onSelect={() => {
                setConfirming({ id: g.id, draft: true })
              }}
            >
              {inUse(g) ? t.library.deleteInUse : t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <VisibilityMenu
              current={g.visibility ?? "public"}
              onMakePublic={() =>
                makePublic.ask(() => {
                  void fetch(`/api/library/${g.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ visibility: "public" }),
                  }).then(async (res) => {
                    if (await report(Promise.resolve(res), t.library.madePublic)) setCommunityVisibility(g.id, "public")
                  })
                })
              }
            />
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => setConfirming({ id: g.id, draft: false })}
            >
              {t.library.deletePublished}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
    </ContextMenu>
    )
  }

  return (
    <LibraryDock
      title={t.scene.grade}
      browse={browse}
      onClose={() => onOpenChange(false)}
      onNew={onEdit && startNew}
      z={z}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      detail={
        selected && (
          <LibraryDetail
            name={nameOf(selected)}
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
            description={selected.description ? builtinDescription("grade", selected, locale) : undefined}
            actions={
              <>
                {onEdit && (
                  <Button variant="bare" onClick={() => startEdit(selected)} className={DETAIL_ACTION}>
                    <PenLine />
                    {t.lab.ctl.edit}
                  </Button>
                )}
                {selected.owner === "local" && (
                  <PublishButton
                    kind="grade"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    currentVisibility={selected.visibility}
                    itemId={draftOrigin("grade", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("grade", selected.id).forkedFromId}
                    className={DETAIL_ACTION}
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
                      noteItemPublished(item.id)
                      removeDraft(selected.id)
                      setSelectedId(item.id)
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
          selectedId={selected?.id ?? null}
          onSelect={select}
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
