"use client"

// The ONE rail every library wears — grades, graphs, backgrounds.
//
// Facets are provenance (who made it), not taxonomy (what it is). A category
// tree was the same idea as tags at a coarser grain, and kept forcing a
// one-of-many choice on items that are honestly several things at once. Tags now
// live in search and on the item itself; the rail answers the question the
// taxonomy never could — "show me mine".

import { LIBRARY_FACETS, type LibraryFacet, type LibraryItem } from "@/lib/library"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

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
    yours: items.filter((i) => i.owner === "user").length,
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
