"use client"

// The React face of the community store: hooks that subscribe a component to
// the rows. The rows, and the functions that read and amend them, live in
// lib/community-store.

import { useEffect, useState, useSyncExternalStore } from "react"
import type { LibraryItem, LibraryKind } from "@/lib/library"
import { cache, listeners, load, loadFresh, settled, subscribe, type CommunityItem } from "@/lib/community-store"


/**
 * Whether the community rows are actually here yet.
 *
 * For the one caller that must not act on an empty list: adopting orphan looks
 * asks "does this match anything published?", and asked too early the answer is
 * no for everything — which took a local copy of every graph in the scene you
 * just opened. Stays false when the fetch fails, so being offline skips the
 * repair instead of doing it wrong.
 */
export function useCommunityLoaded(): boolean {
  useEffect(() => {
    void load()
  }, [])
  return useSyncExternalStore(subscribe, () => settled, () => false)
}

export function useCommunity<T extends LibraryItem = LibraryItem>(kind: LibraryKind): (T & { mine: boolean })[] {
  const [items, setItems] = useState<CommunityItem[]>(() => cache ?? [])
  useEffect(() => {
    let stale = false
    const apply = (all: CommunityItem[]) => !stale && setItems([...all])
    // Mounting means a library just opened: a copy older than a minute is
    // refreshed while the cached rows stay on screen, and a failed refresh keeps
    // them. Every surface mounted at boot shares the one startup fetch.
    void loadFresh().then(apply)
    const relay = () => apply(cache ?? [])
    listeners.add(relay)
    return () => {
      stale = true
      listeners.delete(relay)
    }
  }, [])

  return items.filter((i) => i.kind === kind) as (T & { mine: boolean })[]
}
