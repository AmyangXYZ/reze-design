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

  /** Whether this item can be liked at all: signed in, and it exists on the
   *  server. A local draft fails the second test — there is nothing to like yet. */
  const canLike = useCallback((id: string): boolean => signedIn && id in stats, [signedIn, stats])

  const toggleLike = useCallback(
    async (id: string) => {
      // Drafts and rows the seed hasn't mirrored have no server identity to like.
      if (!signedIn || !(id in stats)) return
      // Optimistic: a heart that waits on Singapore feels broken.
      const flip = (s: Record<string, ItemStats>) => {
        const cur = s[id]
        if (!cur) return s
        return { ...s, [id]: { ...cur, liked: !cur.liked, likeCount: cur.likeCount + (cur.liked ? -1 : 1) } }
      }
      setStats(flip)
      const res = await fetch(`/api/library/${id}/like`, { method: "POST" })
      if (!res.ok) {
        // Roll back rather than leave a count the server disagrees with.
        setStats(flip)
        return
      }
      const { liked, likeCount } = (await res.json()) as { liked: boolean; likeCount: number }
      setStats((s) => ({ ...s, [id]: { ...(s[id] ?? EMPTY), liked, likeCount } }))
      // The next surface to mount should see the new count, not the stale snapshot.
      if (cache) cache.stats[id] = { ...(cache.stats[id] ?? EMPTY), liked, likeCount }
    },
    [signedIn, stats],
  )

  return { statFor, signedIn, known, canLike, ready, toggleLike }
}
