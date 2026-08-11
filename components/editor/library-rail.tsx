"use client"

// The ONE rail every library wears — grades, graphs, backgrounds.
//
// Facets are provenance (who made it), not taxonomy (what it is). A category
// tree was the same idea as tags at a coarser grain, and kept forcing a
// one-of-many choice on items that are honestly several things at once. Tags now
// live in search and on the item itself; the rail answers the question the
// taxonomy never could — "show me mine".

import { Heart } from "lucide-react"
import { LIBRARY_FACETS, type LibraryFacet, type LibraryItem, type MaybeMine } from "@/lib/library"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The shared shell class for all three library dialogs.
 *
 * Animations are suppressed in BOTH directions. Switching libraries closes one and
 * opens another in the same batch, and since they're identical in size and
 * position, animating means a gap followed by a zoom — which reads as a flash. With
 * both off, the swap looks like one panel changing its contents.
 */
export const LIBRARY_SHELL =
  // One size for all four surfaces — three libraries and the gallery — because
  // they are the same kind of window and switching between them should not
  // resize the screen. Fixed rather than content-sized for the same reason: a
  // dialog whose height depends on how much you have published is a dialog that
  // never looks the same twice.
  //
  // The empty space that a fixed height creates belongs at the BOTTOM of the
  // sections: Local is mt-auto, so slack collects above it rather than opening a
  // hole between the built-ins and Community.
  //
  // 84dvh. The dialog is centred, so the margin below it is (100-h)/2: at 88
  // that left ~6%, under the transport bar's own height at fixed bottom-3, and
  // the two visibly touched. 80 cleared it but read as a band of dead space.
  "flex h-[84dvh] max-h-[84dvh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-5xl " +
  "data-[state=closed]:animate-none data-[state=closed]:fade-out-100 data-[state=closed]:zoom-out-100 " +
  "data-[state=open]:animate-none data-[state=open]:fade-in-100 data-[state=open]:zoom-in-100"

/**
 * A shelf of cards, in every library.
 *
 * The `pt-1` is load-bearing: a selected card is marked with a ring, and a ring
 * paints OUTSIDE the border box, so a first row flush against its scroll
 * container had its top pixel clipped — a selection whose highlight was open at
 * the top. Community and Local wear it worst, their headers sitting outside the
 * scroll box, so their cards begin exactly at the clip edge.
 *
 * The 4px comes OUT of the header above rather than being added below it, so the
 * shelves keep the spacing they had. Column count and the bottom are the
 * caller's — the shelves differ in both.
 */
export const LIBRARY_GRID = "grid content-start gap-2 px-3 pt-1 pb-3"

/**
 * PARKED, and kept because the problem it solves is real.
 *
 * The shelves are plain CSS shares again (40% · 40% · 20%), which is
 * predictable and wrong only in the small: three capped sections plus their
 * top margin and their rules add up to a hair MORE than the height they are
 * given, so the bottom shelf loses those few pixels, and a share of a dvh
 * never divides evenly into a card row, so a shelf can still end on a card cut
 * through the middle.
 *
 * This measures its way out of both — but it has to subtract the margins and
 * borders from each share to do it, which the version below does not, and a
 * measurement that is wrong is worse than an approximation that is honest. It
 * wants a session with the dialog open in front of it.
 *
 * A shelf's height: its SHARE of the column, rounded down to whole card rows.
 *
 * The share has to be measured rather than declared. `max-h-[40%]` is a
 * percentage of a dialog sized in dvh, and a card's height comes from the column
 * WIDTH — a 16:10 thumbnail in one of four or five tracks — so the two never
 * divide evenly and the shelf ends on a card sliced through the middle. What the
 * eye reads there is not "scroll for more", it is a broken layout.
 *
 * So: measure one card and the gap, take the share, and keep the largest whole
 * number of rows that fits. Everything it needs is already on screen, and the
 * observer re-runs it when the dialog is resized or the card count changes the
 * grid's shape.
 *
 * Applied to the SCROLLER rather than the section, so the header is outside the
 * arithmetic and cannot be squeezed. At least one row always survives, even in a
 * window too short for the share — a shelf showing nothing would hide items with
 * no way to know they are there.
 */
export function useShelfCap(share: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    const section = ref.current
    const column = section?.parentElement
    if (!section || !column) return
    const measure = () => {
      const header = section.firstElementChild as HTMLElement | null
      const grid = section.querySelector<HTMLElement>("[data-shelf-grid]")
      const card = grid?.firstElementChild as HTMLElement | null
      // No cards — an empty Community says so in one line, which needs no cap.
      if (!header || !grid || !card) return setMaxHeight(undefined)
      const gs = getComputedStyle(grid)
      const gap = parseFloat(gs.rowGap) || 0
      const padTop = parseFloat(gs.paddingTop) || 0
      const padBottom = parseFloat(gs.paddingBottom) || 0
      const cardH = card.getBoundingClientRect().height
      // Not laid out yet (a card with no measured height): leave the cap alone
      // and wait — the observer watches the section, so the frame the cards
      // gain height is a frame this runs again.
      if (cardH <= 0) return
      const room = column.clientHeight * share - header.getBoundingClientRect().height
      const content = grid.scrollHeight
      // Everything fits: take the CONTENT height, padding and all. Rounding to
      // whole rows here would slice off the grid's bottom padding and produce a
      // scrollbar for twelve pixels of air.
      if (content <= room) return setMaxHeight(content)
      // Otherwise the largest whole number of rows the share allows. n rows and
      // the n-1 gaps BETWEEN them — counting the trailing gap would leave a
      // sliver of the next row showing, which is the thing this exists to stop.
      const rows = Math.max(1, Math.floor((room - padTop - padBottom + gap) / (cardH + gap)))
      setMaxHeight(padTop + rows * cardH + (rows - 1) * gap)
    }
    // Fires once on observe, which is the first measurement — so there is no
    // synchronous setState in the effect body and no second pass correcting a
    // first guess. The COLUMN is watched for the dialog resizing, the SECTION
    // for cards arriving and for the card height that follows column width.
    const ro = new ResizeObserver(measure)
    ro.observe(column)
    ro.observe(section)
    return () => ro.disconnect()
  }, [share])
  return { ref, style: maxHeight === undefined ? undefined : { maxHeight } }
}

/**
 * How many are on this shelf, right after the word that names it.
 *
 * Beside the label rather than at the right edge: it is part of what the heading
 * SAYS, not a second column of data — and a number alone at the far end of a
 * wide header reads as belonging to whatever sits under it.
 *
 * Counts what is DISPLAYED, so a search or a facet narrows it. A total that
 * disagrees with the rows you can see is a number you have to explain.
 */
export function ShelfCount({ n }: { n: number }) {
  // tracking-normal: the headings run at 0.14em, which pushes a closing paren
  // off its digits.
  return <span className="ml-1.5 tracking-normal tabular-nums">({n})</span>
}

/** A titled block in the rail. Sections are separated by a rule so the rail reads
 *  as "how to browse" then "what to browse by". */
/**
 * A tag's colour, derived from its own characters — so `dance` is the same hue in
 * every library, in every session, on everyone's screen, with nothing stored.
 * Nine hues, spaced far enough apart to tell apart at badge size.
 */
const TAG_HUES = [
  "border-rose-400/30 bg-rose-400/10 text-rose-300",
  "border-orange-400/30 bg-orange-400/10 text-orange-300",
  "border-amber-400/30 bg-amber-400/10 text-amber-300",
  "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  "border-teal-400/30 bg-teal-400/10 text-teal-300",
  "border-sky-400/30 bg-sky-400/10 text-sky-300",
  "border-indigo-400/30 bg-indigo-400/10 text-indigo-300",
  "border-violet-400/30 bg-violet-400/10 text-violet-300",
  "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
]

export function tagHue(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_HUES[h % TAG_HUES.length]
}

export function RailSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-h-0 flex-col first:border-t-0 first:pt-0 [&+&]:mt-2 [&+&]:border-t [&+&]:border-white/10 [&+&]:pt-2", className)}>
      <div className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
        {title}
      </div>
      {children}
    </div>
  )
}

/** One rail row: a label, its count, and whether it is the current view. */
export function RailRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs transition-colors",
        active ? "bg-blue-400/15 font-medium text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className={cn("font-mono text-[11px]", active ? "text-blue-400/80" : "text-muted-foreground/60")}>
          {count}
        </span>
      )}
    </button>
  )
}

/** Tags across a set of items, most used first — the rail's second axis. */
export function RailTags({
  items,
  counts,
  tag,
  onTagChange,
}: {
  /** Counted here when the whole set is in hand (the preset libraries). */
  items?: { tags: string[] }[]
  /** Counted by the server when the client only holds a page (the gallery). */
  counts?: [string, number][]
  tag: string | null
  onTagChange: (tag: string | null) => void
}) {
  const t = useT()
  const tally = new Map<string, number>()
  for (const i of items ?? []) for (const x of i.tags) tally.set(x, (tally.get(x) ?? 0) + 1)
  // Frequency first — that is the information — then SHORTEST first within equal
  // counts. In a library where most tags occur once, that tail is nearly all of
  // them, and grouping by length lets a row fit three or four chips instead of
  // breaking after a long one. Measuring text to pack properly would need a layout
  // pass per render for a gain nobody would notice.
  const order = (list: [string, number][]) =>
    [...list].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
  const sorted = order(counts ?? [...tally.entries()])
  if (sorted.length === 0) return null
  return (
    <RailSection title={t.rail.tags} className="min-h-0 flex-1">
      {/* A cloud, not a list: tags are short and their lengths vary wildly, so a
          row each wastes most of the rail and buries the common ones. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-0.5">
        <div className="flex flex-wrap gap-1">
          {sorted.map(([name, n]) => {
            const on = tag === name
            return (
              <button
                key={name}
                onClick={() => onTagChange(on ? null : name)}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-[color,background-color,border-color,box-shadow,opacity]",
                  tagHue(name),
                  on ? "ring-1 ring-white/50 brightness-125" : "opacity-75 hover:opacity-100",
                )}
              >
                <span className="max-w-28 truncate font-medium">{name}</span>
                <span className="font-mono text-[10px] font-medium opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
      </div>
    </RailSection>
  )
}

export function LibraryRail({
  items,
  facet,
  onFacetChange,
  tag,
  onTagChange,
  isLiked,
  facets = LIBRARY_FACETS,
}: {
  items: LibraryItem[]
  facet: LibraryFacet
  onFacetChange: (facet: LibraryFacet) => void
  /** Optional second axis: filter by tag within the chosen facet. */
  tag?: string | null
  onTagChange?: (tag: string | null) => void
  /** Whether the signed-in user liked an item — the one facet the item can't answer. */
  isLiked?: (item: LibraryItem) => boolean
  /** Which facets this surface has. Scenes ship none, so they have no Featured. */
  facets?: LibraryFacet[]
}) {
  const t = useT()
  const label: Record<LibraryFacet, string> = {
    all: t.rail.all,
    builtin: t.rail.builtin,
    yours: t.rail.yours,
    liked: t.rail.liked,
  }
  const count: Record<LibraryFacet, number> = {
    all: items.length,
    builtin: items.filter((i) => i.owner === "builtin").length,
    yours: items.filter((i) => i.owner === "user" || (i as LibraryItem & MaybeMine).mine === true || i.owner === "local").length,
    liked: isLiked ? items.filter(isLiked).length : 0,
  }

  return (
    // Hidden on narrow screens — search still filters everything.
    <div className="hidden w-50 shrink-0 flex-col border-r border-white/10 p-2 md:flex">
      <RailSection title={t.rail.browse}>
        <div className="flex flex-col gap-0.5">
          {facets.map((f) => (
            <RailRow key={f} label={label[f]} count={count[f]} active={facet === f} onClick={() => onFacetChange(f)} />
          ))}
        </div>
      </RailSection>
      {onTagChange && <RailTags items={items} tag={tag ?? null} onTagChange={onTagChange} />}
    </div>
  )
}

/** Tag chips as the item's own metadata — the detail panel's, not the rail's. */
export function LibraryTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className={cn("rounded border px-1.5 py-0.5 text-[11px]", tagHue(tag))}>
          {tag}
        </span>
      ))}
    </div>
  )
}

/** Likes and scene-usage, sitting at the end of an item's author line.
 *  Outline heart until you've liked it, then solid — the convention people
 *  already read without being told. */
export function LibraryStats({
  likeCount,
  liked,
  canLike,
  onToggle,
}: {
  likeCount: number
  liked: boolean
  canLike: boolean
  onToggle?: () => void
}) {
  const t = useT()
  return (
    <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
      <button
        type="button"
        disabled={!canLike}
        title={canLike ? undefined : t.library.signInToLike}
        onClick={(e) => {
          // The card underneath selects; the heart must not also select it.
          e.stopPropagation()
          onToggle?.()
        }}
        className={cn(
          "flex items-center gap-1 rounded transition-colors",
          canLike && "cursor-pointer",
          liked ? "text-red-400" : "text-muted-foreground/70",
          canLike && !liked && "hover:text-red-400",
        )}
      >
        <Heart className={cn("size-3", liked && "fill-current")} />
        {likeCount}
      </button>
    </span>
  )
}

/**
 * The three shelves every library stacks — Built-in, Community, Local — with the
 * splits between them draggable and remembered.
 *
 * The shares were fixed at 38 / 38 / 20, reasoning that the built-ins are a set
 * you learn the shape of, Community grows forever, and Local is few by nature.
 * That is a good DEFAULT and stays the default. It was a poor rule, because
 * which shelf is worth height depends entirely on whose library it is.
 *
 * `useDefaultLayout` persists to localStorage, per library rather than shared —
 * the shelf you keep tall in Shaders is not the one you keep tall in Grades —
 * and `panelIds` keys the saved layout to the set of panels present, which is
 * what stops a two-shelf column from inheriting a three-shelf split.
 *
 * Takes children rather than a shelf per prop so the reasoning written between
 * these sections stays between them, where it explains the thing it is next to.
 *
 * What this gives up, deliberately: panels fill their column, so a shelf shorter
 * than its share now ends in its own gap instead of pooling every shelf's slack
 * at the bottom. Dragging a cap would have kept that pooling, but then the
 * handle does nothing visible whenever a shelf is under-full, and a control that
 * sometimes ignores you is worse than a gap.
 */
export function LibraryShelves({
  id,
  hasLocal,
  children,
}: {
  /** Which library's remembered split this is. */
  id: string
  hasLocal: boolean
  children: ReactNode
}) {
  const panelIds = hasLocal ? ["builtin", "community", "local"] : ["builtin", "community"]
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `reze-design.shelves.${id}`, panelIds })
  return (
    <ResizablePanelGroup
      orientation="vertical"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="min-h-0 flex-1"
    >
      {children}
    </ResizablePanelGroup>
  )
}

/**
 * One shelf.
 *
 * Sizes are the old shares verbatim — 38 / 38 / 20 — so the dialog opens looking
 * exactly as it did. They sum to 96 rather than 100 and are normalised back up,
 * which is right: the missing 4 was compensation for a top margin and two rules
 * between the shelves, and the handles have replaced all three.
 */
export function LibraryShelf({ id, defaultSize, children }: { id: string; defaultSize: string; children: ReactNode }) {
  return (
    <ResizablePanel id={id} defaultSize={defaultSize} minSize="12" className="flex min-h-0 flex-col">
      {children}
    </ResizablePanel>
  )
}

/** The hairline that used to be a `border-t`, now grabbable. It stays a hairline
 *  until pointed at: a divider advertising itself on a shelf nobody wants to
 *  resize is noise on every other visit. */
export function ShelfHandle() {
  return <ResizableHandle className="bg-white/10 transition-colors hover:bg-blue-400/50 data-[state=drag]:bg-blue-400" />
}
