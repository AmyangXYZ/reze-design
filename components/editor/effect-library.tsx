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

import { useCallback, useMemo, useState } from "react"
import { Check, Plus, Sparkles, SquarePen, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  applyDefaults,
  EFFECTS,
  NEW_EFFECT_TEMPLATE,
  type AppliedEffect,
} from "@/lib/effects"
import { EffectPreview } from "@/components/editor/effect-preview"
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
import { conflictingName, normalizeName, type EffectItem } from "@/lib/library"
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
  /** Every effect the scene wears, in layer order. Membership, not a
   *  selection: applying adds and applying again takes off. */
  applied: AppliedEffect[]
  onApply: (effect: AppliedEffect) => void
  /** A draft was renamed — re-point anything applied by the old name. */
  onRenamed?: (oldName: string, newName: string) => void
  onRemove: (id: string) => void
  /** Open the page-level floating WGSL editor on this effect (independent panel, same idiom
   *  as the graph editor). Optional: a host without the editor omits it, and
   *  every edit/new affordance hides rather than sitting there doing nothing. */
  onEdit?: (effect: AppliedEffect) => void
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
/** The card's own applied entry when the scene wears it — so opening the editor
 *  on a card edits what is RUNNING rather than the library's pristine copy. */
const appliedById = (applied: AppliedEffect[], id: string | undefined) => applied.find((e) => e.id === id) ?? null

const seedDraft = (selected: EffectItem | null, applied: AppliedEffect[]): AppliedEffect | null =>
  selected ? ({ ...(appliedById(applied, selected.id) ?? applyDefaults(selected)) }) : null

function LibraryContent({ onOpenChange, initialFacet, applied, onApply, onRemove, onRenamed, onEdit }: LibraryProps) {
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  // Radix would close on Escape whatever is stacked above it; the z-order
  // stack closes only the topmost surface.
  const { statFor, signedIn, toggleLike } = useLibraryStats()
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [selectedId, setSelectedId] = useState<string | null>(applied[0]?.id ?? EFFECTS[0]?.id ?? null)
  // Follow the TOP applied layer when the list changes — creating or editing one should move
  // the selection with it, rather than leaving the ring on the previous entry.
  const [lastApplied, setLastApplied] = useState(applied.at(-1)?.id ?? null)
  if ((applied.at(-1)?.id ?? null) !== lastApplied) {
    setLastApplied(applied.at(-1)?.id ?? null)
    const top = applied.at(-1)
    if (top) setSelectedId(top.id)
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
      return { likes: s.likeCount, uses: s.scenes, liked: s.liked }
    },
    [statFor],
  )
  const browse = useLibraryBrowse(all, numbers, { initialFacet })
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
      [...EFFECTS, ...community, ...drafts].filter((x) => x.id !== item.id).map((x) => x.name),
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

  // The applied effect cannot be deleted — see the graph library's `inUse`.
  const inUse = (e: EffectItem) => e.owner === "local" && applied.some((a) => a.id === e.id)

  const isAppliedSelected = selected !== null && applied.some((a) => a.id === selected.id)

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
        <Input
          autoFocus
          defaultValue={e.name}
          className={cn(
            "h-5 min-w-0 flex-1 border-line-strong bg-white/5 px-1 text-[13px] md:text-[13px]",
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
        <ContextMenuContent className="w-40">
          {onEdit && (
            <ContextMenuItem onSelect={() => onEdit(seedDraft(e, applied)!)}>{t.effectLibrary.editShader}</ContextMenuItem>
          )}
          {(isDraft || mine) && <ContextMenuItem onSelect={startRename}>{t.graph.rename}</ContextMenuItem>}
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
            <VisibilityMenu
              current={e.visibility ?? "public"}
              onChange={(next) => {
                void fetch(`/api/library/${e.id}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ visibility: next }),
                }).then((res) => res.ok && setCommunityVisibility(e.id, next))
              }}
            />
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
          <DialogTitle className="flex shrink-0 items-center gap-2 text-[13px] font-medium">
            <Sparkles className="size-4 text-blue-400" />
            {t.effectLibrary.title}
          </DialogTitle>
          <LibraryToolbar browse={browse} usedLabel={t.rail.used} />
          {/* Creation lives in the header. Just "New": the dialog's own title
              already says what kind of thing this makes. */}
          {onEdit && (
            <button
              onClick={startNew}
              className="flex h-6 shrink-0 items-center gap-1 rounded-chip border border-line-strong bg-white/5 px-2 text-[11px] font-medium transition-colors hover:bg-white/10"
            >
              <Plus className="size-3" />
              {t.library.new}
            </button>
          )}
          <DialogClose className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
            <X className="size-3.5" />
            <span className="sr-only">{t.library.close}</span>
          </DialogClose>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <LibraryRailFilters browse={browse} />

          {/* ONE ranked list. No shelves: a built-in is a preset the admin
              account published, so splitting the grid by provenance was sorting
              by who rather than by what, and it put community work below the
              fold. The rail still filters by maker, which is where provenance
              belongs. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <LibraryResults
              browse={browse}
              selectedId={selectedId}
              onSelect={(e) => setSelectedId(e.id)}
              onActivate={(e) => onEdit?.(seedDraft(e, applied)!)}
              meta={meta}
              numbers={numbers}
              wrap={wrap}
              usedLabel={t.rail.used}
              empty={browse.query ? t.library.noMatch(browse.query) : t.rail.yoursEmpty}
            />
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
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <AuthorAvatar name={builtinAuthor(selected.id, selected.author)} className="size-3.5" />
                    <span className="truncate select-text">{builtinAuthor(selected.id, selected.author)}</span>
                    {/* When it went public, the same fact the gallery's panel shows. */}
                    {publishedOn(selected.createdAt) && <span className="shrink-0">· {publishedOn(selected.createdAt)}</span>}
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
                    currentVisibility={selected.visibility}
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
                      onClick={() => selected && onRemove(selected.id)}
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
