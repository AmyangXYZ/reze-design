"use client"

// The browsing half of every library, in one place.
//
// WHAT THIS REPLACED: three shelves — built-in, community, drafts — each its own
// scroll container behind a drag handle. The split was provenance, and provenance
// is not a category: the database has no builtin flag, because a built-in is a
// preset authored by the admin account, and use-community already resolves its
// author to that account's live handle. The UI was the last place treating the two
// as different species, and it put community work in the smaller box below.
//
// So: ONE ranked list, and where something came from is a name on the card.
// Provenance is still reachable — the rail filters by maker — it just stopped
// being the structure.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { Check, ChevronDown, Globe, Heart, LayoutGrid, List, Lock, PenLine, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { LibraryFacet, LibraryKind, LibraryOwner } from "@/lib/library"
import { RailRow, RailSection, RailTags, tagSwatch } from "@/components/editor/library-rail"
import { authorImage } from "@/hooks/use-community"
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu"
import { storageKey } from "@/lib/storage"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** What browsing needs of a row, and no more. Deliberately NOT `LibraryItem`:
 *  presets carry a payload and scenes do not, and the grid never looks at one.
 *
 *  `mine` and `createdAt` come from the server; `visibility` is absent until the
 *  API returns it, and every published row reads as public in the meantime. */
export type BrowseItem = {
  id: string
  kind: LibraryKind
  name: string
  author: string
  description: string
  tags: string[]
  owner: LibraryOwner
  mine?: boolean
  createdAt?: string
  visibility?: "public" | "private"
}

/** Name, maker or tag. Inlined rather than borrowed from lib/library, which
 *  types its argument as a full LibraryItem. */
function matchesQuery(i: BrowseItem, query: string, displayName?: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    (displayName ?? i.name).toLowerCase().includes(q) ||
    i.author.toLowerCase().includes(q) ||
    i.tags.some((x) => x.toLowerCase().includes(q))
  )
}

export type SortKey = "hot" | "new" | "name" | "maker" | "state" | "likes" | "used"
export type Density = "grid" | "list"
/** Provenance is gone as a shelf; as a filter it is All · Yours · Liked. */
export type BrowseFacet = LibraryFacet

// ── Ranking ──────────────────────────────────────────────────────────────────
//
// Reddit's hot: log10 of the score plus a linear term in age. The FORMULA is
// Reddit's; the CONSTANT is not, and that is the whole design decision here.
//
// Reddit divides seconds by 45000, so one day of age is worth roughly two orders
// of magnitude of votes. That is right for a front page, where the job is to
// clear yesterday out, and wrong for a library, where the job is to hand you the
// thirty effects that work. Applied literally it would bury every built-in under
// anything published this week.
//
// HOT_AGE_DAYS is therefore how many days of age cost one order of magnitude of
// likes. NEW_BOOST is the extra weight a fresh publish carries, decaying linearly
// to nothing across NEW_WINDOW_DAYS — a real window at the top for new work,
// bounded so it never permanently outranks what people actually use.
const HOT_AGE_DAYS = 180
const NEW_WINDOW_DAYS = 21
const NEW_BOOST = 0.75
/** Built-ins carry no date. They are the oldest rows in any library, and this is
 *  far enough past NEW_WINDOW_DAYS that the boost is zero either way. */
const UNDATED_AGE_DAYS = 400

const DAY = 86_400_000

function ageDays(item: BrowseItem): number {
  if (!item.createdAt) return UNDATED_AGE_DAYS
  const t = Date.parse(item.createdAt)
  return Number.isNaN(t) ? UNDATED_AGE_DAYS : Math.max(0, (Date.now() - t) / DAY)
}

function hotScore(item: BrowseItem, likes: number): number {
  const age = ageDays(item)
  return (
    Math.log10(Math.max(likes, 1)) -
    age / HOT_AGE_DAYS +
    NEW_BOOST * Math.max(0, 1 - age / NEW_WINDOW_DAYS)
  )
}

/** A draft is unpublished, so it has no visibility of its own — it is the state
 *  BEFORE one. Ordered as the least public thing there is. */
// Two formats, because a column is SCANNED and a panel is READ. In a column the
// dates stack, so they are ISO and tabular and line up digit under digit; in the
// panel there is one of them and it can be a date in words.
export function publishedShort(iso?: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? "—" : d.toISOString().slice(0, 10)
}

export function publishedOn(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.valueOf())
    ? null
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export type ItemState = "draft" | "private" | "public"
export const itemState = (i: BrowseItem): ItemState =>
  i.owner === "local" ? "draft" : (i.visibility ?? "public")

const STATE_RANK: Record<ItemState, number> = { draft: 0, private: 1, public: 2 }

/** Natural direction per column: names read A to Z, counts read biggest first. */
const SORT_DIR: Record<SortKey, 1 | -1> = {
  hot: -1, new: -1, name: 1, maker: 1, state: 1, likes: -1, used: -1,
}
const TEXT_SORTS = new Set<SortKey>(["name", "maker"])

/** Likes and usage come from the stats snapshot, and so does whether YOU liked
 *  it — that is per-viewer, so it can never live on the item. */
export type ItemNumbers = { likes: number; uses: number; liked: boolean }

/** Count a facet's values across the whole library, commonest first. */
function tally<T>(items: T[], pick: (i: T) => string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) for (const v of pick(i)) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// ── Density ──────────────────────────────────────────────────────────────────
//
// ONE setting for every library, and it survives the session.
//
// It is a preference about how you read a list, not a fact about effects or
// grades — so choosing rows in one library and finding thumbnails in the next is
// the app forgetting something you just told it. A module-level store rather
// than state per dialog, so all four agree, and localStorage so the answer
// outlives the tab.
const DENSITY_KEY = storageKey("library-density")

function readDensity(): Density {
  if (typeof window === "undefined") return "grid"
  try {
    return window.localStorage.getItem(DENSITY_KEY) === "list" ? "list" : "grid"
  } catch {
    // Private mode, or storage blocked. A preference is a convenience.
    return "grid"
  }
}

let densityValue: Density = readDensity()
const densityListeners = new Set<() => void>()

function writeDensity(next: Density) {
  densityValue = next
  try {
    window.localStorage.setItem(DENSITY_KEY, next)
  } catch {
    // Unwritable storage still changes the view; it just will not be remembered.
  }
  for (const l of densityListeners) l()
}

function subscribeDensity(l: () => void) {
  densityListeners.add(l)
  return () => {
    densityListeners.delete(l)
  }
}

// ── Browse state ─────────────────────────────────────────────────────────────

/**
 * Every library's browsing state and the rows it produces.
 *
 * `numbers` is passed in rather than read off the item: likes and usage live in
 * the stats snapshot, keyed by id, and a library that owned a second copy of them
 * would be a library that disagrees with the cards.
 */
export function useLibraryBrowse<T extends BrowseItem>(
  items: T[],
  numbers: (id: string) => ItemNumbers,
  opts: {
    initialFacet?: BrowseFacet
    displayName?: (item: T) => string
    /** Facet counts over the WHOLE corpus, when the client holds only a page. */
    counts?: { all: number; yours: number; liked: number }
    /** Tag counts over the whole corpus, same reason. */
    tagCounts?: [string, number][]
    /** Fired when the rail changes facet. The gallery fetches a page per facet
     *  and paints its cache here, in the event rather than in an effect. */
    onFacetChange?: (facet: BrowseFacet) => void
  } = {},
) {
  const { initialFacet = "all", displayName, counts: givenCounts, tagCounts, onFacetChange } = opts
  const [query, setQuery] = useState("")
  const [facet, setFacetState] = useState<BrowseFacet>(initialFacet)
  const setFacet = useCallback(
    (next: BrowseFacet) => {
      setFacetState(next)
      onFacetChange?.(next)
    },
    [onFacetChange],
  )
  const [tag, setTag] = useState<string | null>(null)
  const [maker, setMaker] = useState<string | null>(null)
  const [sort, setSortKey] = useState<SortKey>("hot")
  const [dir, setDir] = useState<1 | -1>(-1)
  const density = useSyncExternalStore(subscribeDensity, () => densityValue, () => "grid" as Density)
  const setDensity = writeDensity

  /** One click sorts by a column; a second reverses it. */
  const setSort = useCallback(
    (key: SortKey) => {
      if (sort === key) setDir((d) => (d === 1 ? -1 : 1))
      else { setSortKey(key); setDir(SORT_DIR[key]) }
    },
    [sort],
  )

  /** Choosing from the dropdown always starts a column in its natural direction. */
  const chooseSort = useCallback((key: SortKey) => {
    setSortKey(key)
    setDir(SORT_DIR[key])
  }, [])

  const matchesFacet = useCallback(
    (i: T) => {
      if (facet === "all") return true
      if (facet === "yours") return i.owner === "local" || i.mine === true
      return numbers(i.id).liked === true
    },
    // `numbers` is memoized by its owner; liked comes through it.
    [facet, numbers],
  )

  const rows = useMemo(() => {
    const kept = items.filter(
      (i) =>
        matchesFacet(i) &&
        (!tag || i.tags.includes(tag)) &&
        (!maker || i.author === maker) &&
        matchesQuery(i, query, displayName?.(i)),
    )
    const value = (i: T): string | number => {
      switch (sort) {
        case "hot": return hotScore(i, numbers(i.id).likes)
        case "new": return -ageDays(i)
        case "name": return displayName?.(i) ?? i.name
        case "maker": return i.author
        case "state": return STATE_RANK[itemState(i)]
        case "likes": return numbers(i.id).likes
        case "used": return numbers(i.id).uses
      }
    }
    const text = TEXT_SORTS.has(sort)
    return [...kept].sort((a, b) => {
      // A draft is what you were just working on, so it leads every ordering.
      // Two tiers, each sorted by the chosen column: unpublished work stays
      // reachable without the sort you picked stopping at the boundary.
      const d = Number(itemState(b) === "draft") - Number(itemState(a) === "draft")
      if (d) return d
      const x = value(a), y = value(b)
      const cmp = text ? String(x).localeCompare(String(y)) : (x as number) - (y as number)
      if (cmp !== 0) return cmp * dir
      // Equal scores read as alphabetical, never as whatever order the arrays
      // happened to be concatenated in.
      const an = displayName?.(a) ?? a.name
      const bn = displayName?.(b) ?? b.name
      return an.localeCompare(bn)
    })
  }, [items, matchesFacet, tag, maker, query, displayName, sort, dir, numbers])

  /** Counts run over the WHOLE library, never the filtered view — a rail whose
   *  numbers shrank as you narrowed it would be a rail you cannot navigate by. */
  const counts = useMemo(
    () =>
      givenCounts ?? {
        all: items.length,
        yours: items.filter((i) => i.owner === "local" || i.mine === true).length,
        liked: items.filter((i) => numbers(i.id).liked).length,
      },
    [givenCounts, items, numbers],
  )

  const makers = useMemo(() => tally(items, (i) => [i.author]), [items])
  const tags = useMemo(() => tagCounts ?? tally(items, (i) => i.tags), [tagCounts, items])

  const filtered = facet !== "all" || tag !== null || maker !== null
  const clear = useCallback(() => { setFacet("all"); setTag(null); setMaker(null) }, [setFacet])

  return {
    rows, counts, makers, tags, filtered, clear,
    query, setQuery, facet, setFacet, tag, setTag, maker, setMaker,
    sort, dir, setSort, chooseSort, density, setDensity,
  }
}

export type Browse<T extends BrowseItem> = ReturnType<typeof useLibraryBrowse<T>>

// ── Chrome ───────────────────────────────────────────────────────────────────

const STATE_ICON: Record<ItemState, typeof Lock> = { draft: PenLine, private: Lock, public: Globe }

/** A maker's account picture, or their initials when the account has none and
 *  when there is no database to ask. The image is the account's own — the same
 *  one the account menu shows for you. */
export function AuthorAvatar({ name, className }: { name: string; className?: string }) {
  const src = authorImage(name)
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn("size-4 shrink-0 rounded-full object-cover", className)} />
  }
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[8px] font-semibold",
        tagSwatch(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

/** Initials for a maker chip. Handles are latin; CJK display names are not, so
 *  the range is kept wide enough not to render an empty circle. */
const initials = (n: string) => (n.match(/[a-zA-Z0-9一-鿿]/g) ?? []).slice(0, 2).join("").toUpperCase()

/**
 * The rail: what to look at, never where it came from.
 *
 * MAKERS is the addition, and it is the point. It is how provenance survives
 * losing its shelf, it credits the people whose work fills the library, and it is
 * the same query a profile page runs.
 */
export function LibraryRailFilters<T extends BrowseItem>({ browse }: { browse: Browse<T> }) {
  const t = useT()
  const { counts, makers, tags, facet, setFacet, maker, setMaker, tag, setTag, filtered, clear } = browse

  return (
    <div className="hidden w-50 shrink-0 flex-col border-r border-line-strong p-2 md:flex">
      <RailSection title={t.rail.browse}>
        <div className="flex flex-col gap-0.5">
          <RailRow label={t.rail.all} count={counts.all} active={facet === "all"} onClick={() => setFacet("all")} />
          <RailRow label={t.rail.yours} count={counts.yours} active={facet === "yours"} onClick={() => setFacet("yours")} />
          <RailRow label={t.rail.liked} count={counts.liked} active={facet === "liked"} onClick={() => setFacet("liked")} />
          {/* Always rendered. A control that appears when it becomes relevant
              moves everything under it, and the rail is a thing you aim at. */}
          <button
            type="button"
            onClick={clear}
            aria-hidden={!filtered}
            tabIndex={filtered ? 0 : -1}
            className={cn(
              "mt-0.5 ml-2 text-left text-[11px] underline underline-offset-2 transition-colors",
              filtered
                ? "cursor-pointer text-muted-foreground hover:text-foreground"
                : "pointer-events-none text-transparent",
            )}
          >
            {t.rail.clearFilters}
          </button>
        </div>
      </RailSection>

      {/* Makers. This is where provenance went when the shelves came out: the
          library credits the people who filled it, and browsing by one of them is
          the same query a profile page runs. Shown even at one maker, because who
          made the library is worth saying whether or not it filters anything. */}
      {makers.length > 0 && (
        <RailSection title={t.rail.makers}>
          <div className="flex flex-col gap-0.5">
            {makers.slice(0, 6).map(([who, n]) => (
              <RailRow
                key={who}
                label={who}
                count={n}
                active={maker === who}
                onClick={() => setMaker(maker === who ? null : who)}
                leading={<AuthorAvatar name={who} />}
              />
            ))}
          </div>
        </RailSection>
      )}

      {/* The cloud, as it was: nine hues, frequency first, counts on the chip. */}
      <RailTags counts={tags} tag={tag} onTagChange={setTag} />
    </div>
  )
}

/** Search, sort and density — the controls that decide what the middle column
 *  holds. Kind-specific things (title, New, close) stay with the host. */
export function LibraryToolbar<T extends BrowseItem>({
  browse, usedLabel,
}: { browse: Browse<T>; usedLabel: string }) {
  const t = useT()
  const { query, setQuery, sort, chooseSort, density, setDensity } = browse
  // Two orderings, because those are the two the rest of the chrome cannot give
  // you: what is good now, and what is newest. Maker and liked are rail filters,
  // and every other column sorts by its own header in the list view — putting
  // all seven here would be a third way to do what two surfaces already do.
  //
  // A column sort chosen in the list still shows here, so the control never
  // reads blank while the grid is ordered by something.
  const COLUMN_LABEL: Record<SortKey, string> = {
    hot: t.rail.sortHot, new: t.rail.sortNew, name: t.rail.sortName,
    maker: t.rail.makers, state: t.rail.state, likes: t.rail.likes, used: usedLabel,
  }
  const options: [SortKey, string][] = [
    ["hot", t.rail.sortHot],
    ["new", t.rail.sortNew],
    ...(sort === "hot" || sort === "new" ? [] : ([[sort, COLUMN_LABEL[sort]]] as [SortKey, string][])),
  ]
  return (
    <>
      {/* Every control in this header is one height and one type size. The
          search is the only one that grows, and it stops well short of the
          title. */}
      <div className="relative ml-auto w-32 max-w-[24%]">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.rail.search}
          className="h-6 border-line-strong bg-white/5 pl-7 text-[11px] md:text-[11px]"
        />
      </div>

      {/* The app's own Select, not a bare one: a native dropdown renders in the
          platform's chrome and reads as a hole in the panel. */}
      <Select value={sort} onValueChange={(v) => chooseSort(v as SortKey)}>
        <SelectTrigger
          aria-label={t.rail.sort}
          className="w-24 shrink-0 justify-between border-line-strong bg-white/5 px-2 text-[11px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="min-w-24">
          {options.map(([k, label]) => (
            <SelectItem key={k} value={k} className="text-[11px]">{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex h-6 shrink-0 items-center gap-0.5 rounded-chip border border-line-strong bg-white/5 p-0.5">
        {([["grid", LayoutGrid], ["list", List]] as const).map(([d, Icon]) => (
          <button
            key={d}
            type="button"
            aria-pressed={density === d}
            aria-label={d === "grid" ? t.rail.grid : t.rail.list}
            onClick={() => setDensity(d)}
            className={cn(
              "flex size-[18px] cursor-pointer items-center justify-center rounded-[4px] transition-colors",
              density === d ? "bg-blue-400/15 text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            <Icon className="size-3" />
          </button>
        ))}
      </div>
    </>
  )
}

// ── Results ──────────────────────────────────────────────────────────────────

/** One card size for every kind. A scene poster is not a bigger idea than an
 *  effect, and a grid whose track width changes per kind is four grids again.
 *  The count follows the width, so a card never shrinks to satisfy a number. */
const GRID = "grid content-start gap-2.5 px-3.5 pt-2 pb-6 [grid-template-columns:repeat(auto-fill,minmax(118px,1fr))]"
const COLS = "grid items-center gap-2 [grid-template-columns:30px_minmax(0,1.4fr)_minmax(0,1.3fr)_64px_78px_46px_50px]"

/** A sortable column heading. One click sorts by it, a second reverses. */
function SortHeader({
  k, sort, dir, onSort, right, children,
}: { k: SortKey; sort: SortKey; dir: 1 | -1; onSort: (k: SortKey) => void; right?: boolean; children: React.ReactNode }) {
  const active = sort === k
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        "-mx-1 flex items-center gap-0.5 rounded-[4px] px-1 py-0.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors hover:bg-white/5",
        right && "justify-end",
        active ? "text-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <ChevronDown
        className={cn("size-2 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-0", dir === 1 && "rotate-180")}
      />
    </button>
  )
}

// ── Visibility ───────────────────────────────────────────────────────────────
//
// One rule, stated once and shown everywhere: private opens to public, and
// never closes again. Once other people can reach an item their scenes can pin
// it, and retracting it would break work that is not yours to break. Deleting is
// the way out of public, and it is deliberate.

export type Visibility = "public" | "private"
export const VISIBILITIES: Visibility[] = ["public", "private"]
export const VISIBILITY_ICON: Record<Visibility, typeof Lock> = { public: Globe, private: Lock }

/** Whether `next` is reachable from `current`. Undefined current = a new item,
 *  which may start anywhere. */
export const canBecome = (next: Visibility, current?: Visibility) =>
  next !== "private" || current === undefined || current === "private"

export function useVisibilityLabels() {
  const t = useT()
  return {
    label: { public: t.library.visPublic, private: t.library.visPrivate },
  }
}

/** The three-way choice a publish dialog shows. */
export function VisibilityPicker({
  value, onChange, current,
}: { value: Visibility; onChange: (v: Visibility) => void; current?: Visibility }) {
  const t = useT()
  const { label } = useVisibilityLabels()
  const locked = !canBecome("private", current)
  return (
    <div>
      <span className="text-xs text-muted-foreground">{t.library.visibility}</span>
      <div className="mt-1 flex gap-0.5 rounded-interior border border-line-strong bg-white/5 p-0.5">
        {VISIBILITIES.map((v) => {
          const Icon = VISIBILITY_ICON[v]
          const disabled = !canBecome(v, current)
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-chip py-1.5 text-xs transition-colors",
                value === v ? "bg-blue-400/15 text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label[v]}
            </button>
          )
        })}
      </div>
      {locked && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{t.library.visLocked}</p>
      )}
    </div>
  )
}

/** The visibility submenu every library hangs off a card you own. */
export function VisibilityMenu({
  current, onChange,
}: { current: Visibility; onChange: (v: Visibility) => void }) {
  const t = useT()
  const { label } = useVisibilityLabels()
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{t.library.visibility}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-36">
        {VISIBILITIES.map((v) => {
          const Icon = VISIBILITY_ICON[v]
          return (
            <ContextMenuItem
              key={v}
              disabled={!canBecome(v, current) || v === current}
              onSelect={() => onChange(v)}
            >
              <Icon className={cn("size-3.5", v === current && "text-blue-400")} />
              {label[v]}
            </ContextMenuItem>
          )
        })}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

export type CardMeta = {
  /** The thumbnail. Every kind draws its own. */
  preview: React.ReactNode
  applied?: boolean
  /** Replaces the label while a card is being renamed in place. Rename belongs
   *  on the card, where the name is, rather than in a dialog about the name. */
  nameNode?: React.ReactNode
}

type ResultsProps<T extends BrowseItem> = {
  browse: Browse<T>
  selectedId: string | null
  onSelect: (item: T) => void
  onActivate?: (item: T) => void
  meta: (item: T) => CardMeta
  numbers: (id: string) => ItemNumbers
  displayName?: (item: T) => string
  /** Wraps a card in the kind's context menu. Identity by default. */
  wrap?: (item: T, node: React.ReactNode) => React.ReactNode
  usedLabel: string
  empty: React.ReactNode
  /** Below the rows, inside the same scroller: paging, spinners, errors. */
  footer?: React.ReactNode
}

export function LibraryResults<T extends BrowseItem>({
  browse, selectedId, onSelect, onActivate, meta, numbers, displayName, wrap, usedLabel, empty, footer,
}: ResultsProps<T>) {
  const t = useT()
  const { rows, density, sort, dir, setSort } = browse

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center p-10 text-center text-[13px] text-muted-foreground">{empty}</div>
        {footer}
      </div>
    )
  }

  const id = (i: T) => i.id
  const label = (i: T) => displayName?.(i) ?? i.name

  if (density === "list") {
    const th = (k: SortKey, children: React.ReactNode, right?: boolean) => (
      <SortHeader k={k} sort={sort} dir={dir} onSort={setSort} right={right}>{children}</SortHeader>
    )
    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-5">
          <div className={cn(COLS, "sticky top-0 z-10 border-b border-line bg-zinc-950/95 px-1.5 py-1.5")}>
            <span />
            {th("name", t.rail.name)}
            {th("maker", t.rail.makers)}
            {th("state", t.rail.state)}
            {/* The publish date IS the "new" ordering, so the column and the
                menu drive one sort rather than two that agree by accident. */}
            {th("new", t.rail.published)}
            {th("likes", t.rail.likes, true)}
            {th("used", usedLabel, true)}
          </div>
          {rows.map((item) => {
            const st = itemState(item)
            const Icon = STATE_ICON[st]
            const n = numbers(id(item))
            const card = meta(item)
            const isApplied = card.applied === true
            const isSelected = selectedId === id(item)
            // Applied and selected are the SAME blue at two strengths — a wash
            // and blue text, deeper for the row you are on.
            //
            // Both are "active", which is the one thing blue means here, so they
            // belong to one colour. What was tried and rejected: amber, which
            // resolves to olive over a near-black ground at every alpha; an inset
            // left bar, a hard saturated edge on every applied row; and an
            // outline, which reads as a second kind of border next to the real
            // ones already in the grid.
            const lit = isSelected || isApplied
            const tone = lit ? "text-blue-400" : ""
            const cell = tone || "text-muted-foreground group-hover:text-foreground"
            const row = (
              <div
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onClick={() => onSelect(item)}
                onDoubleClick={() => onActivate?.(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item) }
                }}
                className={cn(
                  COLS,
                  "group cursor-default rounded-chip px-1.5 py-1 transition-colors",
                  tone,
                  isSelected
                    ? "bg-blue-400/20"
                    : isApplied
                      ? "bg-blue-400/10 hover:bg-blue-400/16"
                      : "hover:bg-white/5",
                )}
              >
                <div className="h-[19px] w-[30px] overflow-hidden rounded-[4px] border border-line-strong">{card.preview}</div>
                <span className="min-w-0 truncate text-xs">{card.nameNode ?? label(item)}</span>
                <span className={cn("flex min-w-0 items-center gap-1.5 font-mono text-[11px] transition-colors", cell)}>
                  <AuthorAvatar name={item.author} className="size-3.5" />
                  <span className="truncate">{item.author}</span>
                </span>
                <span className={cn("flex items-center gap-1 truncate font-mono text-[11px] transition-colors", cell)}>
                  <Icon className="size-2.5 shrink-0" />
                  {t.rail.states[st]}
                </span>
                <span className={cn("font-mono text-[11px] tabular-nums transition-colors", cell)}>{publishedShort(item.createdAt)}</span>
                <span className={cn("text-right font-mono text-[11px] tabular-nums transition-colors", cell)}>{n.likes}</span>
                <span className={cn("text-right font-mono text-[11px] tabular-nums transition-colors", cell)}>{n.uses}</span>
              </div>
            )
            return <div key={id(item)}>{wrap ? wrap(item, row) : row}</div>
          })}
          {footer}
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={GRID}>
        {rows.map((item) => {
          const m = meta(item)
          const st = itemState(item)
          const Icon = STATE_ICON[st]
          const card = (
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selectedId === id(item)}
              onClick={() => onSelect(item)}
              onDoubleClick={() => onActivate?.(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(item) }
              }}
              className="flex cursor-default flex-col gap-1.5 text-left"
            >
              <div
                className={cn(
                  "relative aspect-[16/10] overflow-hidden rounded-interior border transition-colors",
                  selectedId === id(item) ? "border-blue-400 ring-1 ring-blue-400" : "border-line-strong hover:border-white/25",
                )}
              >
                {m.preview}
                {m.applied ? (
                  <span className="absolute top-1 left-1 flex items-center gap-1 rounded-[4px] border border-blue-400/50 bg-zinc-950/85 px-1 py-px font-mono text-[10px] text-blue-400">
                    <Check className="size-2.5" />
                    {t.effectLibrary.applied}
                  </span>
                ) : st !== "public" ? (
                  <span className="absolute top-1 left-1 flex items-center gap-1 rounded-[4px] border border-line-strong bg-zinc-950/85 px-1 py-px font-mono text-[10px] text-muted-foreground">
                    <Icon className="size-2.5" />
                    {t.rail.states[st]}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <div className={cn("truncate text-xs leading-tight", (selectedId === id(item) || m.applied) && "text-blue-400")}>
                  {m.nameNode ?? label(item)}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <AuthorAvatar name={item.author} className="size-3.5" />
                  <span className="min-w-0 truncate">{item.author}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 tabular-nums">
                    <Heart className="size-3" />
                    {numbers(id(item)).likes}
                  </span>
                </div>
              </div>
            </div>
          )
          return <div key={id(item)}>{wrap ? wrap(item, card) : card}</div>
        })}
        {footer && <div className="col-span-full">{footer}</div>}
      </div>
    </ScrollArea>
  )
}
