"use client"

// The community half of every library: public rows fetched once per session and
// shared by all consumers (three libraries, the quick-picks, name resolution in
// page.tsx) — a module-level cache, because six components each fetching the
// same list is how a library gets six spinners.
//
// Built-ins are excluded here even though the seed mirrors them into the
// database: the repo is the authority for their content, and showing the mirror
// would double every builtin card.

import { useEffect, useState } from "react"
import { BACKGROUND_EFFECTS } from "@/lib/background-effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import type { LibraryItem, LibraryKind } from "@/lib/library"

export type CommunityItem = LibraryItem & { mine: boolean }

const BUILTIN_NAMES: Partial<Record<LibraryKind, Set<string>>> = {
  grade: new Set(GRADE_PRESETS.map((i) => i.name)),
  effect: new Set(BACKGROUND_EFFECTS.map((i) => i.name)),
  graph: new Set(GRAPH_LIBRARY.map((i) => i.name)),
}

let cache: CommunityItem[] | null = null
let inflight: Promise<CommunityItem[]> | null = null
const listeners = new Set<() => void>()

function load(): Promise<CommunityItem[]> {
  if (cache) return Promise.resolve(cache)
  inflight ??= fetch("/api/library")
    .then((r) => r.json())
    .then((d: { items?: CommunityItem[] }) => {
      cache = (d.items ?? []).filter((i) => !BUILTIN_NAMES[i.kind]?.has(i.name))
      return cache
    })
    .catch(() => {
      // Offline still browses builtins and drafts; community just stays empty.
      inflight = null
      return cache ?? []
    })
  return inflight
}

/** Merge a JUST-published row so the library shows it before any refetch. */
export function addCommunityItem(item: LibraryItem) {
  cache = [...(cache ?? []), { ...item, owner: "user", mine: true }]
  for (const l of listeners) l()
}

export function useCommunity<T extends LibraryItem = LibraryItem>(kind: LibraryKind): (T & { mine: boolean })[] {
  const [items, setItems] = useState<CommunityItem[]>(() => cache ?? [])
  useEffect(() => {
    let stale = false
    const update = () => void load().then((all) => !stale && setItems([...all]))
    update()
    listeners.add(update)
    return () => {
      stale = true
      listeners.delete(update)
    }
  }, [])
  return items.filter((i) => i.kind === kind) as (T & { mine: boolean })[]
}
