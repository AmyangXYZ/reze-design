"use client"

// The small readouts every library shares about one item: its count, its
// maker's swatch, its likes. Browsing itself — the ranking and the band — lives
// in library-shell.tsx.

import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

/**
 * A maker's swatch, derived from the name's own characters — the same hue in
 * every session, on everyone's screen, with nothing stored. Nine hues, spaced
 * far enough apart to tell apart at avatar size.
 */
const TAG_SWATCHES = [
  "bg-rose-400/25 text-rose-200",
  "bg-orange-400/25 text-orange-200",
  "bg-amber-400/25 text-amber-400",
  "bg-emerald-400/25 text-emerald-200",
  "bg-teal-400/25 text-teal-200",
  "bg-sky-400/25 text-sky-200",
  "bg-indigo-400/25 text-indigo-200",
  "bg-violet-400/25 text-violet-200",
  "bg-fuchsia-400/25 text-fuchsia-200",
]

export function tagSwatch(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_SWATCHES[h % TAG_SWATCHES.length]
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
 * row on the server to like yet.
 */
export function LibraryLike({ likeCount, liked, canLike, onToggle, large }: LikeProps & { large?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!canLike}
      aria-pressed={liked}
      onClick={(e) => {
        // The surface underneath may select; the heart must not also select it.
        e.stopPropagation()
        onToggle?.()
      }}
      className={cn(
        "gap-1.5 rounded-interior px-2.5 font-mono transition-colors has-[>svg]:px-2.5",
        // Large beside a billboard's buttons, as tall as they are.
        large ? "h-7 text-sm" : "h-7 text-xs",
        // Unconditional, with the disabled variant overriding it: gating the hand
        // on canLike meant the cursor and the control disagreed for a beat every
        // time the stats snapshot landed, and a heart you CAN press is the case
        // that has to look pressable.
        "cursor-pointer",
        // disabled:opacity-50 comes from the primitive and would dim the COUNT,
        // which is a fact about the item rather than about your ability to act.
        "disabled:pointer-events-auto disabled:cursor-default disabled:opacity-100",
        "text-muted-foreground",
        canLike && !liked && "hover:text-red-400",
      )}
    >
      {/* The heart is the mark; the count is a fact, in the ink. */}
      <Heart className={cn(large ? "size-4" : "size-3.5", liked && "fill-current text-red-400")} />
      <span className="leading-none">{likeCount}</span>
    </Button>
  )
}
