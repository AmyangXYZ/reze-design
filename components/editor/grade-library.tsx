"use client"

// Grades library — the same three-column shell as the shader-graph and background-effect libraries.

import { useCallback, useMemo, useState } from "react"
import { Check, Palette, Plus, SquarePen, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GradePreview } from "@/components/editor/grade-preview"
import type { GradeEditorSubject } from "@/components/editor/grade-editor"
import {
  GRADE_PRESETS,
  NEW_GRADE_SPEC,
  type GradeSettings,
} from "@/lib/grade"
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
import { conflictingName, nameKey, normalizeName, type GradeItem } from "@/lib/library"
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
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useReport } from "@/hooks/use-report"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

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
  return (
    // Non-modal, no overlay — the docks stay live and the scene stays undimmed, because the scene
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

function LibraryContent({ onOpenChange, initialFacet, grade, onApplyPreset, onRenamed, onEdit }: Props) {
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [selectedId, setSelectedId] = useState<string>(grade.preset)
  // Applying a grade elsewhere (the quick-pick, or the editor) moves the selection.
  const [lastPreset, setLastPreset] = useState(grade.preset)
  if (grade.preset !== lastPreset) {
    setLastPreset(grade.preset)
    setSelectedId(grade.preset)
  }

  // Built-in names are UI chrome and translate by id; descriptions are AUTHOR
  // text and stay as written, exactly as the effects library already shows them.
  const nameOf = (g: GradeItem) => t.scene.gradePresets[g.name as keyof typeof t.scene.gradePresets] ?? g.name

  const { drafts, update: updateDraft, remove: removeDraft } = useDrafts<GradeItem>("grade")
  // Drafts first: what you're working on is what you came back for.
  const community = useCommunity<GradeItem>("grade")
  const all = useMemo(
    // Bundled items carry no idea who is asking; the fetched rows do.
    () => [...GRADE_PRESETS.map((i) => ({ ...i, mine: isMine(i.id) })), ...community, ...drafts],
    [community, drafts],
  )
  const selected = all.find((g) => g.name === selectedId) ?? all[0]

  const numbers = useCallback(
    (id: string) => {
      const st = statFor(id)
      return { likes: st.likeCount, uses: st.scenes, liked: st.liked }
    },
    [statFor],
  )
  // Built-in names are chrome and translate, so the library must rank, search
  // and sort on what the reader actually sees.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const displayName = useCallback((g: GradeItem) => nameOf(g), [t])
  const browse = useLibraryBrowse(all, numbers, { initialFacet, displayName })
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // A typed name that is already in use — see the graph library's commitRename.
  const [renameError, setRenameError] = useState<string | null>(null)
  const report = useReport()
  /** Which row a delete is being confirmed for, and whether it is a local
   *  draft or a published row — the two ask different questions. */
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
      [...GRADE_PRESETS, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
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
      }).then(async (res) => {
        // Awaited: the row keeps its old name until the server takes the new
        // one, so a refused rename never flashes as accepted.
        if (await report(Promise.resolve(res), t.library.renamed)) renameCommunityItem(item.id, name)
      })
    }
    setSelectedId(name)
    onRenamed?.(item.name, name)
  }

  // The applied grade cannot be deleted — see the graph library's `inUse`.
  const inUse = (g: GradeItem) => g.owner === "local" && nameKey(g.name) === nameKey(grade.preset)

  // Browsing never touches the scene
  const select = (g: GradeItem) => setSelectedId(g.name)

  const apply = () => {
    onApplyPreset(selected.name)
    onOpenChange(false)
  }

  /** Straight into the editor, no entry created */
  const startEdit = (g: GradeItem) => {
    if (!onEdit) return
    setSelectedId(g.name)
    onEdit({ id: g.id, name: g.name, spec: g.payload.spec, origin: g.owner === "builtin" ? g.name : undefined })
  }
  // Nothing is created here — the editor is a scratchpad, and the save-on-close
  // dialog is what turns the work into a draft.
  const startNew = () => onEdit?.({ id: "", name: t.gradeLibrary.newGrade, spec: NEW_GRADE_SPEC })

  /** Is this entry what the scene is currently showing? The scene stores the name. */
  const isApplied = (g: GradeItem) => grade.preset === g.name

  const shownSpec = selected?.payload.spec

  const meta = (g: GradeItem): CardMeta => ({
    preview: <GradePreview spec={g.payload.spec} />,
    applied: isApplied(g),
    nameNode:
      renamingId === g.id ? (
        <Input
          autoFocus
          defaultValue={g.name}
          className={cn(
            "h-5 min-w-0 flex-1 border-line-strong bg-white/5 px-1 text-[13px] md:text-[13px]",
            renameError && "border-red-400/60",
          )}
          onClick={(ev) => ev.stopPropagation()}
          onChange={() => renameError && setRenameError(null)}
          onBlur={(ev) => commitRename(g, ev.target.value)}
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
  const wrap = (g: GradeItem, node: React.ReactNode) => {
    const isDraft = g.owner === "local"
    const mine = (g as { mine?: boolean }).mine === true
    return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>{node}</div>
      </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
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
            <ContextMenuItem
              onSelect={() => {
                setRenameError(null)
                setRenamingId(g.id)
              }}
            >
              {t.graph.rename}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <VisibilityMenu
              current={g.visibility ?? "public"}
              onChange={(next) => {
                void fetch(`/api/library/${g.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ visibility: next }),
                }).then(async (res) => {
                  if (await report(Promise.resolve(res), t.library.madePublic)) setCommunityVisibility(g.id, next)
                })
              }}
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
    <DialogContent
      showCloseButton={false}
      overlay={false}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
      // Don't pull focus into the search field — it made Escape land in a text
      // input the moment the library opened.
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        onFocusCapture={onFocusCapture}
        className={LIBRARY_SHELL}
    >
      <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 bg-zinc-950 px-4 py-2 text-left">
        <DialogTitle className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
          <Palette className="size-4 text-blue-400" />
          {t.scene.grade}
        </DialogTitle>
        <LibraryToolbar browse={browse} usedLabel={t.rail.used} />
        {onEdit && (
          <button
            onClick={startNew}
            className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-chip border border-line-strong bg-white/5 px-2 text-[11px] font-medium transition-colors hover:bg-white/10"
          >
            <Plus className="size-3" />
            {t.library.new}
          </button>
        )}
        <DialogClose className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
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
            selectedId={selected?.id ?? null}
            onSelect={select}
            onActivate={startEdit}
            meta={meta}
            numbers={numbers}
            displayName={displayName}
            wrap={wrap}
            usedLabel={t.rail.used}
            empty={browse.query ? t.library.noMatch(browse.query) : t.rail.yoursEmpty}
          />
        </div>

        {/* ── Inspector, doubling as the editor for user grades ── */}
        <div className="flex w-[15rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[17rem]">
          {selected && shownSpec && (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance, exactly like the other two libraries */}
                <button
                  type="button"
                  disabled={!onEdit}
                  onClick={() => startEdit(selected)}
                  className="group/prev relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-md border border-white/10"
                >
                  <GradePreview spec={shownSpec} />
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                    <SquarePen className="size-4" />
                    {t.gradeLibrary.edit}
                  </div>
                </button>
              </div>

              <div className="min-h-0 p-3">
                <div className="truncate text-sm font-semibold select-text">{nameOf(selected)}</div>
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
                    kind="grade"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    currentVisibility={selected.visibility}
                  itemId={draftOrigin("grade", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("grade", selected.id).forkedFromId}
                    className="h-8 w-full"
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
                      noteItemPublished(item.id)
                      removeDraft(selected.id)
                      setSelectedId(item.name)
                      onRenamed?.(selected.name, item.name)
                    }}
                  />
                )}
                <Button
                  size="sm"
                  onClick={apply}
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
                >
                  <Check className="size-3.5" />
                  {t.gradeLibrary.apply}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
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
    </DialogContent>
  )
}
