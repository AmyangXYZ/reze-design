"use client"

// Like counts and scene-usage for every library item, fetched once per SESSION
// rather than per library open — a grid of twenty shouldn't make twenty round
// trips, and a library shouldn't open into empty counts that fill in a beat later.
// Prefetched while the page is idle, so by the time anyone opens one it is there.
//
// Looked up by the item's permanent uuid — the only identity that matters (see
// lib/library.ts). Built-ins author theirs in content/*.json and are seeded under
// it, drafts mint one at creation and keep it through publishing, and a scene
// records what it uses by id. A draft simply has no row on the server yet, which
// is why its heart is inert rather than a special case here.

import { trendScore } from "@/lib/trend"
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { useSession } from "@/lib/auth-client"
import { fetchJson, retryLater, retrySettled } from "@/lib/net"
import { readSaved, writeSaved } from "@/lib/saved"
import { likedIds, noteLike, subscribeMine, syncMine } from "@/lib/mine-store"
import { load as loadCommunity } from "@/lib/community-store"
import { usePollWhileOpen } from "@/hooks/use-poll-while-open"

/** `trend` is lib/trend.ts's score; NaN until the stats have loaded. */
export type ItemStats = { likeCount: number; liked: boolean; scenes: number; exports: number; trend: number }
/** Everyone's counts, from the public (CDN-cached) /api/library/stats. Whether
 *  YOU liked an item is lib/mine-store's, merged in by statFor. */
type Shared = Omit<ItemStats, "liked">

const EMPTY: Shared = { likeCount: 0, scenes: 0, exports: 0, trend: NaN }
const SAVED = "stats.v1"

let cache: Record<string, Shared> | null = null
/** The counts came from the server this session, not only from the saved copy. */
let fresh = false
let hydrating = false
let inflight: Promise<Record<string, Shared>> | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}

function load(force = false): Promise<Record<string, Shared>> {
  if (cache && fresh && !force) return Promise.resolve(cache)
  // First call in this tab: the saved counts paint while the network answers,
  // unless it answers first.
  if (!cache && !hydrating) {
    hydrating = true
    void readSaved<{ stats: Record<string, Shared> }>(SAVED).then((saved) => {
      if (fresh || !saved?.stats) return
      cache = saved.stats
      notify()
    })
  }
  inflight ??= fetchJson<{ stats?: Record<string, Shared> }>("/api/library/stats")
    .then((d) => {
      cache = d.stats ?? {}
      fresh = true
      writeSaved(SAVED, { stats: cache })
      inflight = null
      retrySettled("library-stats")
      notify()
      return cache
    })
    .catch(() => {
      // A library that can't reach the server still browses. A FAILED refresh keeps
      // the counts it already had rather than blanking them, and asks again.
      inflight = null
      retryLater("library-stats", () => void load(true))
      return cache ?? {}
    })
  return inflight
}

/** Warm the cache during idle time after boot, so no library opens into a wait. */
export function prefetchLibraryStats(): void {
  void load()
}

/** A just-published row, so its card has a working heart before any refetch —
 *  without an entry there is nothing to like, and the count reads as dead. */
export function noteItemPublished(id: string): void {
  cache = { ...(cache ?? {}), [id]: { likeCount: 0, scenes: 0, exports: 0, trend: trendScore([Date.now()]) } }
  notify()
}

export function useLibraryStats() {
  const [stats, setStats] = useState<Record<string, Shared>>(() => cache ?? {})
  const [ready, setReady] = useState(() => cache !== null)
  const { data: session } = useSession()
  const signedIn = !!session
  const liked = useSyncExternalStore(subscribeMine, likedIds, likedIds)

  // Your hearts follow the account. The editor syncs this too; a library or
  // the gallery opened on its own (the scene viewer) brings it with it.
  const userId = session?.user.id ?? null
  useEffect(() => {
    syncMine(userId)
  }, [userId])

  useEffect(() => {
    let stale = false
    const apply = () => {
      if (stale || !cache) return
      setStats(cache)
      setReady(true)
    }
    // Forced: mounting means a library just opened. What is cached is already
    // on screen, and the read is the CDN's, so the check costs nothing visible.
    void load(true).then(apply)
    // Another surface refreshing the counts updates this one too.
    listeners.add(apply)
    return () => {
      stale = true
      listeners.delete(apply)
    }
  }, [])

  // Mounted only by the three libraries and the gallery, which makes this the
  // place an OPEN panel keeps current: everyone's counts and rows, both public
  // reads. Yours are never polled (lib/mine-store).
  usePollWhileOpen(() => {
    void load(true)
    void loadCommunity(true)
  })

  const statFor = useCallback(
    (id: string): ItemStats => ({ ...(stats[id] ?? EMPTY), liked: liked.has(id) }),
    [stats, liked],
  )

  /** Whether the counts have this item at all. False for a local draft, and for
   *  a row published since the last refetch — so a surface holding its own count
   *  knows when to trust that one instead of a zero from here. */
  const known = useCallback((id: string): boolean => id in stats, [stats])

  /**
   * Signing in is the ONLY thing this hook gates liking on.
   *
   * It also required the item to be in the snapshot, which sounds like the same
   * "does it exist on the server" question and is not. The snapshot is one
   * request that can be stale, can have failed, and — the case that actually bit
   * — is empty of built-ins in any deployment whose database has not been seeded.
   * A built-in is a perfectly real row to the like route; the client just had no
   * entry for it yet, so every heart in the library was disabled and read as a
   * counter. The server already knows whether an id can be liked and answers 404
   * when it cannot, which is the check that cannot go stale.
   *
   * Callers that know an item is a local DRAFT still pass false: it has no server
   * row by definition, and a click that can only 404 is not an affordance.
   */
  const toggleLike = useCallback(
    async (id: string) => {
      if (!signedIn) return
      // Optimistic: a heart that waits on Singapore feels broken. Seeds an entry
      // when there is none, so an item the counts never carried still counts up
      // under the cursor rather than sitting at zero until the next refetch.
      const was = likedIds().has(id)
      const bump = (by: number) => (s: Record<string, Shared>) => {
        const cur = s[id] ?? EMPTY
        return { ...s, [id]: { ...cur, likeCount: Math.max(0, cur.likeCount + by) } }
      }
      noteLike(id, !was)
      setStats(bump(was ? -1 : 1))
      const ok = await fetch(`/api/library/${id}/like`, { method: "POST" })
        .then((r) => (r.ok ? (r.json() as Promise<{ liked: boolean; likeCount: number }>) : null))
        .catch(() => null)
      if (!ok) {
        // Roll back rather than leave a count the server disagrees with. A 404
        // here is an item with no row — a draft, or an unseeded built-in — and
        // the heart returning to where it was IS the answer.
        noteLike(id, was)
        setStats(bump(was ? 1 : -1))
        return
      }
      noteLike(id, ok.liked)
      setStats((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), likeCount: ok.likeCount } }))
      // The next surface to mount should see the new count, not the stale one.
      if (cache) cache = { ...cache, [id]: { ...(cache[id] ?? EMPTY), likeCount: ok.likeCount } }
    },
    [signedIn],
  )

  return { statFor, signedIn, known, ready, toggleLike }
}
