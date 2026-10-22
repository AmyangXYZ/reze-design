"use client"

// Published scenes, as a streaming service sets its home: a spotlight of what
// is trending, then rows of covers that scroll sideways; a pause on a cover
// grows it into a preview in place (open, fork, like, who and what), and a
// click opens the scene. A section, a row, a tag or a maker seen whole is a
// grid of the same covers.
//
// Opening one IS a navigation — a scene is a whole document, and the address
// bar should say which one you are looking at.

import { Stamp } from "@/components/stamp"
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import { WORDMARK } from "@/components/wordmark"
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

  // The next page of a grid: Latest down the newest list; Trending and your
  // shelves down the view's own query.
  const loadMore = (which: "view" | "newest") => {
    if (which === "newest") {
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

  /** The page, which scrolls as a whole: the spotlight, then the rows, or a grid. */
  const scrollRef = useRef<HTMLDivElement>(null)
  /** What the preview is laid out against: the page's content, so it travels
   *  with the page. */
  const contentRef = useRef<HTMLDivElement>(null)

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


  // WHAT THE PAGE SHOWS. Home: the spotlight and the rows. Otherwise a grid of
  // one list: a ranking seen whole (Latest, Trending), or a
  // narrowing (yours, liked, a tag, a maker, a search).
  const [rank, setRank] = useState<"hot" | "new" | null>(null)
  /** On a phone the search folds to its glass; typing in it, or a query held,
   *  keeps it open across the sections' line. */
  const [searching, setSearching] = useState(false)
  const searchOpen = searching || browse.query.trim() !== ""
  const narrowed = browse.facet !== "all" || browse.tag !== null || browse.maker !== null || browse.query.trim() !== ""
  const home = !narrowed && rank === null
  // A different list starts at its top.
  const viewKey = `${browse.facet}|${browse.tag ?? ""}|${browse.maker ?? ""}|${browse.query.trim()}|${rank ?? ""}`
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [viewKey])
  // The two rankings of the whole catalogue (Latest, Trending) never repeat a
  // scene: a small catalogue ranked twice is two copies of the same row. A tag's or a maker's shelf is its own list, whole, as a
  // streaming service repeats a title under each of its categories. Each takes
  // enough to fill a wide screen's row. The shelves are laid out once, so
  // scrolling down never reshuffles the rows above.
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
    for (const [tag] of browse.tags.slice(0, TAG_ROWS)) shelf(`tag:${tag}`, `#${tag}`, list(`tag:${tag}`), false)
    for (const [maker] of browse.makers.slice(0, MAKER_ROWS)) shelf(`maker:${maker}`, `@${maker}`, list(`maker:${maker}`), false)
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
            : [...browse.tags.slice(0, TAG_ROWS).map(([x]) => `tag:${x}` as const), ...browse.makers.slice(0, MAKER_ROWS).map(([x]) => `maker:${x}` as const)]
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
  if (home && items.length > 0 && (!laid || laid.lang !== t.rail.all || laid.latest !== latest || laid.shelves.some((sh) => sh.ids.some((id) => !byId.has(id))))) {
    setLaid({ lang: t.rail.all, latest, shelves: layShelves() })
  }

  const shelves = useMemo(() => {
    if (!home || !laid) return []
    return laid.shelves.map((sh) => ({ ...sh, rows: sh.ids.flatMap((id) => byId.get(id) ?? []) }))
  }, [home, laid, byId])
  const byDate = (a: GalleryRow, b: GalleryRow) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
  const gridRows = narrowed
    ? rows
    : rank === "new"
      ? newest.flatMap((s) => byId.get(s.id) ?? []).sort(byDate)
      : rows
  const gridTitle = browse.query.trim()
    ? `“${browse.query.trim()}”`
    : browse.tag
      ? `#${browse.tag}`
      : browse.maker
        ? `@${browse.maker}`
        : browse.facet === "yours"
          ? t.rail.yours
          : browse.facet === "liked"
            ? t.rail.liked
            : rank === "new"
              ? t.rail.sortNew
              : t.rail.sortHot
  // What the grid pages on as it scrolls: Trending and your shelves down their
  // own query, Latest down the newest list.
  const moreFrom: "view" | "newest" | null =
    !home && (isFacet(view) || (!narrowed && rank === "hot")) && cursor ? "view" : !home && !narrowed && rank === "new" && newestCursor ? "newest" : null
  // The spotlight: the five trending first, held while they stay the five.
  const featKey = rows.slice(0, 5).map((r) => r.id).join()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => rows.slice(0, 5), [featKey])

  /** Where to go: a section of the bar, a row seen whole, a tag, a maker. */
  const go = (to: "home" | "hot" | "new" | "yours" | "liked" | `tag:${string}` | `maker:${string}`) => {
    browse.setQuery("")
    browse.clear()
    setRank(null)
    if (to === "hot" || to === "new") setRank(to)
    else if (to === "yours" || to === "liked") browse.setFacet(to)
    else if (to.startsWith("tag:")) browse.setTag(to.slice(4))
    else if (to.startsWith("maker:")) browse.setMaker(to.slice(6))
    else scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }
  const section = narrowed ? (isFacet(view) && !browse.tag && !browse.maker && !browse.query.trim() ? view : null) : (rank ?? "home")

  // ── The preview: a card grows into it, in place (PreviewLayer) ─────────────
  // Held in its own component: opening one re-renders the preview, never the
  // page's hundred covers.
  const previewApi = useRef<PreviewApi | null>(null)
  const showPreview = (s: GalleryRow, card: HTMLElement) => {
    if (!phone) previewApi.current?.show(s, card)
  }
  const hidePreview = useCallback((now = false) => previewApi.current?.hide(now), [])

  const onPageScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setSolid(el.scrollTop > 40)
    if (!loading && moreFrom && el.scrollTop + el.clientHeight > el.scrollHeight - 800) loadMore(moreFrom)
  }
  const [solid, setSolid] = useState(false)

  // Keys, as a TV's: arrows move across the covers (along a row, between rows),
  // the focused one previews, Enter opens it; F goes to search, as in the
  // editor; Esc lets go.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, [role=listbox], [role=menu]")
      if (e.key === "Escape") {
        hidePreview(true)
        if (typing) (e.target as HTMLElement).blur()
        return
      }
      if (typing) return
      if (e.key === "f" || e.key === "F") {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
      e.preventDefault()
      const cards = [...(contentRef.current?.querySelectorAll<HTMLElement>("[data-card]") ?? [])]
      const cur = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-card]")
      if (!cur) return cards[0]?.focus()
      const r = cur.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const pick = cards
        .filter((c) => c !== cur)
        .map((c) => {
          const b = c.getBoundingClientRect()
          return { c, dx: b.left + b.width / 2 - cx, dy: b.top + b.height / 2 - cy }
        })
        .filter(({ dx, dy }) =>
          e.key === "ArrowLeft" ? dx < -4 && Math.abs(dy) < 10 : e.key === "ArrowRight" ? dx > 4 && Math.abs(dy) < 10 : e.key === "ArrowUp" ? dy < -10 : dy > 10,
        )
        .sort((a, b) => Math.hypot(a.dx, a.dy * 2) - Math.hypot(b.dx, b.dy * 2))[0]
      if (!pick) return
      pick.c.focus({ preventScroll: true })
      pick.c.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hidePreview])

  /** One cover: the picture, its name and maker under it. A click opens the
   *  scene; a pause over it (or focus on it) grows the preview. Your own keep
   *  their menu: open, edit, delete. */
  const card = (s: GalleryRow, wide?: boolean) => {
    const node = (
      <div key={s.id} className={cn("flex shrink-0 flex-col gap-2", wide ? "w-full" : "w-[calc((100vw-10.75rem)/6.3)] compact:w-[44vw]")}>
        <Link
          href={sceneHref(s)}
          data-card={s.id}
          onMouseEnter={(e) => showPreview(s, e.currentTarget)}
          onMouseLeave={() => hidePreview()}
          onFocus={(e) => showPreview(s, e.currentTarget)}
          onBlur={() => hidePreview()}
          onPointerDown={() => router.prefetch(sceneHref(s))}
          // A phone has no hover: a tap grows the preview, and its Open opens.
          onClick={(e) => {
            if (!phone) return
            e.preventDefault()
            previewApi.current?.show(s, e.currentTarget, true)
          }}
          className="block aspect-video w-full overflow-hidden rounded-interior bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        >
          {s.poster && <CardCover src={s.poster} root={scrollRef} />}
        </Link>
        {/* Its name, and who made it under that. */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs text-foreground">{s.name}</span>
          <span className="flex min-w-0 items-center gap-1 font-mono text-2xs text-muted-foreground">
            <AuthorLink name={s.author} at className="truncate" />
          </span>
        </div>
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

  const sectionWord = (key: NonNullable<typeof section>, label: string) => (
    <Button
      key={key}
      variant="bare"
      onClick={() => go(key)}
      className={cn(
        "relative py-1 text-xs after:absolute after:inset-x-2 after:bottom-0 after:h-[1.5px]",
        section === key ? "text-foreground after:bg-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Button>
  )

  // THE GALLERY, as a streaming service's home: a spotlight of what is trending,
  // then rows of covers; any row, tag, maker or section seen whole as a grid.
  return (
    <main data-paper="dark" className="fixed inset-0 h-dvh w-screen bg-black text-foreground select-none">
      <Cover>
        {/* The bar: clear over the spotlight, a dark sheet once the page scrolls. */}
        <div
          className={cn(
            // The editor's top row, to the pixel: 20px down, 28px in from the
            // left and 24px from the right, a 32px line, so the wordmark stands
            // where it stands in the editor.
            "absolute inset-x-0 top-0 z-30 flex h-[4.25rem] items-start gap-7 pt-5 pr-6 pl-7 text-xs transition-[background-color] compact:h-auto compact:flex-wrap compact:gap-x-4 compact:gap-y-0 compact:pb-2",
            solid || !home ? "bg-black/80 backdrop-blur-md" : "bg-linear-to-b from-black/60 to-transparent",
          )}
        >
          <Link href="/" className={cn("flex h-8 shrink-0 items-center", WORDMARK)}>
            Reze Design
          </Link>
          {/* On a phone, a line of its own under the wordmark and search. */}
          {/* On a phone the wordmark has its line to itself; the sections and
              the search share the next one, and an open search takes it. */}
          <span aria-hidden className="hidden compact:block compact:h-0 compact:basis-full" />
          <nav
            className={cn(
              "flex h-8 items-center gap-5 compact:no-scrollbar compact:min-w-0 compact:flex-1 compact:gap-4 compact:overflow-x-auto",
              searchOpen && "compact:hidden",
            )}
          >
            {sectionWord("home", t.gallery.title)}
            {sectionWord("new", t.rail.sortNew)}
            {session && sectionWord("yours", t.rail.yours)}
            {session && sectionWord("liked", t.rail.liked)}
          </nav>
          <SiteChip site="bilibili" href="/bilibili" className="mt-1 h-6 px-2 text-xs compact:hidden">
            {t.bilibili.title}
          </SiteChip>
          <span className="flex-1 compact:hidden" />
          <label
            // Folded to its glass on a phone until it is wanted.
            onClick={() => {
              if (searchOpen) return
              setSearching(true)
              requestAnimationFrame(() => searchRef.current?.focus())
            }}
            className={cn(
              "relative flex h-8 w-64 items-center gap-2 px-3 text-muted-foreground transition-[width] duration-233 after:absolute after:inset-0 after:rounded-interior after:border after:border-line-strong after:transition-colors focus-within:w-80 focus-within:after:border-foreground",
              searchOpen ? "compact:w-auto compact:flex-1 compact:focus-within:w-auto" : "compact:w-8 compact:justify-center compact:px-0 compact:after:border-transparent",
            )}
          >
            <Search className="size-3.5 shrink-0" strokeWidth={1.5} />
            <Input
              ref={searchRef}
              variant="bare"
              value={browse.query}
              onChange={(e) => {
                setRank(null)
                browse.setQuery(e.target.value)
              }}
              onFocus={() => setSearching(true)}
              onBlur={() => setSearching(false)}
              placeholder={t.rail.search}
              className={cn("h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground", !searchOpen && "compact:hidden")}
            />
            <kbd className="flex h-4 min-w-4 items-center justify-center rounded-chip border border-line px-1 font-mono text-2xs compact:hidden">F</kbd>
          </label>
        </div>

        <div ref={scrollRef} onScroll={onPageScroll} className="no-scrollbar h-full overflow-x-hidden overflow-y-auto">
          <div ref={contentRef} className="relative pb-20">
            {home ? (
              <>
                {feat.length > 0 ? (
                  <Spotlight
                    feat={feat}
                    phone={phone}
                    likesOf={likesOf}
                    liked={(id) => statFor(id).liked}
                    canLike={signedIn}
                    onLike={(id) => void toggleLike(id)}
                    onFork={requestFork}
                    onEdit={editScene}
                    onRemove={remove}
                    onTag={(tag) => go(`tag:${tag}`)}
                    href={sceneHref}
                  />
                ) : (
                  <div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground">
                    {failed ? t.gallery.failed : loading ? t.gallery.loading : t.gallery.empty}
                  </div>
                )}
                <div className="relative z-10 -mt-10">
                  {shelves.map((shelf) => (
                    <Row
                      key={shelf.key}
                      title={shelf.title}
                      onMore={() =>
                        go(shelf.key === "hot" ? "hot" : shelf.key === "new" ? "new" : (shelf.key as `tag:${string}` | `maker:${string}`))
                      }
                      onScroll={() => hidePreview(true)}
                    >
                      {shelf.rows.map((s) => card(s))}
                    </Row>
                  ))}
                </div>
              </>
            ) : (
              <section className="px-12 pt-28 compact:px-4 compact:pt-32">
                <header className="flex items-baseline gap-4">
                  <h1 className="font-display text-billboard text-foreground italic">{gridTitle}</h1>
                  {!loading && <span className="font-mono text-xs text-muted-foreground">{t.gallery.count(gridRows.length)}</span>}
                </header>
                {gridRows.length === 0 ? (
                  <p className="mt-8 text-xs text-muted-foreground">{loading ? t.gallery.loading : t.rail.noMatches}</p>
                ) : (
                  <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-3.5 gap-y-6 compact:grid-cols-2 compact:gap-x-2.5 compact:gap-y-4">
                    {gridRows.map((s) => card(s, true))}
                  </div>
                )}
                {loading && gridRows.length > 0 && (
                  <div className="mt-8 flex justify-center text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
              </section>
            )}

            <PreviewLayer
              ref={previewApi}
              touch={phone}
              contentRef={contentRef}
              scrollRef={scrollRef}
              href={sceneHref}
              likesOf={likesOf}
              liked={(id) => statFor(id).liked}
              canLike={signedIn}
              onLike={(id) => void toggleLike(id)}
              onFork={requestFork}
              onTag={(tag) => go(`tag:${tag}`)}
            />
          </div>
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

/** How long the preview takes to shrink back onto its card: the one motion
 *  duration (globals.css, "The gallery"). */
const CLOSE_MS = 233
/** A pause on a cover before it grows; longer while another is closing. */
const DWELL_MS = 200

type PreviewApi = { show: (s: GalleryRow, card: HTMLElement, now?: boolean) => void; hide: (now?: boolean) => void }

/**
 * The preview a cover grows into. It starts ON the card (same place, size and
 * picture, so the hand-off is invisible), then opens to its size; it shrinks
 * back onto its card before it goes, and before another one opens. Its state
 * is its own, so none of this re-renders the page.
 */
function PreviewLayer({
  ref,
  touch,
  contentRef,
  scrollRef,
  href,
  likesOf,
  liked,
  canLike,
  onLike,
  onFork,
  onTag,
}: {
  ref: React.Ref<PreviewApi>
  /** A phone or tablet: a tap opens it, a tap anywhere else lets it go. */
  touch: boolean
  contentRef: React.RefObject<HTMLDivElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  href: (s: GalleryScene) => string
  likesOf: (s: GalleryScene) => number
  liked: (id: string) => boolean
  canLike: boolean
  onLike: (id: string) => void
  onFork: (s: GalleryScene) => void
  onTag: (tag: string) => void
}) {
  const t = useT()
  const [cur, setCur] = useState<{ s: GalleryRow; card: HTMLElement } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const dwell = useRef(0)
  const leaving = useRef(0)
  /** The transform that lays the preview on its card. */
  const onCard = useRef("")
  const open = useRef<HTMLElement | null>(null)

  useEffect(
    () => () => {
      clearTimeout(dwell.current)
      clearTimeout(leaving.current)
    },
    [],
  )
  useImperativeHandle(ref, () => {
    // Back down onto its card, then gone.
    const shut = () => {
      const pop = popRef.current
      open.current = null
      if (!pop || !onCard.current) return setCur(null)
      pop.setAttribute("data-closing", "")
      pop.removeAttribute("data-open")
      pop.style.transform = onCard.current
      leaving.current = window.setTimeout(() => setCur(null), CLOSE_MS)
    }
    return {
      show: (s: GalleryRow, card: HTMLElement, now = false) => {
        clearTimeout(dwell.current)
        if (open.current === card) return clearTimeout(leaving.current)
        // Another is open: it closes first, then this one grows.
        const busy = open.current !== null
        if (busy) {
          clearTimeout(leaving.current)
          shut()
        }
        dwell.current = window.setTimeout(() => {
          clearTimeout(leaving.current)
          open.current = card
          setCur({ s, card })
        }, busy ? CLOSE_MS : now ? 0 : DWELL_MS)
      },
      hide: (now = false) => {
        clearTimeout(dwell.current)
        clearTimeout(leaving.current)
        if (!open.current) return
        if (now) shut()
        else leaving.current = window.setTimeout(shut, 120)
      },
    }
  }, [])

  useLayoutEffect(() => {
    const pop = popRef.current
    const content = contentRef.current
    if (!cur || !pop || !content) return
    const r = cur.card.getBoundingClientRect()
    const box = content.getBoundingClientRect()
    // A phone's covers are already large: there it opens to a little past its
    // card rather than to the desktop's 360px floor.
    const w = Math.min(window.innerWidth - 32, touch ? r.width * 1.4 : Math.max(360, r.width * 1.5))
    const imgH = (w * 9) / 16
    // Its cover centred on the card's, kept on screen.
    const left = Math.max(16, Math.min(window.innerWidth - w - 16, r.left + r.width / 2 - w / 2))
    const top = Math.max(72, r.top + r.height / 2 - imgH / 2)
    onCard.current = `translate(${r.left - left}px, ${r.top - top}px) scale(${r.width / w})`
    pop.style.width = `${w}px`
    pop.style.left = `${left - box.left}px`
    pop.style.top = `${top - box.top}px`
    // Laid on the card first, with no motion, then let go to its own size.
    pop.removeAttribute("data-closing")
    pop.removeAttribute("data-open")
    pop.style.transition = "none"
    pop.style.transform = onCard.current
    void pop.offsetWidth
    pop.style.transition = ""
    pop.style.transform = "none"
    pop.setAttribute("data-open", "")
    // Whole on screen: if its foot falls below the window, the page comes up.
    const below = top + pop.offsetHeight + 16 - window.innerHeight
    if (below > 0) scrollRef.current?.scrollBy({ top: below, behavior: "smooth" })
  }, [cur, contentRef, scrollRef, touch])

  // On a phone a tap elsewhere lets it go: there is no pointer to leave it.
  useEffect(() => {
    if (!touch || !cur) return
    const away = (e: PointerEvent) => {
      const at = e.target as Element | null
      if (popRef.current?.contains(at) || at?.closest?.("[data-card]")) return
      open.current = null
      setCur(null)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [touch, cur])

  if (!cur) return null
  const s = cur.s
  const keep = () => clearTimeout(leaving.current)
  const leave = () => {
    clearTimeout(dwell.current)
    leaving.current = window.setTimeout(() => {
      const pop = popRef.current
      open.current = null
      if (!pop) return setCur(null)
      pop.setAttribute("data-closing", "")
      pop.removeAttribute("data-open")
      pop.style.transform = onCard.current
      leaving.current = window.setTimeout(() => setCur(null), CLOSE_MS)
    }, 120)
  }
  return (
    <div
      ref={popRef}
      onMouseEnter={keep}
      onMouseLeave={leave}
      className="gallery-pop absolute z-20 overflow-hidden rounded-interior"
    >
      {/* A picture, not a door: Open is the one way into the scene. */}
      <div className="aspect-video overflow-hidden">
        {s.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.poster} alt="" className="size-full object-cover object-[50%_20%]" />
        )}
      </div>
      <div data-pop-body className="px-3.5 pt-3 pb-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="h-8 rounded-interior bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/85">
            <Link href={href(s)}>{t.gallery.open}</Link>
          </Button>
          {/* A phone watches; nothing on it edits, so it has no Fork. */}
          {!s.displayOnly && !touch && (
            <Button
              variant="bare"
              onClick={() => onFork(s)}
              className="h-8 rounded-interior border border-foreground/50 px-4 text-xs font-medium text-foreground hover:bg-white/10"
            >
              {t.share.fork}
            </Button>
          )}
          <LibraryLike likeCount={likesOf(s)} liked={liked(s.id)} canLike={canLike} onToggle={() => onLike(s.id)} />
          <VideoLink url={s.video} className="ml-auto h-7 px-2 text-2xs [&_svg]:size-3.5" />
        </div>
        <h3 className="mt-3 truncate text-sm font-medium text-foreground">{s.name}</h3>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          <AuthorLink name={s.author} at className="truncate text-foreground" />
          <span>·</span>
          <Stamp iso={s.createdAt} show="words" />
        </div>
        {s.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{s.description}</p>}
        {(s.tags.length > 0 || s.displayOnly) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {s.displayOnly && <DisplayOnlyTag />}
            {[...new Set(s.tags)].map((tag) => (
              <Button
                key={tag}
                variant="bare"
                onClick={() => {
                  open.current = null
                  setCur(null)
                  onTag(tag)
                }}
                className="rounded-full border border-line-strong px-2 py-0.5 text-2xs text-foreground hover:bg-white/10"
              >
                #{tag}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
/**
 * A card's cover, fetched once it nears the screen and faded up once it has
 * arrived. Its own observer rather than the browser's lazy loading: Safari's
 * never wakes for an image in a row that scrolls inside a page that scrolls,
 * which left every cover blank there. Framed as the preview frames it, so the
 * hand-off between them is the same picture.
 */
function CardCover({ src, root }: { src: string; root: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Watched against the page's own scroller, which clips the rows: against
    // the window, a cover just below the fold would wait until it was on screen.
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setNear(true)
        io.disconnect()
      },
      { root: root.current, rootMargin: "600px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [root])
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={near ? src : undefined}
      alt=""
      decoding="async"
      onLoad={(e) => e.currentTarget.setAttribute("data-loaded", "")}
      className="size-full object-cover object-[50%_20%] opacity-0 transition-opacity duration-233 data-loaded:opacity-100"
    />
  )
}

/** How long each scene holds the spotlight. */
const SPOT_MS = 8000
/** The home's rows beyond Trending and Latest: the most used tags and the
 *  most prolific makers, a few of each. */
const TAG_ROWS = 3
const MAKER_ROWS = 2

/**
 * The top of the page: the five trending scenes in turn, each crossfading in
 * over the last, its name set over it in the cover's serif. Small covers at its foot say which and jump to one; a pointer
 * resting on it holds the turn.
 */
function Spotlight({
  feat,
  phone,
  likesOf,
  liked,
  canLike,
  onLike,
  onFork,
  onEdit,
  onRemove,
  onTag,
  href,
}: {
  feat: GalleryRow[]
  phone: boolean
  likesOf: (s: GalleryScene) => number
  liked: (id: string) => boolean
  canLike: boolean
  onLike: (id: string) => void
  onFork: (s: GalleryScene) => void
  onEdit: (s: GalleryScene) => void
  onRemove: (s: GalleryScene) => void
  onTag: (tag: string) => void
  href: (s: GalleryScene) => string
}) {
  const t = useT()
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  const s = feat[Math.min(at, feat.length - 1)]
  useEffect(() => {
    if (held || feat.length < 2) return
    const timer = window.setTimeout(() => setAt((i) => (i + 1) % feat.length), SPOT_MS)
    return () => clearTimeout(timer)
  }, [at, held, feat.length])
  return (
    <section
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      className="relative h-[min(56.25vw,80vh)] min-h-[28rem] overflow-hidden compact:h-[70vh]"
    >
      {feat.map((f, i) => (
        <div key={f.id} data-on={i === at || undefined} className="gallery-slide absolute inset-0">
          {f.poster && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.poster} alt="" decoding="async" className="size-full object-cover object-[50%_20%]" />
          )}
        </div>
      ))}
      {/* The side the type stands on, and the foot the rows rise over. */}
      <div aria-hidden className="absolute inset-0 bg-linear-to-r from-black/80 via-black/35 via-40% to-transparent to-65%" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black via-black/50 via-20% to-transparent" />
      <div
        key={s.id}
        className="cover-enter absolute top-[42%] left-12 flex w-[min(68rem,72vw)] -translate-y-1/2 flex-col [text-shadow:var(--white-ink-shadow)] compact:top-auto compact:bottom-[26%] compact:left-4 compact:w-[calc(100%-2rem)] compact:translate-y-0"
      >
        <h2 className="font-display text-billboard text-foreground italic select-text compact:text-display">{s.name}</h2>
        <div className="mt-4 flex min-w-0 items-center gap-2 font-mono text-xs tracking-wide text-muted-foreground compact:text-2xs">
          <AuthorAvatar name={s.author} image={s.authorImage} className="size-5 compact:size-4" />
          <AuthorLink name={s.author} at className="truncate text-foreground select-text" />
          <span>·</span>
          <Stamp iso={s.createdAt} show="words" />
        </div>
        {s.description && <p className="mt-3 line-clamp-2 max-w-[34rem] text-xs leading-relaxed text-foreground select-text">{s.description}</p>}
        {s.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...new Set(s.tags)].map((tag) => (
              <Button
                key={tag}
                variant="bare"
                onClick={() => onTag(tag)}
                className="rounded-full border border-line-strong px-2 py-0.5 text-2xs text-foreground hover:bg-white/10"
              >
                #{tag}
              </Button>
            ))}
          </div>
        )}
        {/* The maker's own render, on a line of its own above the actions. */}
        <VideoLink url={s.video} className="mt-4 w-fit" />
        <div className="mt-6 flex flex-wrap items-center gap-2.5 [text-shadow:none]">
          <Button asChild size="sm" className="h-9 gap-2 rounded-interior bg-foreground px-5 text-xs font-medium text-background hover:bg-foreground/85">
            {/* A real link: cmd-click still gets a new tab. */}
            <Link href={href(s)}>{t.gallery.open}</Link>
          </Button>
          {!s.displayOnly && !phone && (
            <Button variant="bare" onClick={() => onFork(s)} className="h-9 rounded-interior border border-foreground/50 px-5 text-xs font-medium text-foreground hover:bg-white/10">
              {t.share.fork}
            </Button>
          )}
          <LibraryLike large likeCount={likesOf(s)} liked={liked(s.id)} canLike={canLike} onToggle={() => onLike(s.id)} />
          {s.mine && (
            <>
              <Button variant="bare" onClick={() => onEdit(s)} className="h-9 text-xs text-muted-foreground hover:text-foreground">
                {t.gallery.editPublished}
              </Button>
              <Button variant="bare" onClick={() => onRemove(s)} className="h-9 text-xs text-muted-foreground hover:text-red-400">
                {t.library.deletePublished}
              </Button>
            </>
          )}
        </div>
      </div>
      {feat.length > 1 && (
        <div className="absolute right-12 bottom-14 z-10 flex gap-2 compact:hidden">
          {feat.map((f, i) => (
            <Button
              key={f.id}
              variant="bare"
              aria-label={f.name}
              onClick={() => setAt(i)}
              className={cn(
                "block aspect-video w-24 overflow-hidden rounded-chip outline-offset-2 transition-[opacity,translate] duration-233",
                i === at ? "-translate-y-0.5 opacity-100 outline-[1.5px] outline-foreground" : "opacity-45 outline-transparent hover:opacity-80",
              )}
            >
              {f.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.poster} alt="" decoding="async" className="size-full object-cover object-[50%_20%]" />
              )}
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}

/** A row of covers that scrolls sideways under its title. The title opens the
 *  row whole; two small chevrons at the end of its line page it, shown only
 *  when it runs past the screen. */
function Row({ title, onMore, onScroll, children }: { title: string; onMore: () => void; onScroll: () => void; children: React.ReactNode }) {
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
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" })
  }
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between px-12 compact:px-4">
        <h2>
          <Button variant="bare" onClick={onMore} className="text-base font-semibold text-foreground underline-offset-4 hover:underline">
            {title}
          </Button>
        </h2>
        {(more.back || more.on) && (
          // Pulled out by the button's and the glyph's own margin, so the arrow
          // ends where the title's padding begins at the other side.
          <span className="-mr-1.5 flex items-center gap-2 compact:hidden">
            {([-1, 1] as const).map((dir) => (
              <Button
                key={dir}
                variant="bare"
                aria-hidden
                tabIndex={-1}
                disabled={dir < 0 ? !more.back : !more.on}
                onClick={() => page(dir)}
                className="flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {dir < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
              </Button>
            ))}
          </span>
        )}
      </div>
      <div ref={ref} onScroll={onScroll} className="no-scrollbar flex gap-3 overflow-x-auto scroll-px-12 px-12 pt-3.5 pb-5 compact:gap-2.5 compact:px-4">
        {children}
      </div>
    </section>
  )
}
