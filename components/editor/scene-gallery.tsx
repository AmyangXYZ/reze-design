"use client"

// Published scenes, in the same shell as every other library: rail on the left,
// grid in the middle, details on the right. Browsing scenes is the same act as
// browsing grades, so it should not look like a different product.
//
// Opening one IS a navigation, though — a scene is a whole document, and the
// address bar should say which one you are looking at.

import { Stamp } from "@/components/stamp"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LibraryLike } from "@/components/editor/library-rail"
import { fetchJson, retryLater, retrySettled } from "@/lib/net"
import { usePollWhileOpen } from "@/hooks/use-poll-while-open"
import { readSaved, writeSaved } from "@/lib/saved"
import { noteVerified } from "@/lib/community-store"
import {
  useLibraryBrowse,
  type BrowseFacet,
  AuthorAvatar,
  AuthorLink,
} from "@/components/editor/library-shell"
import { Cover } from "@/components/ui/cover"
import { Input } from "@/components/ui/input"
import { useLibraryStats } from "@/hooks/use-library-stats"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SignInDialog } from "@/components/editor/account-panel"
import { useReport } from "@/hooks/use-report"
import { setForkTarget } from "@/lib/fork"
import { useSession } from "@/lib/auth-client"
import { usePhone } from "@/lib/device"

import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SiteChip, VideoLink } from "@/components/video-link"

export type GalleryScene = {
  id: string
  name: string
  author: string
  description: string
  credits: string
  /** The video its maker posted, or empty. */
  video?: string
  tags: string[]
  likeCount: number
  poster: string | null
  createdAt: string
  /** Only ever your own rows carry one; everyone else's read as public. The card
   *  badges it, and the lists below decide what they may hold by it. */
  visibility?: "public" | "private"
  /** Its author asked that it be watched, not opened in the editor. */
  displayOnly?: boolean
  /** The author's account picture, for their avatar. */
  authorImage?: string | null
  /** A maker we vouch for: a check beside their name. */
  authorVerified?: boolean
}

/**
 * The mark a display-only scene carries where its details are read — the
 * gallery's panel and the scene page's card. Not on the grid's covers: it
 * matters once you are deciding what to do with a scene, not while browsing.
 *
 * NOT a tag's shape. Beside the author's tags a bordered chip read as one more
 * topic and went unseen; this is a filled pill, so it reads as a property of
 * the scene. Grey, not an accent: it is a fact, not a warning.
 */
export function DisplayOnlyTag({ className }: { className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        "inline-flex items-center truncate rounded-full bg-white/10 px-2 py-0.5 text-2xs leading-none font-medium text-foreground",
        className,
      )}
    >
      {t.share.displayOnly}
    </span>
  )
}

/**
 * How the gallery is being browsed — the same three shelves as every other
 * library, minus `builtin`, because nobody ships a built-in scene.
 *
 * It used to carry the orderings too (hot / new / top) as rail rows beside the
 * narrowings, which made one list answer two different questions. The gallery is
 * the fourth library and now reads like the other three: the rail says WHICH
 * scenes, and `all` is ordered the way the gallery has always opened.
 */
type View = "all" | "yours" | "liked"

/** A published scene as the shared grid sees it. No payload: the grid never
 *  reads one, and inventing a field so a scene could pretend to be a preset is
 *  how one shell becomes two again. */
export type GalleryRow = GalleryScene & { kind: "scene"; owner: "user"; mine: boolean }
type Page = { scenes: GalleryScene[]; nextCursor: number | null }

/** A cached list: a view, or one of the public lists the shelves are drawn
 *  from, one query per shelf: `newest` for Latest, `top` for the most liked,
 *  and a tag's or a maker's own. */
type Key = View | "newest" | "top" | `tag:${string}` | `maker:${string}`

const isFacet = (v: Key) => v === "yours" || v === "liked"

// Session-lived, in memory only, and never emptied.
//
// One rule holds everywhere below: whatever we already know paints immediately,
// and any fresh request lands underneath it. Clearing the cache on publish or
// delete broke that — the next open had nothing to paint and put a spinner over
// an empty grid — so those events patch the cached lists instead, and the quiet
// refresh that follows every open reconciles them with the server.
const pages = new Map<Key, Page>()

// Requests in flight, keyed by view. A gallery opened while the boot-time
// prefetch is still out joins that request rather than firing a second one and
// waiting behind its own spinner — the window where that happens is exactly the
// first few seconds, which is when someone is most likely to go looking.
const inflight = new Map<Key, Promise<Page>>()

// Open galleries repaint when the cache is patched from elsewhere — the same
// relay the community libraries use.
const listeners = new Set<() => void>()
const announce = () => {
  for (const l of listeners) l()
}

/** Tag counts over the whole gallery — independent of how the list in front of
 *  you is narrowed. */
let tagCounts: [string, number][] | null = null
/** Public scenes per maker, over the whole gallery, from the same request. */
let makerCounts: [string, number][] | null = null
/** The counts came from the server this session, not only from the saved
 *  copy — which is there to paint with, never a reason to skip the request. */
let countsFresh = false
let tagsInflight: Promise<[string, number][]> | null = null

/** Rail counts, for the same reason and over the same whole: a rail counting the
 *  loaded window would climb as you scrolled it. */
export type FacetCounts = Record<View, number>
let facetCounts: FacetCounts | null = null
let facetsInflight: Promise<FacetCounts> | null = null

// The public shelf's first window and the tag cloud, saved in this browser
// (lib/saved), so the gallery opens full on a cold start and on a route that
// cannot reach the server, then refreshes underneath. Only the public reads:
// your shelves are personal, and a stale "liked" would be a wrong one.
const SAVED_PAGE = "gallery.all.v1"
const SAVED_TAGS = "gallery.tags.v2"
let hydrated = false
/** Read the saved shelf and cloud once, applying each only if the network has
 *  not answered first; an open gallery repaints through `announce`. */
function hydrateSaved() {
  if (hydrated) return
  hydrated = true
  void readSaved<Page>(SAVED_PAGE).then((page) => {
    if (!page?.scenes || pages.has("all")) return
    pages.set("all", page)
    announce()
  })
  void readSaved<{ tags: [string, number][]; makers: [string, number][] }>(SAVED_TAGS).then((saved) => {
    if (!saved || tagCounts) return
    tagCounts = saved.tags
    makerCounts = saved.makers
  })
}

/**
 * How a view is ranked.
 *
 * `all` keeps the ranking the gallery has always opened on — a young scene with
 * a few likes above an old one with the same. The narrowings are yours and are
 * newest-first, where recency is what you are actually looking for.
 *
 * ONE FUNCTION, because the two callers disagreed: the first page asked for
 * `hot` and `loadMore` sent the VIEW as the sort, which on the default shelf is
 * the string "all" — not a sort at all. It fell through to the server's default
 * and happened to match, by luck rather than by intent.
 */
const sortFor = (v: Key): "hot" | "new" | "top" => (v === "top" ? "top" : v === "newest" || isFacet(v) ? "new" : "hot")

async function firstPage(v: Key): Promise<Page> {
  const params = new URLSearchParams({ kind: "scene", sort: sortFor(v) })
  // Only a narrowing needs a session; `all` stays one public query.
  if (isFacet(v)) params.set("facet", v)
  if (v.startsWith("tag:")) params.set("tag", v.slice(4))
  if (v.startsWith("maker:")) params.set("maker", v.slice(6))
  return fetchJson<Page>(`/api/library?${params}`)
}

/** Fresh window on top, anything already paged past kept below it and deduped:
 *  a row that slipped out of the top window keeps its place in the list instead
 *  of disappearing from under the reader mid-scroll. */
function merge(old: Page | undefined, fresh: Page): Page {
  if (!old) return fresh
  const seen = new Set(fresh.scenes.map((s) => s.id))
  return {
    scenes: [...fresh.scenes, ...old.scenes.filter((s) => !seen.has(s.id))],
    // Keep the deeper cursor once the reader has paged past the first window.
    nextCursor: old.scenes.length > fresh.scenes.length ? old.nextCursor : fresh.nextCursor,
  }
}

/** The first page of a view, merged into what we already had. Shared with anyone
 *  already waiting on the same view. */
function loadPage(v: Key): Promise<Page> {
  hydrateSaved()
  const held = inflight.get(v)
  if (held) return held
  const req = firstPage(v)
    .then((fresh) => {
      noteVerified(fresh.scenes)
      if (v === "all") writeSaved(SAVED_PAGE, fresh)
      const merged = merge(pages.get(v), fresh)
      pages.set(v, merged)
      inflight.delete(v)
      return merged
    })
    .catch((e: unknown) => {
      inflight.delete(v)
      throw e
    })
  inflight.set(v, req)
  return req
}

function loadTags(): Promise<[string, number][]> {
  tagsInflight ??= fetchJson<{ tags: { tag: string; n: number }[]; makers?: { author: string; n: number }[] }>(
    "/api/library?kind=scene&counts=tags",
  )
    .then((d) => {
      tagCounts = d.tags.map((x) => [x.tag, x.n] as [string, number])
      makerCounts = (d.makers ?? []).map((x) => [x.author, x.n] as [string, number])
      writeSaved(SAVED_TAGS, { tags: tagCounts, makers: makerCounts })
      countsFresh = true
      tagsInflight = null
      return tagCounts
    })
    .catch((e: unknown) => {
      tagsInflight = null
      throw e
    })
  return tagsInflight
}

/**
 * What can be painted for a view before its own request lands.
 *
 * "Yours" is a subset of every other list, and `author` is the handle
 * denormalised onto the row, so it can be sieved out of whatever is already
 * cached and shown at once — the fresh page lands underneath it, which is the
 * rule the rest of this cache follows. "Liked" gets nothing: a list row carries
 * no like state, and guessing would be worse than the spinner.
 */
function cachedFallback(v: View, username: string | null | undefined): GalleryScene[] {
  if (v !== "yours" || !username) return []
  const seen = new Set<string>()
  const out: GalleryScene[] = []
  for (const page of pages.values()) {
    for (const s of page.scenes) {
      if (s.author !== username || seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }
  return out
}

function loadFacetCounts(): Promise<FacetCounts> {
  facetsInflight ??= fetchJson<FacetCounts>("/api/library?kind=scene&counts=facets")
    .then((d) => {
      facetCounts = d
      facetsInflight = null
      return d
    })
    .catch((e: unknown) => {
      facetsInflight = null
      throw e
    })
  return facetsInflight
}

/** Warm the default view and the tag cloud while the page is idle, so opening the
 *  gallery is a render rather than a wait. */
export function prefetchGallery(signedIn = false): void {
  hydrateSaved()
  // Always asked, saved copy or not: the saved one is to paint with, not to keep.
  void loadPage("all").catch(() => {})
  void loadPage("newest").catch(() => {})
  if (!countsFresh) void loadTags().catch(() => {})
  if (!facetCounts) void loadFacetCounts().catch(() => {})
  // The two personal shelves, and the reason this takes an argument at all.
  // `GalleryContent` mounts on OPEN, so the "yours" page — the only source of
  // your private scenes, in every view including "all" — used to start fetching
  // when the dialog appeared: the grid painted public rows and yours dropped in
  // a round trip later, re-sorting the shelf under the pointer. Signed-in only,
  // because asking without a session returns an empty list every time.
  if (!signedIn) return
  for (const v of ["yours", "liked"] as const) if (!pages.has(v)) void loadPage(v).catch(() => {})
}

/** Your scene, in the lists it belongs to, without waiting for a round trip. */
export function noteScenePublished(scene: GalleryScene): void {
  for (const [v, page] of pages) {
    // "liked" is what you liked, and publishing isn't liking.
    if (v === "liked") continue
    // "all" is the public gallery. A private scene belongs only under "yours",
    // and putting it in both is how a scene nobody else can open still appears
    // in the list of what everybody can.
    if (v !== "yours" && scene.visibility === "private") continue
    // A tag's or a maker's list takes only what it is the list of.
    if (v.startsWith("tag:") && !scene.tags.includes(v.slice(4))) continue
    if (v.startsWith("maker:") && scene.author !== v.slice(6)) continue
    pages.set(v, { ...page, scenes: [scene, ...page.scenes.filter((s) => s.id !== scene.id)] })
  }
  // Its tags moved the cloud.
  void loadTags().catch(() => {})
  announce()
}

export function noteSceneRemoved(id: string): void {
  for (const [v, page] of pages) pages.set(v, { ...page, scenes: page.scenes.filter((s) => s.id !== id) })
  void loadTags().catch(() => {})
  announce()
}

/**
 * `initialFacet` is the browse slot's, the same one the three libraries take, so
 * an entrance that means "show me mine" arrives on that shelf here too — the
 * account panel's scene count is exactly that entrance. Only the two narrowings
 * exist in both vocabularies; a slot asking for `all` or `builtin` has said
 * nothing about ordering, so the gallery opens the way it always does.
 */
/** The gallery, as its own page (app/gallery). `initialFacet` is the shelf an
 *  entrance asked for — the account panel's "your scenes" arrives on Yours. */
export function GalleryPage({ initialFacet }: { initialFacet?: BrowseFacet }) {
  return <GalleryContent initialFacet={initialFacet} />
}

function GalleryContent({ initialFacet }: { initialFacet?: BrowseFacet }) {
  const t = useT()
  const router = useRouter()
  const { data: session } = useSession()
  // A phone watches; nothing on it edits, so it has no Fork.
  const phone = usePhone()
  const report = useReport()
  /** The scene a delete is being confirmed for. Held whole rather than by id:
   *  the dialog names it, and looking the name up again after the list has
   *  moved is how a confirm ends up asking about the wrong row. */
  const [confirming, setConfirming] = useState<GalleryScene | null>(null)
  // A scene is a library item like any other, so its likes come from the same
  // snapshot the three preset libraries read. A list row carries no like state of
  // its own — deriving one used to mean shipping your liked ids down with every
  // page, which is exactly what this one prefetched request already does for
  // everything at once.
  const { statFor, known, signedIn, toggleLike } = useLibraryStats()
  /** The snapshot's count when it has the row, the page's otherwise: a scene
   *  published this session is in the list before the snapshot refetches, and a
   *  heart reading 0 beside a scene with likes is worse than a beat of lag. */
  const likesOf = (s: GalleryScene) => (known(s.id) ? statFor(s.id).likeCount : s.likeCount)
  const opensOn: View = initialFacet === "yours" || initialFacet === "liked" ? initialFacet : "all"
  const [view, setView] = useState<View>(opensOn)
  // Seeded from the view this opened ON, not from the default one: an entrance
  // that means "show me mine" would otherwise paint the whole gallery first.
  const [scenes, setScenes] = useState<GalleryScene[]>(() => {
    // Mounted on open, so in the browser; a saved shelf read now repaints
    // through the relay below when it arrives.
    hydrateSaved()
    return pages.get(opensOn)?.scenes ?? cachedFallback(opensOn, session?.user.username)
  })
  const [cursor, setCursor] = useState<number | null>(() => pages.get(view)?.nextCursor ?? null)
  /** The newest public scenes, merged into `all` for the Latest shelf. */
  const [newest, setNewest] = useState<GalleryScene[]>(() => pages.get("newest")?.scenes ?? [])
  // Where Latest goes on: All closes the page newest first and pages on down
  // that list, so what arrives is older than everything above it.
  const [newestCursor, setNewestCursor] = useState<number | null>(() => pages.get("newest")?.nextCursor ?? null)
  /** The tag and maker lists asked for so far, merged into `all` the same way. */
  const [lists, setLists] = useState<Partial<Record<Key, GalleryScene[]>>>({})
  /** The cover picked, as WHERE it stands — `<shelf>|<scene id>` — since one
   *  scene can stand on a shelf and again in All, and the ring and the arrow
   *  keys go by the card, not the scene. */
  const [place, setPlace] = useState<string | null>(null)
  const [tags, setTags] = useState<[string, number][]>(() => tagCounts ?? [])
  const [makers, setMakers] = useState<[string, number][] | null>(() => makerCounts)
  const [counts, setCounts] = useState<FacetCounts | null>(() => facetCounts)
  // Only when there is genuinely nothing to show. Rows sieved out of another
  // list are worth more than a spinner over an empty grid.
  /** Your own private scenes, which no public list can return.
   *
   *  The gallery's default query is deliberately session-free — reading who you
   *  are before asking for rows costs a round trip on the one list that is
   *  identical for everyone. So "all" stays public, and YOUR private scenes are
   *  merged in from the "yours" page the client already prefetches. They are
   *  yours to see wherever you are looking, including when filtering by maker. */
  const [minePrivate, setMinePrivate] = useState<GalleryScene[]>(
    // Seeded from the warmed page rather than starting empty: the effect below
    // still runs, but resolving a cached page takes a microtask, and a shelf
    // that gains rows one tick after it paints is a shelf that visibly re-sorts.
    () => pages.get("yours")?.scenes.filter((x) => x.visibility === "private") ?? [],
  )
  /** Bumped whenever the module cache is patched, so the merge above re-derives. */
  const [cacheV, setCacheV] = useState(0)
  const [loading, setLoading] = useState(() => !pages.has(view) && scenes.length === 0)
  const [failed, setFailed] = useState(false)
  /** Bumped to ask for the view again after a failure (lib/net retryLater). */
  const [attempt, setAttempt] = useState(0)

  // Cached rows paint immediately and the refresh lands underneath them, so
  // reopening the gallery or changing how you browse is never a blank wait.
  useEffect(() => {
    let stale = false
    let cancelRetry = () => {}
    loadPage(view)
      .then((page) => {
        retrySettled(`gallery:${view}`)
        if (stale) return
        setScenes(page.scenes)
        setCursor(page.nextCursor)
        setFailed(false)
        setLoading(false)
      })
      .catch(() => {
        if (stale) return
        // Only an empty grid is a failure; stale rows are better than an apology.
        setFailed(!pages.has(view))
        setLoading(false)
        // Either way, keep asking while the gallery is open.
        cancelRetry = retryLater(`gallery:${view}`, () => setAttempt((n) => n + 1))
      })
    if (view === "all")
      loadPage("newest")
        .then((page) => {
          if (stale) return
          setNewest(page.scenes)
          setNewestCursor(page.nextCursor)
        })
        .catch(() => {})
    return () => {
      stale = true
      cancelRetry()
    }
  }, [view, attempt])
  // While open, a public shelf picks up new scenes; the fresh window merges in
  // on top (see merge), so nothing moves under the reader. Not "yours" and
  // "liked": those read the database, and only change when you do something.
  usePollWhileOpen(() => {
    if (!isFacet(view)) setAttempt((n) => n + 1)
  })

  // Repaint when something patches the cache underneath an open gallery.
  useEffect(() => {
    const relay = () => {
      const page = pages.get(view)
      if (page) setScenes(page.scenes)
      setNewest(pages.get("newest")?.scenes ?? [])
      setNewestCursor(pages.get("newest")?.nextCursor ?? null)
      setLists((cur) => Object.fromEntries(Object.keys(cur).map((k) => [k, pages.get(k as Key)?.scenes ?? []])))
      setCacheV((n) => n + 1)
    }
    listeners.add(relay)
    return () => {
      listeners.delete(relay)
    }
  }, [view])

  useEffect(() => {
    if (countsFresh) return
    let stale = false
    loadTags()
      .then((counts) => {
        if (stale) return
        setTags(counts)
        setMakers(makerCounts)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  useEffect(() => {
    if (facetCounts) return
    let stale = false
    loadFacetCounts()
      .then((c) => !stale && setCounts(c))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  // Warm both personal shelves while you are looking at the gallery, so clicking
  // either is a render rather than a wait. Signed-in only: these are the two
  // queries here that need a session, and asking without one returns an empty
  // list every time.
  //
  // Fetched rather than sieved out of `all`, which is what `cachedFallback` can
  // do for "yours": a list row carries no like state, so deriving "liked" would
  // mean shipping your liked ids down with every page — and it would still only
  // cover the scenes currently in the window. Two small queries buy the real
  // answer, and by the time either shelf is clicked it is usually already here.
  //
  // It also feeds `minePrivate` below, which is the whole reason a private scene
  // of yours can appear anywhere but "yours".
  useEffect(() => {
    if (!session?.user.username) return
    let stale = false
    for (const v of ["yours", "liked"] as const) {
      const p = pages.has(v) ? Promise.resolve(pages.get(v)!) : loadPage(v)
      void p
        .then((page) => {
          if (stale || v !== "yours") return
          setMinePrivate(page.scenes.filter((x) => x.visibility === "private"))
        })
        .catch(() => {})
    }
    return () => {
      stale = true
    }
  }, [session?.user.username, cacheV])

  // Ownership without an extra round trip: `author` is the handle, denormalised
  // on the row, so comparing it to yours is enough.
  const handle = session?.user.username
  const mine = useCallback((author: string) => !!handle && author === handle, [handle])

  /** The page, as rows the shared grid understands. A scene has no payload and
   *  the grid never asks for one. */
  const items = useMemo<GalleryRow[]>(() => {
    const merged = view === "all" ? [...scenes, ...newest, ...Object.values(lists).flatMap((l) => l ?? []), ...minePrivate] : scenes
    // Once each: two pages can both hold a scene that moved between them.
    const once = [...new Map(merged.map((s) => [s.id, s])).values()]
    return once.map((s) => ({ ...s, kind: "scene" as const, owner: "user" as const, mine: mine(s.author) }))
  }, [scenes, newest, lists, minePrivate, view, mine],
  )
  const byId = useMemo(() => new Map(items.map((s) => [s.id, s])), [items])
  const numbers = useCallback(
    (id: string) => {
      const row = byId.get(id)
      return {
        likes: known(id) ? statFor(id).likeCount : (row?.likeCount ?? 0),
        uses: 0,
        liked: statFor(id).liked,
        trend: statFor(id).trend,
      }
    },
    [byId, known, statFor],
  )

  // Switching facet paints whatever is already held and lets the fetch land
  // underneath — in the handler rather than an effect, so nothing sets state
  // during a render pass.
  const onFacetChange = useCallback(
    (next: BrowseFacet) => {
      const v = next as View
      const cached = pages.get(v)
      const seed = cached?.scenes ?? cachedFallback(v, session?.user.username)
      setScenes(seed)
      setCursor(cached?.nextCursor ?? null)
      setLoading(!cached && seed.length === 0)
      setFailed(false)
      setView(v)
    },
    [session?.user.username],
  )

  const browse = useLibraryBrowse<GalleryRow>(items, numbers, {
    initialFacet: opensOn,
    // Counts and tags span the whole gallery; this client holds one page of it.
    counts: counts ?? undefined,
    tagCounts: tags,
    makerCounts: makers ?? undefined,
    onFacetChange,
  })

  // The next page of what the band ends on: All pages on down Latest; a
  // narrowed view, down its own list.
  const moreCursor = view === "all" ? newestCursor : cursor
  const loadMore = () => {
    if (view === "all") {
      if (!newestCursor) return
      setLoading(true)
      const params = new URLSearchParams({ kind: "scene", sort: "new", before: String(newestCursor) })
      fetchJson<Page>(`/api/library?${params}`)
        .then((page) => {
          noteVerified(page.scenes)
          const held = pages.get("newest")
          const next = { scenes: [...(held?.scenes ?? []), ...page.scenes], nextCursor: page.nextCursor }
          pages.set("newest", next)
          setNewest(next.scenes)
          setNewestCursor(page.nextCursor)
          setLoading(false)
        })
        .catch(() => {
          setFailed(true)
          setLoading(false)
        })
      return
    }
    if (!cursor) return
    setLoading(true)
    const params = new URLSearchParams({ kind: "scene", sort: sortFor(view), before: String(cursor) })
    if (isFacet(view)) params.set("facet", view)
    fetchJson<Page>(`/api/library?${params}`)
      .then((page) => {
        noteVerified(page.scenes)
        // Into the cache as well as the view: pages read once shouldn't be re-read
        // the next time the gallery opens.
        const held = pages.get(view)
        const next = { scenes: [...(held?.scenes ?? []), ...page.scenes], nextCursor: page.nextCursor }
        pages.set(view, next)
        setScenes(next.scenes)
        setCursor(page.nextCursor)
        setLoading(false)
      })
      .catch(() => {
        setFailed(true)
        setLoading(false)
      })
  }

  const rows = browse.rows
  // No fallback to the first row: nothing is selected until something is clicked.
  const selectedId = place && place.slice(place.lastIndexOf("|") + 1)
  const selected = rows.find((s) => s.id === selectedId) ?? null

  const sceneHref = (s: GalleryScene) => `/${s.author}/${s.id}`

  /** The same handoff the viewer makes, marked as an edit: the editor replaces
   *  its working scene with this one and publishing updates it in place. */
  const editScene = (s: GalleryScene) => {
    setForkTarget(s.id, undefined, true)
    router.push("/")
    // Already on the editor route, so the push is a no-op and nothing would
    // re-read the handoff. Reloading is what makes it take.
    router.refresh()
    if (typeof window !== "undefined" && window.location.pathname === "/") window.location.reload()
  }

  const openScene = (s: GalleryScene) => {
    // Client-side, in this tab. A second tab would mean a second live WebGPU
    // device and a second copy of the models in VRAM — and since the viewer's
    // "open in editor" navigates as well, browsing that way stacks up editors.
    // The route is prefetched on select, so this is usually a paint.
    router.push(sceneHref(s))
  }


  const remove = (s: GalleryScene) => setConfirming(s)

  const confirmRemove = () => {
    const s = confirming
    setConfirming(null)
    if (!s) return
    void report(fetch(`/api/library/${s.id}`, { method: "DELETE" }), t.library.deleted).then((ok) => {
      if (!ok) return
      setScenes((prev) => prev.filter((x) => x.id !== s.id))
      noteSceneRemoved(s.id)
    })
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  // On the billboard: the scene chosen, or the one trending first.
  const focus = selected ?? rows[0] ?? null
  // The billboard's picture crossfades: the one going stays under the one
  // arriving until it has faded up, so the change never passes through black.
  // Kept in state and moved on during render, when the focus changes.
  const [backdrop, setBackdrop] = useState<{ cur: GalleryRow | null; prev: GalleryRow | null }>({ cur: null, prev: null })
  if ((focus?.id ?? null) !== (backdrop.cur?.id ?? null)) setBackdrop({ cur: focus, prev: backdrop.cur })
  /** Pick a cover: on the billboard, or in a grid's detail strip. Nothing scrolls. */
  const feature = useCallback(
    (s: GalleryRow, at: string) => {
      setPlace(`${at}|${s.id}`)
      router.prefetch(`/${s.author}/${s.id}`)
    },
    [router],
  )
  /** Scrolled down into All: the band takes the page and the billboard steps
   *  aside, a plain grid of covers. */
  const [inAll, setInAll] = useState(false)
  // The wheel over the billboard moves the band below it, one shelf a
  // gesture, as the band snaps. A gesture ends when the wheel rests 150ms; a
  // trackpad's momentum only ever decays, so a delta rising sharply inside one
  // is a new swipe or notch, and steps again once the last shelf has arrived.
  const wheel = useRef({ armed: true, at: 0, stepped: 0, last: 0 })
  const onBillboardWheel = (e: React.WheelEvent) => {
    const band = scrollRef.current
    if (!band || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
    const w = wheel.current
    const now = performance.now()
    const mag = Math.abs(e.deltaY)
    if (now - w.at > 150 || (now - w.stepped > 250 && mag >= 20 && mag > w.last * 1.5)) w.armed = true
    w.at = now
    w.last = mag
    if (!w.armed || mag < 4) return
    band.scrollBy({ top: Math.sign(e.deltaY) * band.clientHeight, behavior: "smooth" })
    w.armed = false
    w.stepped = now
  }
  const onPageScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const all = el.querySelector<HTMLElement>('[data-shelf="all"]')
    // All has arrived when its title reaches the band's top.
    setInAll(!!all && el.scrollTop >= all.offsetTop - 2)
    if (!loading && moreCursor && el.scrollTop + el.clientHeight > el.scrollHeight - 600) loadMore()
  }

  // Forking is where someone's files become yours to export, so it asks for an
  // account and says whose files they are, as the scene page does.
  const [forkAsk, setForkAsk] = useState<GalleryScene | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const forkAfterSignIn = useRef<GalleryScene | null>(null)
  const requestFork = (s: GalleryScene) => {
    if (session) return setForkAsk(s)
    forkAfterSignIn.current = s
    setSignInOpen(true)
  }

  /** The same handoff as the viewer's "open in editor": a fork of this scene. */
  const forkScene = (s: GalleryScene) => {
    setForkTarget(s.id)
    router.push("/")
    router.refresh()
    if (typeof window !== "undefined" && window.location.pathname === "/") window.location.reload()
  }
  // Signed in from the fork's own dialog, which already said whose files they
  // are: carry on to the editor.
  useEffect(() => {
    const s = forkAfterSignIn.current
    if (!session || !s) return
    forkAfterSignIn.current = null
    forkScene(s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // THE ROWS, from what is loaded: the ranked list, the newest, the most liked,
  // then a row for each of the most-used tags and the most prolific makers.
  // Narrowed (a shelf of your own, a tag, a search) the page is one wrapping
  // grid of exactly that instead.
  const narrowed = browse.facet !== "all" || browse.tag !== null || browse.maker !== null || browse.query.trim() !== ""
  // A different view is a different list: it starts at its top, not at the
  // shelf the last one was scrolled to.
  const viewKey = `${browse.facet}|${browse.tag ?? ""}|${browse.maker ?? ""}|${browse.query.trim()}`
  // A grid of covers (All, or a narrowed view) has the whole page; the shelves
  // share it with the billboard.
  const grid = narrowed || inAll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [viewKey])
  // The three rankings of the whole catalogue (Latest, Trending, Most liked)
  // never repeat a scene: a small catalogue ranked three ways is three copies
  // of the same row. A tag's or a maker's shelf is its own list, whole, as a
  // streaming service repeats a title under each of its categories. Each takes
  // enough to fill a wide screen's row. The shelves are laid out once, so
  // scrolling down never reshuffles the rows above; All closes the page with
  // every scene, paging on as the band scrolls.
  type Laid = { key: string; title: string; href?: string; ids: string[] }[]
  const layShelves = (): Laid => {
    const used = new Set<string>()
    const out: Laid = []
    const CAP = 18
    const shelf = (key: string, title: string, from: GalleryRow[], ranked: boolean) => {
      const fresh = (ranked ? from.filter((r) => !used.has(r.id)) : from).slice(0, CAP)
      if (fresh.length < 3) return
      if (ranked) for (const r of fresh) used.add(r.id)
      // A maker's shelf is titled with their handle, and leads to their page.
      out.push({ key, title, href: key.startsWith("maker:") ? `/${key.slice(6)}` : undefined, ids: fresh.map((r) => r.id) })
    }
    // Latest takes its pick first, so it runs day by day with nothing skipped;
    // Trending ranks what is left, and still stands first on the page.
    // Each shelf reads its own query, in that query's order.
    const list = (k: Key) => (k === "newest" ? newest : (lists[k] ?? [])).flatMap((s) => byId.get(s.id) ?? [])
    shelf("new", t.rail.sortNew, list("newest"), true)
    shelf("hot", t.rail.sortHot, rows, true)
    out.sort((a, b) => Number(b.key === "hot") - Number(a.key === "hot"))
    shelf("likes", t.rail.likes, list("top"), true)
    for (const [tag] of browse.tags.slice(0, 6)) shelf(`tag:${tag}`, `#${tag}`, list(`tag:${tag}`), false)
    for (const [maker] of browse.makers.slice(0, 4)) shelf(`maker:${maker}`, `@${maker}`, list(`maker:${maker}`), false)
    return out
  }
  // The lists the page draws from beyond the ranked window: a shelf for each of
  // the top tags and makers, or the one tag or maker being browsed.
  const wanted: Key[] =
    view !== "all"
      ? []
      : browse.tag
        ? [`tag:${browse.tag}`]
        : browse.maker
          ? [`maker:${browse.maker}`]
          : narrowed
            ? []
            : ["top", ...browse.tags.slice(0, 6).map(([x]) => `tag:${x}` as const), ...browse.makers.slice(0, 4).map(([x]) => `maker:${x}` as const)]
  const wantedKey = wanted.join("|")
  useEffect(() => {
    if (!wantedKey) return
    let stale = false
    for (const k of wantedKey.split("|") as Key[]) {
      loadPage(k)
        .then((page) => !stale && setLists((cur) => ({ ...cur, [k]: page.scenes })))
        .catch(() => {})
    }
    return () => {
      stale = true
    }
  }, [wantedKey, attempt])
  const [laid, setLaid] = useState<{ lang: string; latest: string; shelves: Laid } | null>(null)
  // The extra lists land on their own; when they bring scenes, the shelves are
  // laid again.
  const latest = [newest.slice(0, 8).map((s) => s.id).join(), ...Object.entries(lists).map(([k, v]) => `${k}:${v?.length}`)].join("|")
  // Laid afresh when there is nothing laid yet, the language changed, or what
  // is loaded no longer holds what was laid (another view, a refresh).
  if (!narrowed && items.length > 0 && (!laid || laid.lang !== t.rail.all || laid.latest !== latest || laid.shelves.some((sh) => sh.ids.some((id) => !byId.has(id))))) {
    setLaid({ lang: t.rail.all, latest, shelves: layShelves() })
  }
  const shelves = useMemo(() => {
    if (narrowed || !laid) return []
    const out: { key: string; title: string; href?: string; rows: GalleryRow[] }[] = laid.shelves.map((sh) => ({
      ...sh,
      rows: sh.ids.flatMap((id) => byId.get(id) ?? []),
    }))
    // All, newest first: every scene the page holds, by the day it was published.
    out.push({ key: "all", title: t.rail.all, rows: [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)) })
    return out
  }, [narrowed, laid, rows, byId, t])
  // Every card's place in reading order, and the one ringed: the pick, or on
  // the shelves before any pick, the billboard's scene where it first stands.
  const places = narrowed ? rows.map((r) => `grid|${r.id}`) : shelves.flatMap((sh) => sh.rows.map((r) => `${sh.key}|${r.id}`))
  // A grid always has a pick, its first cover until another is chosen, so its
  // panel is never empty and never arrives to reflow the grid.
  const current =
    place && places.includes(place)
      ? place
      : grid
        ? (places.find((p) => narrowed || p.startsWith("all|")) ?? null)
        : (places.find((p) => p.endsWith(`|${focus?.id}`)) ?? null)
  /** A grid's pick, which its panel describes (the grid has no billboard). */
  const picked = grid && current ? (rows.find((r) => current.endsWith(`|${r.id}`)) ?? null) : null
  // ← → step through the covers in reading order — along a shelf, on to the
  // next — and ↑ ↓ move a row, as a TV does, onto the cover nearest the same
  // spot across. Each puts its cover on the billboard and brings it into view.
  // Enter opens what is on the billboard. Not while typing in the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !focus) return
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [role=listbox], [role=menu]")) return
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault()
        const at = places.indexOf(current ?? "")
        const next = places[Math.min(places.length - 1, Math.max(0, at + (e.key === "ArrowRight" ? 1 : -1)))]
        if (!next) return
        setPlace(next)
        scrollRef.current
          ?.querySelector(`[data-place="${CSS.escape(next)}"]`)
          ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" })
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const cards = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-place]") ?? [])].map((el) => ({ el, box: el.getBoundingClientRect() }))
        const here = cards.find((c) => c.el.dataset.place === current) ?? (current ? undefined : cards[0])
        if (!here) return
        const down = e.key === "ArrowDown"
        // The row next in that direction: the nearest top past this one's.
        const beyond = cards.filter((c) => (down ? c.box.top > here.box.bottom - 4 : c.box.bottom < here.box.top + 4))
        if (!beyond.length) return
        const edge = down ? Math.min(...beyond.map((c) => c.box.top)) : Math.max(...beyond.map((c) => c.box.top))
        const row = beyond.filter((c) => Math.abs(c.box.top - edge) < 8)
        const x = here.box.left + here.box.width / 2
        const next = row.reduce((a, b) => (Math.abs(b.box.left + b.box.width / 2 - x) < Math.abs(a.box.left + a.box.width / 2 - x) ? b : a))
        setPlace(next.el.dataset.place!)
        next.el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" })
      } else if (e.key === "Enter") {
        if ((e.target as HTMLElement | null)?.closest?.("button, a")) return
        e.preventDefault()
        openScene(focus)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  const narrowedTitle = browse.query.trim()
    ? `“${browse.query.trim()}”`
    : browse.tag
      ? `#${browse.tag}`
      : browse.maker
        ? browse.maker
        : browse.facet === "yours"
          ? t.rail.yours
          : t.rail.liked

  const facetWord = (v: View, label: string) => (
    <Button
      key={v}
      variant="bare"
      onClick={() => {
        browse.clear()
        browse.setFacet(v)
      }}
      className={cn(
        "relative py-1 text-xs after:absolute after:inset-x-2 after:bottom-0 after:h-[1.5px]",
        browse.facet === v && !browse.tag && !browse.maker ? "text-foreground after:bg-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Button>
  )

  /** One cover, as every row and the grid show it. Your own scenes keep their
   *  menu: open, edit, delete. */
  const card = (s: GalleryRow, at: string, wide?: boolean) => {
    const here = `${at}|${s.id}`
    const node = (
      // The frame stands forward on hover or on the billboard; inside it the
      // picture and name are the button, and the maker under them a link to
      // their page, so the two never nest.
      <div
        key={s.id}
        data-place={here}
        className={cn(
          "group/card flex shrink-0 flex-col gap-1.5 transition-[scale] hover:z-10 hover:scale-[1.04]",
          wide ? "w-full" : "w-44",
          // The one on the billboard stands forward as a hovered one does, so
          // stepping with the arrows reads the same as pointing.
          current === here && "z-10 scale-[1.04]",
        )}
      >
        <Button
          variant="bare"
          // A phone has no panel beside a grid, so a tap there opens.
          onClick={() => (grid && phone ? openScene(s) : feature(s, at))}
          onDoubleClick={() => openScene(s)}
          className="flex flex-col gap-1.5 text-left"
        >
          <span
            className={cn(
              "block aspect-video w-full overflow-hidden rounded-interior bg-white/5",
              // Held off the picture by a gap of the page's black, so it reads on
              // a white cover as on a dark one.
              current === here && "ring-2 ring-foreground ring-offset-2 ring-offset-black",
            )}
          >
            {s.poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.poster} alt="" loading="lazy" className="size-full object-cover" />
            )}
          </span>
          <span className="truncate text-xs text-foreground">{s.name}</span>
        </Button>
        <span className="-mt-1 flex min-w-0 items-center gap-1 font-mono text-2xs text-muted-foreground">
          <AuthorLink name={s.author} at className="truncate" />
        </span>
      </div>
    )
    if (!s.mine) return node
    return (
      <ContextMenu key={s.id}>
        <ContextMenuTrigger asChild>{node}</ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => openScene(s)}>{t.gallery.open}</ContextMenuItem>
          {/* YOUR OWN SCENE, BACK IN THE EDITOR TO CORRECT IT: publishing from
              there updates this row, so the link, likes and pin stay with it. */}
          <ContextMenuItem onSelect={() => editScene(s)}>{t.gallery.editPublished}</ContextMenuItem>
          <ContextMenuItem variant="danger" onSelect={() => remove(s)}>
            {t.library.deletePublished}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  // THE GALLERY, as a streaming service's home: the scene in focus on a
  // billboard filling the top of the screen and fading into the page, and
  // shelves of covers under it, each scrolling sideways. White type on black
  // (dark paper), the cover's controls.
  return (
    <main data-paper="dark" className="fixed inset-0 flex h-dvh w-screen flex-col overflow-hidden bg-black text-foreground select-none">
      <Cover>
        {/* The nav, fixed over the page: clear over the billboard, solid once
            the page scrolls under it. */}
        <div
          className={cn(
            // The editor's top row to the pixel (top-5, h-8, left-7), so the
            // wordmark stands exactly where it stood in the editor.
            "absolute inset-x-0 top-0 z-20 flex h-[4.25rem] items-start gap-7 px-7 pt-5 transition-colors compact:gap-4 compact:px-4 [&>*]:h-8 [&>*]:items-center",
            "bg-linear-to-b from-black/70 to-transparent",
          )}
        >
          {/* The house's name where a service sets its own — and, as a service's
              logo does, the way home: back to the editor. The gallery's name
              beside it. */}
          <div className="flex shrink-0 items-center gap-7">
            <Link
              href="/"
              className="font-display text-masthead tracking-[0.45em] text-foreground uppercase [-webkit-text-stroke:0.3px_currentColor] compact:tracking-[0.3em]"
            >
              Reze Design
            </Link>
            {/* The gallery's own name is its home: every shelf, no narrowing,
                back at the top — what All was, so All is not said twice. */}
            {/* On a phone the wordmark alone heads the row; the shelves are
                home enough. */}
            <h1 className="compact:hidden">
              <Button
                variant="bare"
                onClick={() => {
                  browse.clear()
                  browse.setQuery("")
                  scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
                }}
                className={cn(
                  "relative py-1 font-mono text-2xs font-medium tracking-wide uppercase after:absolute after:inset-x-2 after:bottom-0 after:h-[1.5px]",
                  narrowed ? "text-muted-foreground hover:text-foreground" : "text-foreground after:bg-blue-400",
                )}
              >
                {t.gallery.title}
              </Button>
            </h1>
          </div>
          {session && facetWord("yours", t.rail.yours)}
          {session && facetWord("liked", t.rail.liked)}
          <SiteChip site="bilibili" href="/bilibili" className="h-6 px-2 text-xs compact:hidden">
            {t.bilibili.title}
          </SiteChip>
          <span className="flex-1" />
          <label className="relative flex h-8 w-52 compact:w-32 items-center gap-2 px-3 text-muted-foreground after:absolute after:inset-0 after:rounded-interior after:border after:border-line-strong after:transition-colors focus-within:after:border-foreground compact:hidden">
            <Search className="size-3.5 shrink-0" strokeWidth={1.5} />
            <Input
              variant="bare"
              value={browse.query}
              onChange={(e) => browse.setQuery(e.target.value)}
              placeholder={t.rail.search}
              className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="relative min-h-0 flex-1">
          {/* The billboard, pinned behind the shelves: picking a cover swaps it
              and the shelf stays where it was. */}
          <section
            onWheel={onBillboardWheel}
            className={cn("absolute inset-0 overflow-hidden transition-opacity", grid && "pointer-events-none opacity-0")}
          >
            {backdrop.prev?.poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`backdrop:${backdrop.prev.id}`}
                src={backdrop.prev.poster}
                alt=""
                className="stage-backdrop-held absolute inset-0 size-full object-cover"
              />
            )}
            {backdrop.cur?.poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`backdrop:${backdrop.cur.id}`} src={backdrop.cur.poster} alt="" className="stage-backdrop absolute inset-0 size-full object-cover" />
            )}
            {/* A lens's falloff at the side the type stands on and at the foot
                under the shelf. */}
            <div aria-hidden className="absolute inset-0 bg-linear-to-r from-black/75 via-black/30 to-transparent" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black via-black/45 to-transparent" />
            {focus ? (
              <div
                key={`spread:${focus.id}`}
                // White type with the cover's soft dark edge on every
                // character, so a bright picture cannot take it.
                className="cover-enter absolute top-[22%] left-16 flex [text-shadow:var(--white-ink-shadow)] [&_button]:[text-shadow:inherit] [&_svg]:[filter:var(--white-ink-line-shadow)] w-[min(48rem,55vw)] flex-col compact:top-[16%] compact:left-5 compact:w-[calc(100%-2.5rem)]"
              >
                <h2 className="font-display text-billboard text-foreground italic select-text compact:text-display">{focus.name}</h2>
                <div className="mt-4 flex min-w-0 items-center gap-2 font-mono text-xs tracking-wide text-muted-foreground uppercase compact:mt-3 compact:text-2xs">
                  <AuthorAvatar name={focus.author} image={focus.authorImage} className="size-5 compact:size-4" />
                  <AuthorLink name={focus.author} at className="truncate text-foreground normal-case select-text" />
                  <span>·</span>
                  <Stamp iso={focus.createdAt} show="words" />
                </div>
                {focus.description && (
                  <p className="mt-3 line-clamp-3 max-w-[32rem] text-xs leading-relaxed text-foreground select-text">{focus.description}</p>
                )}
                {(focus.tags.length > 0 || focus.displayOnly) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {focus.displayOnly && <DisplayOnlyTag />}
                    {/* Once each: a scene's tags can repeat one. */}
                    {[...new Set(focus.tags)].map((tag) => (
                      <Button
                        key={tag}
                        variant="bare"
                        onClick={() => {
                          browse.clear()
                          browse.setTag(tag)
                        }}
                        className="rounded-chip border border-line-strong px-1.5 py-0.5 text-2xs text-foreground"
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <Button asChild size="sm" className="h-7 rounded-chip bg-foreground px-4 text-xs font-medium text-background [text-shadow:none] hover:bg-foreground/85">
                    {/* A real link: cmd-click still gets a new tab. */}
                    <Link href={sceneHref(focus)}>{t.gallery.open}</Link>
                  </Button>
                  {!focus.displayOnly && !phone && (
                    <Button
                      variant="bare"
                      onClick={() => requestFork(focus)}
                      className="h-7 rounded-chip bg-white/20 px-3.5 text-xs font-medium text-foreground hover:bg-white/30"
                    >
                      {t.share.fork}
                    </Button>
                  )}
                  <LibraryLike
                    large
                    likeCount={likesOf(focus)}
                    liked={statFor(focus.id).liked}
                    canLike={signedIn}
                    onToggle={() => void toggleLike(focus.id)}
                  />
                  {focus.mine && (
                    <>
                      <Button variant="bare" onClick={() => editScene(focus)} className="h-7 text-xs text-muted-foreground hover:text-foreground">
                        {t.gallery.editPublished}
                      </Button>
                      <Button variant="bare" onClick={() => remove(focus)} className="h-7 text-xs text-muted-foreground hover:text-red-400">
                        {t.library.deletePublished}
                      </Button>
                    </>
                  )}
                </div>
                <VideoLink url={focus.video} className="mt-3 h-7 w-fit px-2.5 text-xs [&_svg]:size-3.5" />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                {failed ? t.gallery.failed : loading ? t.gallery.loading : t.gallery.empty}
              </div>
            )}
          </section>

          {/* The shelves, one at a time in a band along the bottom over the
              billboard's foot (two on a phone held upright, which has the
              height). Each shelf is exactly one slot of the band and it snaps
              shelf by shelf, so a stop never shows a piece of its neighbour. */}
          <div
            ref={scrollRef}
            onScroll={onPageScroll}
            className={cn(
              "no-scrollbar absolute inset-x-0 bottom-0 z-10 flex snap-y snap-mandatory flex-col overflow-y-auto transition-[height] *:snap-start",
              grid ? "right-[22rem] h-[calc(100%-4.25rem)] compact:right-0" : "h-[12.5rem] compact:portrait:h-[25rem]",
            )}
          >
            {narrowed ? (
              <section className="px-7 pt-3 compact:px-4">
                <h3 className="mb-1 text-sm font-medium text-foreground">{narrowedTitle}</h3>
                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{loading ? t.gallery.loading : t.rail.noMatches}</p>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-2.5 gap-y-2 py-1.5 *:snap-start">{rows.map((s) => card(s, "grid", true))}</div>
                )}
              </section>
            ) : (
              shelves.map((shelf) =>
                // All is the whole gallery, a grid growing down the band row
                // by row, each row snapping like a shelf.
                shelf.key === "all" ? (
                  <section key="all" data-shelf="all" className="px-7 pt-3 compact:px-4">
                    <h3 className="mb-1 text-sm font-medium text-foreground">{shelf.title}</h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-2.5 gap-y-2 py-1.5 *:snap-start">
                      {shelf.rows.map((s) => card(s, "all", true))}
                    </div>
                  </section>
                ) : (
                  <Shelf key={shelf.key} title={shelf.title} href={shelf.href}>
                    {shelf.rows.map((s) => card(s, shelf.key))}
                  </Shelf>
                ),
              )
            )}
            {loading && rows.length > 0 && (
              <div className="flex justify-center text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
          </div>
          {/* A grid's pick, in a slim panel beside it: the library's own
              arrangement, grid and inspector. What the billboard says on the
              shelves, with the cover whole. */}
          {picked && (
            <aside className="absolute top-[4.25rem] right-0 bottom-0 z-10 flex w-[22rem] flex-col overflow-y-auto border-l border-line px-6 pt-3 pb-6 compact:hidden">
              <span className="block aspect-video w-full shrink-0 overflow-hidden rounded-interior bg-white/5">
                {picked.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={picked.poster} alt="" className="size-full object-cover" />
                )}
              </span>
              <h2 className="mt-4 text-base font-medium text-foreground select-text">{picked.name}</h2>
              <div className="mt-2 flex min-w-0 items-center gap-2 font-mono text-2xs tracking-wide text-muted-foreground uppercase">
                <AuthorAvatar name={picked.author} image={picked.authorImage} className="size-4" />
                <AuthorLink name={picked.author} at className="truncate text-foreground normal-case select-text" />
                <span>·</span>
                <Stamp iso={picked.createdAt} show="words" />
              </div>
              {picked.description && <p className="mt-3 text-xs leading-relaxed text-foreground select-text">{picked.description}</p>}
              {(picked.tags.length > 0 || picked.displayOnly) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {picked.displayOnly && <DisplayOnlyTag />}
                  {[...new Set(picked.tags)].map((tag) => (
                    <Button
                      key={tag}
                      variant="bare"
                      onClick={() => {
                        browse.clear()
                        browse.setTag(tag)
                      }}
                      className="rounded-chip border border-line-strong px-1.5 py-0.5 text-2xs text-foreground"
                    >
                      {tag}
                    </Button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <Button asChild size="sm" className="h-7 rounded-chip bg-foreground px-4 text-xs font-medium text-background [text-shadow:none] hover:bg-foreground/85">
                  <Link href={sceneHref(picked)}>{t.gallery.open}</Link>
                </Button>
                {!picked.displayOnly && (
                  <Button
                    variant="bare"
                    onClick={() => requestFork(picked)}
                    className="h-7 rounded-chip bg-white/20 px-3.5 text-xs font-medium text-foreground hover:bg-white/30"
                  >
                    {t.share.fork}
                  </Button>
                )}
                <LibraryLike
                  large
                  likeCount={likesOf(picked)}
                  liked={statFor(picked.id).liked}
                  canLike={signedIn}
                  onToggle={() => void toggleLike(picked.id)}
                />
              </div>
              <VideoLink url={picked.video} className="mt-3 h-7 w-fit px-2.5 text-xs [&_svg]:size-3.5" />
            </aside>
          )}
        </div>
      </Cover>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={t.gallery.deleteTitle}
        // Named, not "this scene": the page has moved on by the time it asks.
        body={confirming ? `${confirming.name} — ${t.gallery.deleteConfirm}` : undefined}
        confirmLabel={t.library.deleteConfirmLabel}
        cancelLabel={t.library.cancel}
        onConfirm={confirmRemove}
      />
      <SignInDialog
        open={signInOpen && !session}
        onOpenChange={(o) => {
          setSignInOpen(o)
          if (!o) forkAfterSignIn.current = null
        }}
        title={t.share.forkSignIn}
        blurb={t.share.forkNotice}
      />
      <ConfirmDialog
        open={forkAsk !== null}
        onOpenChange={(o) => !o && setForkAsk(null)}
        title={t.share.fork}
        body={t.share.forkNotice}
        confirmLabel={t.share.fork}
        cancelLabel={t.library.cancel}
        tone="accent"
        onConfirm={() => forkAsk && forkScene(forkAsk)}
      />
    </main>
  )
}

/** A shelf of covers that scrolls sideways, paged by two small chevrons at the
 *  end of its title line — shown only when the shelf runs past the screen. */
function Shelf({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ back: false, on: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const next = { back: el.scrollLeft > 1, on: el.scrollLeft < el.scrollWidth - el.clientWidth - 1 }
      setMore((cur) => (cur.back === next.back && cur.on === next.on ? cur : next))
    }
    read()
    el.addEventListener("scroll", read, { passive: true })
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", read)
      ro.disconnect()
    }
  }, [])
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" })
  }
  return (
    // One slot of the shelf band, whatever the shelf holds.
    <section className="relative h-[12.5rem] shrink-0 pt-3">
      <div className="mb-1 flex items-center justify-between px-7 compact:px-4">
        <h3 className="text-sm font-medium text-foreground">
          {href ? (
            <Link href={href} className="underline-offset-4 hover:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {(more.back || more.on) && (
          <span className="flex items-center gap-2 compact:hidden">
            {([-1, 1] as const).map((dir) => (
              <Button
                key={dir}
                variant="bare"
                aria-hidden
                tabIndex={-1}
                disabled={dir < 0 ? !more.back : !more.on}
                onClick={() => page(dir)}
                className="flex size-5 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {dir < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
              </Button>
            ))}
          </span>
        )}
      </div>
      <div ref={ref} className="no-scrollbar flex gap-2.5 overflow-x-auto scroll-px-7 px-7 py-2.5 compact:px-4">
        {children}
      </div>
    </section>
  )
}
