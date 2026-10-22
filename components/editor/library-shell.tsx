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

import { trendScore } from "@/lib/trend"
import { Button } from "@/components/ui/button"
import { PublishSwitch } from "@/components/editor/publish-switch"
import { STAGE_BOUND_TAG } from "@/lib/effects"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Globe, Heart, Lock, PenLine, Plus, Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { LibraryFacet, LibraryKind, LibraryOwner } from "@/lib/library"
import { authorImage, authorVerified } from "@/lib/community-store"
import { UserAvatar } from "@/components/user-avatar"
import { VerifiedBadge } from "@/components/verified-badge"
import Link from "next/link"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { storageKey } from "@/lib/storage"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { failingVersion, isFailing, retryNow, watchFailing } from "@/lib/net"

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
function matchesQuery(i: BrowseItem, query: string, displayName?: string, extra?: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    (displayName ?? i.name).toLowerCase().includes(q) ||
    // The stored name too: a built-in shown in Chinese still answers to English.
    i.name.toLowerCase().includes(q) ||
    i.author.toLowerCase().includes(q) ||
    i.tags.some((x) => x.toLowerCase().includes(q)) ||
    (extra?.toLowerCase().includes(q) ?? false)
  )
}

export type SortKey = "hot" | "new" | "name" | "maker" | "state" | "likes" | "used"
/** Provenance is gone as a shelf; as a filter it is All · Yours · Liked. */
export type BrowseFacet = LibraryFacet

// ── Ranking ──────────────────────────────────────────────────────────────────
//
// Trending is lib/trend.ts's score, computed with the stats: the publish, the
// likes, and other people's picks, each fading by half every two weeks. An
// item the stats do not know yet (a draft, or before they load) scores on its
// own date alone, which is where it would start anyway.
function hotScore(item: BrowseItem, trend: number | undefined): number {
  return typeof trend === "number" && Number.isFinite(trend) ? trend : trendScore([publishedAt(item)])
}

/** When it was published. An undated draft is brand new; an undated built-in
 *  is the oldest thing there is. */
function publishedAt(item: BrowseItem): number {
  const t = item.createdAt ? Date.parse(item.createdAt) : NaN
  return Number.isNaN(t) ? (item.owner === "local" ? Date.now() : 0) : t
}

/** A draft is unpublished, so it has no visibility of its own — it is the state
 *  BEFORE one. Ordered as the least public thing there is. */
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
export type ItemNumbers = { likes: number; uses: number; liked: boolean; trend: number }

/** Count a facet's values across the whole library, commonest first. */
function tally<T>(items: T[], pick: (i: T) => string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) for (const v of pick(i)) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// HOW THE LIST IS ORDERED, shared and remembered.
//
// Trending or New is a reading preference, not a fact about effects: someone who
// browses by what is new wants that in all four libraries, and having each
// dialog start on Trending again is the app forgetting what it was just told.
// Stored as `key:dir` so a reversed column survives too.
const SORT_KEY = storageKey("library-sort")

function readSort(): { key: SortKey; dir: 1 | -1 } {
  const fallback = { key: "hot" as SortKey, dir: -1 as const }
  if (typeof window === "undefined") return fallback
  try {
    const [key, dir] = (window.localStorage.getItem(SORT_KEY) ?? "").split(":")
    // Validated, never trusted: this is a string a person can edit, and an
    // unknown key would fall through the sort switch and order by nothing.
    if (!key || !(key in SORT_DIR)) return fallback
    return { key: key as SortKey, dir: dir === "1" ? 1 : -1 }
  } catch {
    return fallback
  }
}

let sortValue = readSort()
const sortListeners = new Set<() => void>()

function writeSort(key: SortKey, dir: 1 | -1) {
  sortValue = { key, dir }
  try {
    window.localStorage.setItem(SORT_KEY, `${key}:${dir}`)
  } catch {
    // Unwritable storage still reorders the list; it just will not be remembered.
  }
  for (const l of sortListeners) l()
}

function subscribeSort(l: () => void) {
  sortListeners.add(l)
  return () => {
    sortListeners.delete(l)
  }
}

/** Stable across renders so useSyncExternalStore does not loop on a new object. */
const SORT_SERVER = { key: "hot" as SortKey, dir: -1 as 1 | -1 }

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
    /** More text the search answers to — a built-in's other-language name and tags. */
    searchText?: (item: T) => string
    /** Facet counts over the WHOLE corpus, when the client holds only a page. */
    counts?: { all: number; yours: number; liked: number }
    /** Tag counts over the whole corpus, same reason. */
    tagCounts?: [string, number][]
    /** Makers over a whole catalogue the client holds one page of (the
     *  gallery); otherwise tallied from `items`, which is everything. */
    makerCounts?: [string, number][]
    /** Fired when the rail changes facet. The gallery fetches a page per facet
     *  and paints its cache here, in the event rather than in an effect. */
    onFacetChange?: (facet: BrowseFacet) => void
  } = {},
) {
  const { initialFacet = "all", displayName, searchText, counts: givenCounts, tagCounts, makerCounts, onFacetChange } = opts
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
  const { key: sort, dir } = useSyncExternalStore(subscribeSort, () => sortValue, () => SORT_SERVER)

  /** One click sorts by a column; a second reverses it. */
  const setSort = useCallback((key: SortKey) => {
    const cur = sortValue
    if (cur.key === key) writeSort(key, cur.dir === 1 ? -1 : 1)
    else writeSort(key, SORT_DIR[key])
  }, [])

  /** Choosing from the dropdown always starts a column in its natural direction. */
  const chooseSort = useCallback((key: SortKey) => {
    writeSort(key, SORT_DIR[key])
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
        matchesQuery(i, query, displayName?.(i), searchText?.(i)),
    )
    const value = (i: T): string | number => {
      switch (sort) {
        case "hot": return hotScore(i, numbers(i.id).trend)
        case "new": return publishedAt(i)
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
      // Behind everything else, in any ordering: what draws only on a converted
      // game stage (its bones) — on its own it shows nothing.
      const k = Number(a.tags.includes(STAGE_BOUND_TAG)) - Number(b.tags.includes(STAGE_BOUND_TAG))
      if (k) return k
      const x = value(a), y = value(b)
      const cmp = text ? String(x).localeCompare(String(y)) : (x as number) - (y as number)
      if (cmp !== 0) return cmp * dir
      // Equal scores read as alphabetical, never as whatever order the arrays
      // happened to be concatenated in.
      const an = displayName?.(a) ?? a.name
      const bn = displayName?.(b) ?? b.name
      return an.localeCompare(bn)
    })
  }, [items, matchesFacet, tag, maker, query, displayName, searchText, sort, dir, numbers])

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

  const makers = useMemo(() => makerCounts ?? tally(items, (i) => [i.author]), [makerCounts, items])
  const tags = useMemo(() => tagCounts ?? tally(items, (i) => i.tags), [tagCounts, items])

  const filtered = facet !== "all" || tag !== null || maker !== null
  const clear = useCallback(() => { setFacet("all"); setTag(null); setMaker(null) }, [setFacet])

  return {
    rows, counts, makers, tags, filtered, clear,
    query, setQuery, facet, setFacet, tag, setTag, maker, setMaker,
    sort, dir, setSort, chooseSort,
  }
}

export type Browse<T extends BrowseItem> = ReturnType<typeof useLibraryBrowse<T>>

// ── Chrome ───────────────────────────────────────────────────────────────────

const STATE_ICON: Record<ItemState, typeof Lock> = { draft: PenLine, private: Lock, public: Globe }

/** A maker's account picture, or their initials when the account has none and
 *  when there is no database to ask. The image is the account's own — the same
 *  one the account menu shows for you. */
export function AuthorAvatar({
  name,
  image,
  className,
}: {
  name: string
  /** Given by rows that carry their own (the gallery); otherwise the library's. */
  image?: string | null
  className?: string
}) {
  return <UserAvatar name={name} image={image ?? authorImage(name)} className={className} />
}

/**
 * A maker's name, with their page one click away — in a new tab, so the library
 * and the scene behind it stay where they are. A draft's author has no page, so a
 * draft's name stays text. The link keeps its clicks and keys to itself: it sits
 * in cards that select on click and on Enter.
 */
export function AuthorLink({
  name,
  draft = false,
  at = false,
  className,
}: {
  name: string
  draft?: boolean
  /** Written as a handle, @name — the gallery's way, as its tags are #tag. */
  at?: boolean
  className?: string
}) {
  if (draft) return <span className={className}>{at ? `@${name}` : name}</span>
  const keep = (e: React.SyntheticEvent) => e.stopPropagation()
  // The check sits beside the link, not in it, so a long name truncates and
  // the check stays. Every caller lays the name out in a flex row.
  return (
    <>
      <Link
        href={`/${name}`}
        target="_blank"
        rel="noopener"
        prefetch={false}
        onClick={keep}
        onDoubleClick={keep}
        onKeyDown={keep}
        className={cn("underline-offset-2 transition-colors hover:text-foreground hover:underline", className)}
      >
        {at ? `@${name}` : name}
      </Link>
      {authorVerified(name) && <VerifiedBadge />}
    </>
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

/** Whether something at `current` can no longer be made private. */
export const visibilityLocked = (current?: Visibility) => !canBecome("private", current)

/**
 * Visibility in a publish dialog: one switch among the dialog's others
 * (PublishSwitches), since there are only two answers. ON is public, the
 * default, and the label names what it is — Public with the globe, Private
 * with the lock — so the state reads from the words, not only the switch.
 * Something already public cannot go back, so its switch is held on and the
 * dialog says why (visibilityLocked).
 */
export function VisibilitySwitch({
  value, onChange, current,
}: { value: Visibility; onChange: (v: Visibility) => void; current?: Visibility }) {
  const { label } = useVisibilityLabels()
  return (
    <PublishSwitch
      icon={VISIBILITY_ICON[value]}
      label={label[value]}
      // Both words' room, so the switch beside them never moves.
      widest={[label.public, label.private]}
      checked={value === "public"}
      onCheckedChange={(on) => onChange(on ? "public" : "private")}
      disabled={visibilityLocked(current)}
    />
  )
}

/**
 * The one visibility move there is — private to public — asked first, because
 * it is permanent (see the rule above).
 *
 * A hook, not state inside the menu: the context menu unmounts the moment it
 * closes, and would take a dialog it owned with it. The library renders
 * `dialog` at its root, beside its delete confirmation.
 */
export function useMakePublic() {
  const t = useT()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const ask = useCallback((go: () => void) => setPending(() => go), [])
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title={t.library.makePublicTitle}
      body={t.library.makePublicConfirm}
      confirmLabel={t.library.makePublicLabel}
      cancelLabel={t.library.cancel}
      tone="accent"
      onConfirm={() => pending?.()}
    />
  )
  return { ask, dialog }
}

/** What a card you own offers about visibility: "Make public…" while it is
 *  private, and nothing once it is public — there is no move left, and a
 *  submenu of two greyed-out choices said so less clearly than its absence. */
export function VisibilityMenu({ current, onMakePublic }: { current: Visibility; onMakePublic: () => void }) {
  const t = useT()
  if (current !== "private") return null
  return (
    <ContextMenuItem onSelect={onMakePublic}>
      <Globe className="size-3.5" />
      {t.library.makePublic}
    </ContextMenuItem>
  )
}

/**
 * A card's name while it is being renamed. The same field in every library.
 *
 * Focus waits a frame: the context menu that opened it is still closing, and
 * its focus trap pulls focus back to the menu item. Taken at once, the field
 * blurred straight away and committed the old name, so no rename ever stuck.
 * Keys stop here because the card underneath takes Space and Enter as "select".
 */
export function RenameField({
  name,
  error,
  onCommit,
  onCancel,
  onEdit,
}: {
  name: string
  error: boolean
  onCommit: (value: string) => void
  onCancel: () => void
  onEdit: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <Input
      ref={ref}
      defaultValue={name}
      // Bare and inheriting: the label's own font and line height, so the field
      // is exactly the label's height. The box grows outward by its padding, so
      // the text sits exactly where the label's did.
      variant="bare"
      className={cn(
        "-mx-1.5 w-[calc(100%+0.75rem)] min-w-0 rounded-chip bg-white/5 px-1.5 ring-1 ring-line-strong ring-inset",
        error && "ring-red-400",
      )}
      onClick={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
      onChange={onEdit}
      onBlur={(ev) => !cancelled.current && onCommit(ev.target.value)}
      onKeyDown={(ev) => {
        ev.stopPropagation()
        if (ev.key === "Enter") ev.currentTarget.blur()
        if (ev.key === "Escape") {
          cancelled.current = true
          onCancel()
        }
      }}
    />
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

/**
 * One line, only while a load behind the list is failing: the rows above are
 * the saved copy, and it is being retried. Nothing while things work, nothing
 * during the in-request retries (lib/net fetchJson) that cover most blips, and
 * it goes away by itself when a retry lands. Amber, the chrome's "it still
 * works, but read this". Retry asks now instead of at the next wait.
 */
function OfflineLine({ watch, empty }: { watch: readonly string[]; empty?: boolean }) {
  const t = useT()
  return (
    <div className="flex items-center justify-center gap-1.5 px-3 py-3 text-2xs text-muted-foreground">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
      {/* With nothing saved to show, it says what it is doing instead. */}
      <span>{empty ? t.library.offlineEmpty : t.library.offline}</span>
      <Button variant="bare" onClick={() => retryNow(watch)} className="text-foreground hover:underline">
        {t.library.retry}
      </Button>
    </div>
  )
}

// ── The dock ─────────────────────────────────────────────────────────────────
//
// A library is a column on the right of the cover, where the render, publish
// and AI columns stand, set as type past a hairline like the AI's, and the
// canvas beside it is the preview: picking a card puts it on the scene. From
// the top: what is picked; the words that narrow the shelf; the shelf, two
// cards across.

/** The detail's actions: small words on their own line under what it is, so
 *  the name never shares its line with them. */
export const DETAIL_ACTION =
  "flex h-5 shrink-0 items-center gap-1 bg-transparent p-0 has-[>svg]:px-0 text-xs font-normal text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground [&_svg]:size-3.5"
/** A draft's Publish, alone in the middle of its detail: a hairline frame in
 *  the ink, no fill. */
export const DETAIL_OUTLINED =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-chip border border-line-strong bg-transparent px-3 has-[>svg]:px-3 text-xs font-normal text-foreground shadow-none hover:bg-white/10 [&_svg]:size-3.5"

export function LibraryDock<T extends BrowseItem>({
  title,
  context,
  browse,
  onClose,
  onNew,
  z,
  onPointerDownCapture,
  onFocusCapture,
  detail,
  cards,
  children,
}: {
  title: string
  /** A line under the title: what a pick applies to. */
  context?: React.ReactNode
  browse: Browse<T>
  onClose: () => void
  onNew?: () => void
  z: number
  onPointerDownCapture: React.PointerEventHandler
  onFocusCapture: React.FocusEventHandler
  /** What is picked (LibraryDetail). */
  detail: React.ReactNode
  /** The shelf (LibraryCards). */
  cards: React.ReactNode
  /** Its dialogs: delete and make-public confirmations. */
  children?: React.ReactNode
}) {
  const t = useT()
  const { facet, setFacet, filtered, clear, query, setQuery, sort, chooseSort } = browse

  const word = (on: boolean, label: React.ReactNode, onClick: () => void, key?: string) => (
    <Button
      key={key}
      variant="bare"
      onClick={onClick}
      className={cn(
        "relative flex shrink-0 items-center gap-1 py-1 text-xs whitespace-nowrap after:absolute after:inset-x-0 after:bottom-0 after:h-[1.5px]",
        on ? "text-foreground after:bg-blue-400" : "text-foreground",
      )}
    >
      {label}
    </Button>
  )

  return (
    <section
      data-edge="right"
      data-ink-zone
      style={{ zIndex: z }}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      className={cn(
        "cover-type dock-backing absolute top-16 right-7 bottom-16 flex w-[18rem] flex-col gap-3 pl-6",
      )}
    >
      {/* The AI column's divider: a hairline clear of the column, from the
          title row's middle to the shelf's foot. */}
      <span aria-hidden data-divider className="absolute top-2.5 bottom-5 left-0 w-px bg-line-strong" />
      <div className="flex h-6 shrink-0 items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        {onNew && (
          <Button variant="bare" onClick={onNew} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Plus className="size-3.5" />
            {t.library.new}
          </Button>
        )}
        <Button variant="bare" onClick={onClose} aria-label={t.library.close} className="-mr-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </Button>
      </div>
      {context !== undefined && <p className="-mt-2 h-4 truncate font-mono text-2xs text-muted-foreground">{context}</p>}
      {/* One height, picked or not, so the shelf below never moves. */}
      <div className="-mt-1.5 -mb-4 min-h-[6.625rem] shrink-0">{detail}</div>
      <label className="relative flex h-7 shrink-0 items-center gap-1.5 text-muted-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line-strong focus-within:after:bg-foreground">
        <Search className="size-3.5 shrink-0" strokeWidth={1.5} />
        <Input
          variant="bare"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.rail.search}
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground"
        />
      </label>
      <div className="flex shrink-0 items-center gap-4">
        {word(!filtered, t.rail.all, clear)}
        {word(facet === "yours", t.rail.yours, () => setFacet(facet === "yours" ? "all" : "yours"))}
        {word(facet === "liked", t.rail.liked, () => setFacet(facet === "liked" ? "all" : "liked"))}
        <span className="flex-1" />
        {word(sort === "hot", t.rail.sortHot, () => chooseSort("hot"))}
        {word(sort === "new", t.rail.sortNew, () => chooseSort("new"))}
      </div>
      {cards}
      {children}
    </section>
  )
}

/**
 * What is picked, set as type: its name, who made it and when, what it is,
 * its tags, and what it can do. The tags narrow the shelf below it.
 */
export function LibraryDetail({
  name,
  author,
  draft,
  description,
  actions,
  like,
  aside,
}: {
  name: string
  author: string
  draft: boolean
  description?: string
  actions: React.ReactNode
  /** Its likes, and yours: a word among the actions. A draft has none. */
  like?: { count: number; liked: boolean; canLike: boolean; onToggle: () => void }
  /** A draft's Publish, in the middle of the room its byline and description
   *  would take. */
  aside?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const para = useRef<HTMLParagraphElement>(null)
  // Folded again for every new pick.
  const [shown, setShown] = useState(name)
  if (shown !== name) {
    setShown(name)
    setOpen(false)
  }
  useEffect(() => {
    const el = para.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [description, open])
  return (
    // Every line holds its height whether or not it is filled, so picking
    // another card changes the words and nothing moves. One job a line: the
    // name and its likes; who made it; what it is; what you can do with it.
    <div className="flex min-w-0 flex-col">
      <div className="flex h-6 min-w-0 items-center gap-3">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium select-text">{name}</h3>
        {like && (
          <Button
            variant="bare"
            disabled={!like.canLike}
            aria-pressed={like.liked}
            onClick={like.onToggle}
            className={cn(
              "flex shrink-0 items-center gap-1 font-mono text-xs disabled:cursor-default disabled:text-muted-foreground",
              like.liked ? "text-red-400" : "text-muted-foreground",
              like.canLike && "hover:text-red-400",
            )}
          >
            <Heart className={cn("size-3.5", like.liked && "fill-current")} />
            {like.count}
          </Button>
        )}
      </div>
      {draft && aside ? (
        // A draft is your own and unpublished: no maker, no likes, nothing
        // written about it yet. Its Publish stands in the middle of that
        // room, which keeps the byline's and the description's height: as far
        // from the name's type above as from the actions' below.
        <div className="flex h-[3.25rem] min-w-0 items-center justify-center pt-1">{aside}</div>
      ) : (
        <>
          <div className="flex h-5 min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
            {!draft && <AuthorLink name={author} at className="truncate select-text" />}
          </div>
          {/* Two lines, and the rest on a click: the one place the dock may move. */}
          <p
            ref={para}
            onClick={() => (open || clipped) && setOpen(!open)}
            className={cn(
              "mt-1 text-xs leading-4 text-muted-foreground [overflow-wrap:anywhere]",
              open ? "" : "line-clamp-2 h-8",
              (open || clipped) && "cursor-pointer hover:text-foreground",
            )}
          >
            {description}
          </p>
        </>
      )}
      <div className="mt-1.5 flex h-5 min-w-0 items-center justify-end gap-4">{actions}</div>
    </div>
  )
}

/** The shelf: two cards across, scrolling down the dock. */
export function LibraryCards<T extends BrowseItem>({
  browse,
  selectedId,
  onSelect,
  onActivate,
  meta,
  displayName,
  wrap,
  empty,
  watch,
  rows: asRows = false,
  dense = false,
  reveal = null,
}: {
  browse: Browse<T>
  selectedId: string | null
  onSelect: (item: T) => void
  /** A double-click: the kind's own act on a card (an effect goes on). */
  onActivate?: (item: T) => void
  meta: (item: T) => CardMeta
  displayName?: (item: T) => string
  /** Wraps a card in the kind's context menu. Identity by default. */
  wrap?: (item: T, node: React.ReactNode) => React.ReactNode
  empty: React.ReactNode
  /** The loads behind this shelf (lib/net keys, by prefix). While one is
   *  failing, a single quiet line under the cards says so. */
  watch?: readonly string[]
  /** Rows of words instead of pictures, for a kind whose look only shows on
   *  the scene (a shader graph): the canvas is its picture. */
  rows?: boolean
  /** A long shelf of pictures (effects): the rows closer, so more fit. */
  dense?: boolean
  /** A card to bring into view, when its pane chose it (a group's graph, the
   *  pane's effect). Picking in the shelf itself never scrolls it. */
  reveal?: string | null
}) {
  useSyncExternalStore(watchFailing, failingVersion, failingVersion)
  const offline = !!watch && isFailing(watch)
  const t = useT()
  const { rows } = browse
  const shelf = useRef<HTMLDivElement>(null)
  const room = useRef<HTMLDivElement>(null)
  // The shelf is as tall as the rows that fit WHOLE in the room it has: a row
  // cut through its name read as broken, and where the cut fell moved with the
  // window. Set on the element, so a resize does not render the library.
  const empty0 = rows.length === 0
  useEffect(() => {
    const box = room.current
    const el = shelf.current
    const grid = el?.firstElementChild as HTMLElement | null
    if (!box || !el || !grid) return
    const fit = () => {
      const card = grid.firstElementChild as HTMLElement | null
      if (!card) return
      const gap = parseFloat(getComputedStyle(grid).rowGap) || 0
      const top = parseFloat(getComputedStyle(el).paddingTop) || 0
      // Room under the last row for a picked card's outline (2px, 2px out).
      const outline = 4
      const h = card.offsetHeight
      const n = Math.max(1, Math.floor((box.clientHeight - top - outline + gap) / (h + gap)))
      const fitted = top + n * h + (n - 1) * gap + outline
      el.style.height = `${fitted}px`
      // What the rows leave unused at the column's foot: a backing ends at the
      // last row rather than there (globals.css, "The backing").
      el.closest<HTMLElement>(".dock-backing")?.style.setProperty("--shelf-spare", `${Math.max(0, box.clientHeight - fitted)}px`)
    }
    const watch = new ResizeObserver(fit)
    watch.observe(box)
    watch.observe(grid)
    return () => watch.disconnect()
  }, [empty0])
  useEffect(() => {
    if (!reveal) return
    shelf.current
      ?.querySelector(`[data-card="${CSS.escape(reveal)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [reveal])

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-center text-xs text-muted-foreground">
        {offline ? <OfflineLine watch={watch} empty /> : empty}
      </div>
    )
  }

  return (
    <div ref={room} className="flex min-h-0 flex-1 flex-col">
    <div ref={shelf} className={cn("no-scrollbar max-h-full min-h-0 shrink-0 overflow-y-auto", asRows ? "-mx-2 pt-1" : "-mx-1.5 px-3 pt-1.5")}>
      <div className={cn("grid pb-2", asRows ? "grid-cols-1 gap-0.5" : dense ? "grid-cols-2 gap-x-5 gap-y-2" : "grid-cols-2 gap-x-5 gap-y-4")}>
        {rows.map((item) => {
          const m = meta(item)
          const st = itemState(item)
          const Icon = STATE_ICON[st]
          const picked = selectedId === item.id
          const card = (
            <div
              data-card={item.id}
              role="button"
              tabIndex={0}
              aria-pressed={picked}
              onClick={() => onSelect(item)}
              onDoubleClick={onActivate && (() => onActivate(item))}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(item)
                }
              }}
              className={cn(
                "flex min-w-0 cursor-default flex-col text-left",
                asRows
                  ? cn("rounded-chip px-2 py-1.5 outline-1 -outline-offset-1 transition-[outline-color,background-color]", picked ? "outline-foreground" : "outline-transparent hover:bg-white/5")
                  : "gap-1.5",
              )}
            >
              {!asRows && (
                <div
                  className={cn(
                    "relative overflow-hidden rounded-interior bg-white/5 outline-2 outline-offset-2 transition-[outline-color]",
                    "aspect-video",
                    m.applied ? "outline-foreground" : "outline-transparent",
                  )}
                >
                  {m.preview}
                  {st !== "public" && (
                    <span className="absolute top-1 left-1 flex items-center gap-1 rounded-chip bg-black/60 px-1 py-px font-mono text-2xs text-white">
                      <Icon className="size-2.5" />
                      {t.rail.states[st]}
                    </span>
                  )}
                </div>
              )}
              {asRows ? (
                // One line: the name, and its maker at the right end.
                <div className="flex h-5 min-w-0 items-center gap-3 text-xs">
                  <span className={cn("min-w-0 flex-1", !m.nameNode && "truncate")}>{m.nameNode ?? displayName?.(item) ?? item.name}</span>
                  {st !== "public" && (
                    <span className="flex shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground">
                      <Icon className="size-2.5" />
                      {t.rail.states[st]}
                    </span>
                  )}
                  {/* A draft has no maker to show: no empty slot, so its label
                      stands at the end like a maker would. */}
                  {st !== "draft" && (
                    <span className="flex max-w-[45%] shrink-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                      <AuthorLink name={item.author} at className="min-w-0 truncate" />
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-1.5 text-xs leading-tight">
                    {/* On the scene: the outline above. Chosen, its detail
                        showing: the name underlined in the accent, as the
                        chosen group is in Materials. */}
                    <span
                      className={cn(
                        "min-w-0 pb-0.5",
                        !m.nameNode && "truncate",
                        picked && "underline decoration-blue-400 decoration-[1.5px] underline-offset-3",
                      )}
                    >
                      {m.nameNode ?? displayName?.(item) ?? item.name}
                    </span>
                  </div>
                  <div className="-mt-2 flex h-4 min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                    {st !== "draft" && <AuthorLink name={item.author} at className="min-w-0 truncate" />}
                  </div>
                </>
              )}
            </div>
          )
          return <div key={item.id}>{wrap ? wrap(item, card) : card}</div>
        })}
      </div>
      {offline && <OfflineLine watch={watch} />}
    </div>
    </div>
  )
}
