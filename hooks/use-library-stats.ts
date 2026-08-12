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

import { useCallback, useEffect, useState } from "react"

export type ItemStats = { likeCount: number; liked: boolean; scenes: number }

const EMPTY: ItemStats = { likeCount: 0, liked: false, scenes: 0 }

type Snapshot = { stats: Record<string, ItemStats>; signedIn: boolean }
let cache: Snapshot | null = null
let inflight: Promise<Snapshot> | null = null
const listeners = new Set<() => void>()

function load(force = false): Promise<Snapshot> {
  if (cache && !force) return Promise.resolve(cache)
  inflight ??= fetch("/api/library/stats")
    .then((r) => r.json())
    .then((d: { stats?: Record<string, ItemStats>; signedIn?: boolean }) => {
      cache = { stats: d.stats ?? {}, signedIn: !!d.signedIn }
      inflight = null
      for (const l of listeners) l()
      return cache
    })
    .catch(() => {
      // A library that can't reach the server still browses. A FAILED refresh keeps
      // the counts it already had rather than blanking them.
      inflight = null
      return cache ?? { stats: {}, signedIn: false }
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
  const snap = (cache ??= { stats: {}, signedIn: true })
  snap.stats[id] = { likeCount: 0, liked: false, scenes: 0 }
  for (const l of listeners) l()
}

export function useLibraryStats() {
  const [stats, setStats] = useState<Record<string, ItemStats>>(() => cache?.stats ?? {})
  const [signedIn, setSignedIn] = useState(() => cache?.signedIn ?? false)
  const [ready, setReady] = useState(() => cache !== null)

  useEffect(() => {
    let stale = false
    const apply = (snap: Snapshot) => {
      if (stale) return
      setStats(snap.stats)
      setSignedIn(snap.signedIn)
      setReady(true)
    }
    // Forced: mounting means a library just opened. The snapshot is already on
    // screen, so the check costs nothing visible.
    void load(true).then(apply)
    // Another surface refreshing the snapshot updates this one too.
    const relay = () => cache && apply(cache)
    listeners.add(relay)
    return () => {
      stale = true
      listeners.delete(relay)
    }
  }, [])

  const statFor = useCallback((id: string): ItemStats => stats[id] ?? EMPTY, [stats])

  /** Whether the snapshot has this item at all. False for a local draft, and for
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
      // when there is none, so an item the snapshot never carried still counts up
      // under the cursor rather than sitting at zero until the next refetch.
      const flip = (s: Record<string, ItemStats>) => {
        const cur = s[id] ?? EMPTY
        return {
          ...s,
          [id]: { ...cur, liked: !cur.liked, likeCount: Math.max(0, cur.likeCount + (cur.liked ? -1 : 1)) },
        }
      }
      setStats(flip)
      const res = await fetch(`/api/library/${id}/like`, { method: "POST" })
      if (!res.ok) {
        // Roll back rather than leave a count the server disagrees with. A 404
        // here is an item with no row — a draft, or an unseeded built-in — and
        // the heart returning to where it was IS the answer.
        setStats(flip)
        return
      }
      const { liked, likeCount } = (await res.json()) as { liked: boolean; likeCount: number }
      setStats((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), liked, likeCount } }))
      // The next surface to mount should see the new count, not the stale snapshot.
      if (cache) cache.stats[id] = { ...(cache.stats[id] ?? EMPTY), liked, likeCount }
    },
    [signedIn],
  )

  return { statFor, signedIn, known, ready, toggleLike }
}
