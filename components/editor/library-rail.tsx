"use client"

// The pieces every library shares that are not about browsing: the dialog's own
// shell class, and the small readouts an inspector shows about one item.
//
// Browsing itself — the rail, the ranking, the grid and the list — lives in
// library-shell.tsx. The shelf machinery that used to be here went with it: three
// resizable panels split by provenance, and the measurement code that tried to
// make a percentage of the viewport land on a whole card row.

import { Heart } from "lucide-react"
import { type ReactNode } from "react"
import { Button } from "@/components/ui/button"
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
  // 87dvh, and NOT centred.
  //
  // The height grew for a reason worth keeping: a card is a thumbnail with a
  // NAME and an AUTHOR under it, and at 84 the bottom edge kept landing between
  // those two lines — the last row showed every name with its author sheared
  // off, which reads as broken rather than as more to scroll. 87 buys that line
  // back plus the grid's own bottom padding.
  //
  // Growing a CENTRED dialog takes the space off both ends, and the bottom is
  // the one end that cannot give: the transport bar sits at fixed bottom-3, and
  // at 88 centred the two visibly touched. So the extra height comes off the TOP
  // instead. `top` positions the dialog's CENTRE (it is translated -50%), so
  // 48.5 - 87/2 leaves 5dvh above and 8dvh below — the same clearance the
  // transport had at 84dvh centred, which is the number that was tuned for it.
  "flex h-[87dvh] max-h-[87dvh] top-[48.5dvh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-5xl " +
  "data-[state=closed]:animate-none data-[state=closed]:fade-out-100 data-[state=closed]:zoom-out-100 " +
  "data-[state=open]:animate-none data-[state=open]:fade-in-100 data-[state=open]:zoom-in-100"

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
const TAG_SWATCHES = [
  "bg-rose-400/25 text-rose-200",
  "bg-orange-400/25 text-orange-200",
  "bg-amber-400/25 text-amber-200",
  "bg-emerald-400/25 text-emerald-200",
  "bg-teal-400/25 text-teal-200",
  "bg-sky-400/25 text-sky-200",
  "bg-indigo-400/25 text-indigo-200",
  "bg-violet-400/25 text-violet-200",
  "bg-fuchsia-400/25 text-fuchsia-200",
]

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

/** The same nine hues as a solid swatch, for an avatar rather than a chip. */
export function tagSwatch(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_SWATCHES[h % TAG_SWATCHES.length]
}

export function tagHue(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_HUES[h % TAG_HUES.length]
}

export function RailSection({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-h-0 flex-col first:border-t-0 first:pt-0 [&+&]:mt-2 [&+&]:border-t [&+&]:border-white/10 [&+&]:pt-2", className)}>
      <div className="px-2 py-1.5 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
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
  leading,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  /** An avatar or a dot before the label. Makers wear one; facets do not. */
  leading?: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-[11px] transition-colors",
        active ? "bg-blue-400/15 font-medium text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      {leading}
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
      {/* pt is load-bearing: a selected chip is marked with a ring, and a ring
          paints OUTSIDE the border box, so a first row flush against the scroll
          container had its top edge clipped by the heading above it. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pt-1.5 pb-0.5">
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

/**
 * The card reading: how many people liked this, and whether you are one of them.
 *
 * Not a control. A grid cell is a thing you pick, and twenty hearts in it are
 * twenty small targets in front of the one target that matters — liking belongs in
 * the inspector, where you have already decided which item you are looking at.
 *
 * Outline heart until you've liked it, then solid red. Red is the one accent that
 * steps outside the three meanings in globals.css, deliberately: nobody reads a
 * heart as destructive, and nobody reads a blue one as a like.
 *
 * Sits flush at the right end of the name line — no padding of its own, so it lines
 * up with the card's edge rather than floating a few pixels inside it.
 */
export function LibraryStats({ likeCount, liked }: { likeCount: number; liked: boolean }) {
  return (
    <span
      className={cn(
        // leading-none, and the count in its own span: a bare text node in a flex
        // row is an anonymous item as tall as the INHERITED line-height, so
        // items-center centred a 12px glyph against a text box half again its
        // height and the number sat visibly low. Tight leading makes the box the
        // glyphs, and then centring is centring.
        "flex shrink-0 items-center gap-1 font-mono text-[11px] leading-none",
        liked ? "text-red-400" : "text-muted-foreground",
      )}
    >
      <Heart className={cn("size-3 shrink-0", liked && "fill-current")} />
      <span className="leading-none">{likeCount}</span>
    </span>
  )
}

type LikeProps = { likeCount: number; liked: boolean; canLike: boolean; onToggle?: () => void }

/**
 * The inspector control: a button, and shaped like one.
 *
 * No edge — its button-ness is its size, its hover and its cursor, not a rule
 * around it. It can afford that because the card heart beside it is now a plain
 * reading with none of those: this is the only heart in the library you can press,
 * so it does not have to out-shout a second one that looks the same.
 *
 * `canLike` is false for a signed-out visitor AND for a local draft, which has no
 * row on the server to like yet. Both keep pointer events so the title can say
 * which — the primitive's `disabled:pointer-events-none` would otherwise hide the
 * one explanation, in exactly the state that needs it.
 */
export function LibraryLike({ likeCount, liked, canLike, onToggle }: LikeProps) {
  const t = useT()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!canLike}
      title={canLike ? undefined : t.library.signInToLike}
      aria-pressed={liked}
      onClick={(e) => {
        // The surface underneath may select; the heart must not also select it.
        e.stopPropagation()
        onToggle?.()
      }}
      className={cn(
        "h-7 gap-1.5 rounded-interior px-2.5 font-mono text-xs transition-colors has-[>svg]:px-2.5",
        // Unconditional, with the disabled variant overriding it: gating the hand
        // on canLike meant the cursor and the control disagreed for a beat every
        // time the stats snapshot landed, and a heart you CAN press is the case
        // that has to look pressable.
        "cursor-pointer",
        // disabled:opacity-50 comes from the primitive and would dim the COUNT,
        // which is a fact about the item rather than about your ability to act.
        "disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100",
        liked ? "text-red-400" : "text-muted-foreground",
        canLike && !liked && "hover:text-red-400",
      )}
    >
      <Heart className={cn("size-3.5", liked && "fill-current")} />
      <span className="leading-none">{likeCount}</span>
    </Button>
  )
}

/**
 * The inspector variant: what this item is worth to people, in one strip.
 *
 * The three libraries each showed likes only as a 12px heart on the card, and
 * usage only as a fragment tacked onto the author line — and only when it was
 * above zero, so the common case showed nothing at all and read as a missing
 * feature rather than as "nobody has used this yet". Both numbers now live in one
 * place, always, in the pane you are already reading about the item in.
 *
 * Zero is printed. It is the honest answer, and it is the number that makes the
 * first non-zero mean something.
 */
export function LibraryItemStats({
  likeCount,
  liked,
  canLike,
  scenes,
  onToggle,
}: {
  likeCount: number
  liked: boolean
  canLike: boolean
  scenes: number
  onToggle?: () => void
}) {
  const t = useT()
  return (
    // No box, no rule. Two numbers about the item, among the item's other facts —
    // fencing them off would say they are a separate thing to act on, and the pane
    // has enough edges already.
    //
    // Usage reads first because it starts on the same left margin as the
    // description and tags above it, so the pane still has one column of prose. The
    // heart is the only thing here you can press, and it goes where the pane's other
    // pressable things are — the right edge. -mr-2.5 cancels the button's own
    // padding, so the count lands on the same right margin as the description above
    // it and the hover fill bleeds out to the pane's edge instead of stopping short.
    <div className="mt-3 -mr-2.5 flex items-center gap-2">
      <span className="min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground">
        {t.library.usedInScenes(scenes)}
      </span>
      <LibraryLike likeCount={likeCount} liked={liked} canLike={canLike} onToggle={onToggle} />
    </div>
  )
}
