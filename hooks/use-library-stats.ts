"use client"

// Like counts and scene-usage for every library item, fetched once per library
// open rather than per card — a grid of twenty shouldn't make twenty round trips.
//
// Looked up by NAME within the library's kind: names are the human key (unique
// per kind), builtins carry no stored id, and the server sends each row's
// machine-minted id inside the entry for the like route.

import { useCallback, useEffect, useState } from "react"

export type ItemStats = { id: string; likeCount: number; liked: boolean; scenes: number }

const EMPTY: Omit<ItemStats, "id"> = { likeCount: 0, liked: false, scenes: 0 }

export function useLibraryStats(kind: "grade" | "graph" | "effect" | "scene") {
  const [stats, setStats] = useState<Record<string, ItemStats>>({})
  const [signedIn, setSignedIn] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let stale = false
    void fetch("/api/library/stats")
      .then((r) => r.json())
      .then((d: { stats?: Record<string, ItemStats>; signedIn?: boolean }) => {
        if (stale) return
        setStats(d.stats ?? {})
        setSignedIn(!!d.signedIn)
        setReady(true)
      })
      // A library that can't reach the server still browses; it just shows no counts.
      .catch(() => !stale && setReady(true))
    return () => {
      stale = true
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
    },
    [signedIn, stats, kind],
  )

  return { statFor, signedIn, ready, toggleLike }
}
