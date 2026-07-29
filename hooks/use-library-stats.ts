"use client"

// Like counts and scene-usage for every library item, fetched once per library
// open rather than per card — a grid of twenty shouldn't make twenty round trips.
//
// Built-ins are included: the seed mirrors content/*.json into the database, so a
// curated preset accumulates likes and usage exactly like a contributed one.

import { useCallback, useEffect, useState } from "react"

export type ItemStats = { likeCount: number; liked: boolean; scenes: number }

export function useLibraryStats() {
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

  const toggleLike = useCallback(
    async (id: string) => {
      if (!signedIn) return
      // Optimistic: a heart that waits on Singapore feels broken.
      setStats((s) => {
        const cur = s[id] ?? { likeCount: 0, liked: false, scenes: 0 }
        return { ...s, [id]: { ...cur, liked: !cur.liked, likeCount: cur.likeCount + (cur.liked ? -1 : 1) } }
      })
      const res = await fetch(`/api/library/${id}/like`, { method: "POST" })
      if (!res.ok) {
        // Roll back rather than leave a count the server disagrees with.
        setStats((s) => {
          const cur = s[id]
          if (!cur) return s
          return { ...s, [id]: { ...cur, liked: !cur.liked, likeCount: cur.likeCount + (cur.liked ? -1 : 1) } }
        })
        return
      }
      const { liked, likeCount } = (await res.json()) as { liked: boolean; likeCount: number }
      setStats((s) => ({ ...s, [id]: { ...(s[id] ?? { scenes: 0 }), liked, likeCount } as ItemStats }))
    },
    [signedIn],
  )

  return { stats, signedIn, ready, toggleLike }
}
