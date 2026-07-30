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
// The seed mirrors builtins with the ADMIN ACCOUNT's live handle as author —
// the repo JSON can't know it, so display resolves through this map.
const builtinAuthors = new Map<string, string>()

function load(force = false): Promise<CommunityItem[]> {
  if (cache && !force) return Promise.resolve(cache)
  inflight ??= fetch("/api/library")
    .then((r) => r.json())
    .then((d: { items?: CommunityItem[] }) => {
      const rows = d.items ?? []
      for (const i of rows) {
        if (BUILTIN_NAMES[i.kind]?.has(i.name)) builtinAuthors.set(`${i.kind}:${i.name}`, i.author)
      }
      cache = rows.filter((i) => !BUILTIN_NAMES[i.kind]?.has(i.name))
      inflight = null
      for (const l of listeners) l()
      return cache
    })
    .catch(() => {
      // Offline still browses builtins and drafts; community just stays empty.
      inflight = null
      return cache ?? []
    })
  return inflight
}

/** Refetch — each library calls this as it opens, so a publish from another tab
 *  or session shows up without a reload. */
export function refreshCommunity(): void {
  void load(true)
}

/** The live author to display for a built-in (the admin account's handle), or
 *  the repo's fallback when the mirror hasn't been fetched. */
export function builtinAuthor(kind: LibraryKind, name: string, fallback: string): string {
  return builtinAuthors.get(`${kind}:${name}`) ?? fallback
}

/** The cached rows for a kind, without subscribing — for callbacks that must not
 *  re-create themselves every time the cache changes. */
export function communityItems(kind: LibraryKind): CommunityItem[] {
  return (cache ?? []).filter((i) => i.kind === kind)
}

/** Reflect a rename the server accepted. */
export function renameCommunityItem(id: string, name: string) {
  cache = (cache ?? []).map((i) => (i.id === id ? { ...i, name } : i))
  for (const l of listeners) l()
}

/** Drop a row the server just deleted, without waiting for a refetch. */
export function removeCommunityItem(id: string) {
  cache = (cache ?? []).filter((i) => i.id !== id)
  for (const l of listeners) l()
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
