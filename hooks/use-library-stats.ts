"use client"

// Like counts and scene-usage for every library item, fetched once per SESSION
// rather than per library open — a grid of twenty shouldn't make twenty round
// trips, and a library shouldn't open into empty counts that fill in a beat later.
// Prefetched while the page is idle, so by the time anyone opens one it is there.
//
// Looked up by NAME within the library's kind: names are the human key (unique
// per kind), builtins carry no stored id, and the server sends each row's
// machine-minted id inside the entry for the like route.

import { useCallback, useEffect, useState } from "react"

export type ItemStats = { id: string; likeCount: number; liked: boolean; scenes: number }

const EMPTY: Omit<ItemStats, "id"> = { likeCount: 0, liked: false, scenes: 0 }

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
 *  without an entry there is no id to like, and the count reads as dead. */
export function noteItemPublished(kind: string, name: string, id: string): void {
  const key = `${kind}:${name}`
  const snap = (cache ??= { stats: {}, signedIn: true })
  snap.stats[key] = { id, likeCount: 0, liked: false, scenes: 0 }
  for (const l of listeners) l()
}

export function useLibraryStats(kind: "grade" | "graph" | "effect" | "scene") {
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

  const statFor = useCallback((name: string): Omit<ItemStats, "id"> => stats[`${kind}:${name}`] ?? EMPTY, [stats, kind])

  const toggleLike = useCallback(
    async (name: string) => {
      const key = `${kind}:${name}`
      const id = stats[key]?.id
      // Drafts and rows the seed hasn't mirrored have no server identity to like.
      if (!signedIn || !id) return
      // Optimistic: a heart that waits on Singapore feels broken.
      const flip = (s: Record<string, ItemStats>) => {
        const cur = s[key]
        if (!cur) return s
        return { ...s, [key]: { ...cur, liked: !cur.liked, likeCount: cur.likeCount + (cur.liked ? -1 : 1) } }
      }
      setStats(flip)
      const res = await fetch(`/api/library/${id}/like`, { method: "POST" })
      if (!res.ok) {
        // Roll back rather than leave a count the server disagrees with.
        setStats(flip)
        return
      }
      const { liked, likeCount } = (await res.json()) as { liked: boolean; likeCount: number }
      setStats((s) => ({ ...s, [key]: { ...(s[key] ?? { id, scenes: 0 }), id, liked, likeCount } }))
      // The next surface to mount should see the new count, not the stale snapshot.
      if (cache) cache.stats[key] = { ...(cache.stats[key] ?? { id, scenes: 0 }), id, liked, likeCount }
    },
    [signedIn, stats, kind],
  )

  return { statFor, signedIn, ready, toggleLike }
}
