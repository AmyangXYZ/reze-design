"use client"

// Grades library — the same three-column shell as the shader-graph and background-effect libraries.

import { useEffect, useMemo, useState } from "react"
import { Check, Palette, Plus, Search, SquarePen, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GradePreview } from "@/components/editor/grade-preview"
import type { GradeEditorSubject } from "@/components/editor/grade-editor"
import {
  GRADE_PRESETS,
  NEW_GRADE_SPEC,
  type GradeSettings,
} from "@/lib/grade"
import { LIBRARY_SHELL, LibraryRail, LibraryStats, LibraryTags } from "@/components/editor/library-rail"
import { matchesFacet, matchesQuery, type GradeItem, type LibraryFacet } from "@/lib/library"
import { draftOrigin, nextDraftName } from "@/lib/drafts"
import { addCommunityItem, builtinAuthor, refreshCommunity, removeCommunityItem, renameCommunityItem, useCommunity } from "@/hooks/use-community"
import { useDrafts } from "@/hooks/use-drafts"
import { useLibraryStats } from "@/hooks/use-library-stats"
import { useZOrder } from "@/hooks/use-z-order"
import { PublishButton } from "@/components/editor/publish-button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Facet the library opens on — the account tab opens straight to "yours". */
  initialFacet?: LibraryFacet
  grade: GradeSettings
  /** Apply a built-in by id. */
  onApplyPreset: (id: string) => void
  /** A draft was renamed — re-point anything applied by the old name. */
  onRenamed?: (oldName: string, newName: string) => void
  /** Open the page-level floating grade editor (independent panel, same idiom as the graph */
  onEdit: (subject: GradeEditorSubject) => void
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
  const { statFor, signedIn, toggleLike } = useLibraryStats("grade")
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [query, setQuery] = useState("")
  const [facet, setFacet] = useState<LibraryFacet>(initialFacet ?? "all")
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
  // Fresh rows every open — a publish elsewhere shows without a reload.
  useEffect(() => refreshCommunity(), [])
  const community = useCommunity<GradeItem>("grade")
  const all = useMemo(() => [...GRADE_PRESETS, ...community, ...drafts], [community, drafts])
  const selected = all.find((g) => g.name === selectedId) ?? all[0]

  const rows = useMemo(
    () => all.filter((g) => matchesFacet(g, facet) && matchesQuery(g, query, nameOf(g))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, query, facet, t],
  )
  // Two compartments: built-ins (and community, later) scroll; drafts pin to the bottom.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const commitRename = (item: GradeItem, raw: string) => {
    setRenamingId(null)
    const wanted = raw.trim()
    if (!wanted || wanted === item.name) return
    // Deduped against everything visible here, so two rows never share a label.
    const name = nextDraftName(
      wanted,
      [...GRADE_PRESETS, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
    )
    if (item.owner === "local") updateDraft(item.id, { name })
    else {
      // Published: the server owns the row, and rejects a name you already used.
      void fetch(`/api/library/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then((res) => res.ok && renameCommunityItem(item.id, name))
    }
    setSelectedId(name)
    onRenamed?.(item.name, name)
  }

  const builtinRows = rows.filter((x) => x.owner !== "local")
  const localRows = rows.filter((x) => x.owner === "local")

  // Browsing never touches the scene
  const select = (g: GradeItem) => setSelectedId(g.name)

  const apply = () => {
    onApplyPreset(selected.name)
    onOpenChange(false)
  }

  /** Straight into the editor, no entry created */
  const startEdit = (g: GradeItem) => {
    setSelectedId(g.name)
    onEdit({ id: g.id, name: g.name, spec: g.payload.spec, origin: g.owner === "builtin" ? g.name : undefined })
  }
  // Nothing is created here — the editor is a scratchpad, and the save-on-close
  // dialog is what turns the work into a draft.
  const startNew = () => onEdit({ id: "", name: t.gradeLibrary.newGrade, spec: NEW_GRADE_SPEC })

  /** Is this entry what the scene is currently showing? The scene stores the name. */
  const isApplied = (g: GradeItem) => grade.preset === g.name

  const shownSpec = selected?.payload.spec

  const renderCard = (g: GradeItem) => {
    const sel = g.name === selectedId
    const card = (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault()
                      select(g)
                    }
                  }}
                  onClick={() => select(g)}
                  onDoubleClick={() => startEdit(g)} // straight into the wheels
                  className={cn(
                    "cursor-pointer overflow-hidden rounded-md border text-left transition-colors",
                    sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                  )}
                >
                  <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900">
                    <GradePreview spec={g.payload.spec} />
                    {isApplied(g) && (
                      <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                        {t.bgLibrary.applied}
                      </span>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {renamingId === g.id ? (
                          <Input
                            autoFocus
                            defaultValue={g.name}
                            className="h-5 min-w-0 flex-1 border-white/10 bg-white/5 px-1 text-xs md:text-xs"
                            onClick={(ev) => ev.stopPropagation()}
                            onBlur={(ev) => commitRename(g, ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur()
                              if (ev.key === "Escape") setRenamingId(null)
                            }}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{nameOf(g)}</span>
                        )}
                        <LibraryStats
                          likeCount={statFor(g.name).likeCount}
                          liked={statFor(g.name).liked}
                          scenes={statFor(g.name).scenes}
                          canLike={signedIn}
                          onToggle={() => void toggleLike(g.name)}
                        />
                      </div>
                  </div>
                </div>
    )
    // One menu on every card: right-click is the discoverable route to editing
    // (double-click still works). Rename and delete only where they apply.
    const isDraft = g.owner === "local"
    const mine = (g as { mine?: boolean }).mine === true
    return (
      <ContextMenu key={g.id}>
        <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => startEdit(g)}>{t.gradeLibrary.edit}</ContextMenuItem>
          {isDraft && <ContextMenuItem onSelect={() => setRenamingId(g.id)}>{t.graph.rename}</ContextMenuItem>}
          {isDraft && (
            <ContextMenuItem
              variant="danger"
              onSelect={() => {
                if (confirm(t.library.deleteDraftConfirm)) removeDraft(g.id)
              }}
            >
              {t.library.deleteDraft}
            </ContextMenuItem>
          )}
          {!isDraft && mine && (
            <ContextMenuItem onSelect={() => setRenamingId(g.id)}>{t.graph.rename}</ContextMenuItem>
          )}
          {!isDraft && mine && (
            // Your own published rows: moderation is deletion.
            <ContextMenuItem
              variant="danger"
              onSelect={() => {
                if (!confirm(t.library.deletePublishedConfirm)) return
                void fetch(`/api/library/${g.id}`, { method: "DELETE" }).then((res) => {
                  if (res.ok) removeCommunityItem(g.id)
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
      onCloseAutoFocus={(e) => e.preventDefault()}
      style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        onFocusCapture={onFocusCapture}
        className={LIBRARY_SHELL}
    >
      <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 bg-zinc-950 px-4 py-2 text-left">
        <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Palette className="size-4 text-blue-400" />
          {t.scene.grade}
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
        <button
          onClick={startNew}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
        >
          <Plus className="size-3.5" />
          {t.gradeLibrary.newGrade}
        </button>
        <DialogClose className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">{t.library.close}</span>
        </DialogClose>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        <LibraryRail items={all} facet={facet} onFacetChange={setFacet} />

        {/* ── Grid: every tile is the user's own scene under that grade ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] content-start gap-2.5 p-3">
            {builtinRows.map(renderCard)}
            {rows.length === 0 && (
              <div className="col-span-full py-16 text-center text-xs text-muted-foreground">
                  {facet === "yours" && !query ? t.rail.yoursEmpty : t.library.noMatch(query)}
                </div>
            )}
          </div>
        </ScrollArea>
        {localRows.length > 0 && (
            <div className="flex max-h-[26%] shrink-0 flex-col border-t border-white/10">
              <div className="shrink-0 px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {t.rail.local}
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] content-start gap-2.5 px-3 pb-3">
                {localRows.map(renderCard)}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* ── Inspector, doubling as the editor for user grades ── */}
        <div className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[20rem]">
          {selected && shownSpec && (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance, exactly like the other two libraries */}
                <button
                  type="button"
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
                <div className="truncate text-sm font-semibold">{nameOf(selected)}</div>
                <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                  {builtinAuthor("grade", selected.name, selected.author)} · v{selected.version}
                </div>
                {selected.description && (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <LibraryTags tags={selected.tags} />
              </div>

              <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                {selected.owner === "local" && (
                  <PublishButton
                    kind="grade"
                    defaultName={selected.name}
                    defaultDescription={selected.description}
                    defaultTags={selected.tags}
                    payload={() => selected.payload}
                    itemId={draftOrigin("grade", selected.id).sourceId ?? selected.id}
                    forkedFromId={draftOrigin("grade", selected.id).forkedFromId}
                    className="h-7 w-full"
                    onPublished={(item) => {
                      // Promotion: the draft's content now lives on the server —
                      // keeping the local copy would show the same thing twice.
                      addCommunityItem(item)
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
    </DialogContent>
  )
}
