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
import type { ReactNode } from "react"
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
