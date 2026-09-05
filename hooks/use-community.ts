"use client"

// The community half of every library: public rows fetched once per session and
// shared by all consumers (three libraries, the quick-picks, name resolution in
// page.tsx) — a module-level cache, because six components each fetching the
// same list is how a library gets six spinners.
//
// Built-ins are excluded here even though the seed mirrors them into the
// database: the repo is the authority for their content, and showing the mirror
// would double every builtin card.
//
// Matched by ID, not by name. A name is the human key and it changes — a preset
// gets renamed, or retired from the repo entirely — and the moment it does, its
// mirror row stops matching and comes back as somebody's community item. Worse,
// built-ins are seeded to the ADMIN account, so for that account the stray rows
// also land under "Yours" and inflate the count. An id is minted once and never
// moves, which is the whole reason ids exist alongside names here.

import { useEffect, useState, useSyncExternalStore } from "react"
import { EFFECTS } from "@/lib/effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import type { LibraryItem, LibraryKind } from "@/lib/library"

/** `authorImage` is the account's avatar; `createdAt` and `visibility` ride on
 *  the envelope itself. */
export type CommunityItem = LibraryItem & { mine: boolean; authorImage?: string | null }

const BUILTIN_IDS: Partial<Record<LibraryKind, Set<string>>> = {
  grade: new Set(GRADE_PRESETS.map((i) => i.id)),
  effect: new Set(EFFECTS.map((i) => i.id)),
  graph: new Set(GRAPH_LIBRARY.map((i) => i.id)),
}

let cache: CommunityItem[] | null = null
let inflight: Promise<CommunityItem[]> | null = null
// Has a fetch ever SUCCEEDED? Distinct from "cache is empty": until the rows
// land, every published item looks like it does not exist, and code that
// decides what is unpublished has to wait rather than guess. A failed fetch
// leaves this false — unknown is not the same as none.
let settled = false
const listeners = new Set<() => void>()
// The seed mirrors builtins with the ADMIN ACCOUNT's live handle as author —
// the repo JSON can't know it, so display resolves through this map.
const builtinAuthors = new Map<string, string>()
// Avatars by AUTHOR NAME rather than by item id. Every row the server sends
// carries one, built-in mirrors included, so a rail that groups by maker can
// show the person without each library threading an image through its own list.
const authorImages = new Map<string, string>()
// Bundled items the signed-in user owns. Built-ins are simply presets authored by
// the admin account, so for THAT account they belong under "Yours" like anything
// else they published — the bundle just can't know who is asking.
let mineIds = new Set<string>()

function load(force = false): Promise<CommunityItem[]> {
  if (cache && !force) return Promise.resolve(cache)
  inflight ??= fetch("/api/library")
    .then((r) => r.json())
    .then((d: { items?: CommunityItem[] }) => {
      const rows = d.items ?? []
      mineIds = new Set(rows.filter((i) => i.mine).map((i) => i.id))
      for (const i of rows) {
        if (BUILTIN_IDS[i.kind]?.has(i.id)) builtinAuthors.set(i.id, i.author)
        if (i.authorImage) authorImages.set(i.author, i.authorImage)
      }
      cache = rows.filter((i) => !BUILTIN_IDS[i.kind]?.has(i.id))
      settled = true
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

/** Does the signed-in user own this bundled item? Matched by uuid, which the
 *  bundle and the database now share. */
export function isMine(id: string): boolean {
  return mineIds.has(id)
}

/** The live author to display for a built-in (the admin account's handle), or
 *  the repo's fallback when the mirror hasn't been fetched. */
export function builtinAuthor(id: string, fallback: string): string {
  return builtinAuthors.get(id) ?? fallback
}

/** The avatar for an author, once the library has been fetched. Null is the
 *  ordinary answer: an account that signed up without one, or a clone with no
 *  database, and the caller falls back to initials. */
export function authorImage(name: string): string | null {
  return authorImages.get(name) ?? null
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

/** Reflect a visibility change the server accepted. */
export function setCommunityVisibility(id: string, visibility: "public" | "private") {
  cache = (cache ?? []).map((i) => (i.id === id ? { ...i, visibility } : i))
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

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

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
    // Forced: mounting means a library just opened, and the cached rows are
    // already on screen while the check runs. A failed refresh keeps them.
    void load(true).then(apply)
    const relay = () => apply(cache ?? [])
    listeners.add(relay)
    return () => {
      stale = true
      listeners.delete(relay)
    }
  }, [])

  return items.filter((i) => i.kind === kind) as (T & { mine: boolean })[]
}
