"use client"

// The ONE rail every library wears — grades, graphs, backgrounds.
//
// Facets are provenance (who made it), not taxonomy (what it is). A category
// tree was the same idea as tags at a coarser grain, and kept forcing a
// one-of-many choice on items that are honestly several things at once. Tags now
// live in search and on the item itself; the rail answers the question the
// taxonomy never could — "show me mine".

import { Heart } from "lucide-react"
import { LIBRARY_FACETS, type LibraryFacet, type LibraryItem } from "@/lib/library"
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
  "flex h-[82dvh] max-h-[82dvh] w-[92vw] max-w-5xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-5xl " +
  "data-[state=closed]:animate-none data-[state=closed]:fade-out-100 data-[state=closed]:zoom-out-100 " +
  "data-[state=open]:animate-none data-[state=open]:fade-in-100 data-[state=open]:zoom-in-100"

export function LibraryRail({
  items,
  facet,
  onFacetChange,
}: {
  items: LibraryItem[]
  facet: LibraryFacet
  onFacetChange: (facet: LibraryFacet) => void
}) {
  const t = useT()
  const label: Record<LibraryFacet, string> = { all: t.rail.all, featured: t.rail.featured, yours: t.rail.yours }
  const count: Record<LibraryFacet, number> = {
    all: items.length,
    featured: items.filter((i) => i.owner === "builtin").length,
    yours: items.filter((i) => i.owner === "user" || i.owner === "local").length,
  }

  return (
    // Hidden on narrow screens — search still filters everything.
    <div className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-white/10 p-2 md:flex">
      <div className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
        {t.rail.browse}
      </div>
      {LIBRARY_FACETS.map((f) => {
        const on = facet === f
        return (
          <button
            key={f}
            onClick={() => onFacetChange(f)}
            className={cn(
              "flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors",
              on
                ? "bg-blue-400/15 font-medium text-blue-400"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{label[f]}</span>
            <span className={cn("font-mono text-[11px]", on ? "text-blue-400/80" : "text-muted-foreground/60")}>
              {count[f]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Tag chips as the item's own metadata — the detail panel's, not the rail's. */
export function LibraryTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded border border-white/5 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
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
  scenes,
  canLike,
  onToggle,
}: {
  likeCount: number
  liked: boolean
  scenes: number
  canLike: boolean
  onToggle?: () => void
}) {
  const t = useT()
  return (
    <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
      {scenes > 0 && (
        <span className="text-muted-foreground/70" title={t.library.usedInScenes(scenes)}>
          {scenes} ⬦
        </span>
      )}
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
