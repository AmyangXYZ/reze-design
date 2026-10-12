// The community library's store: the rows, the cache over them, and the plain
// functions that read and amend it.
//
// React-free, and that is load-bearing: `lib/refs.ts` reads this, refs sits on
// the scene pipeline, and one React import here puts React, every
// `components/ui` primitive and all of i18n into any host that opens a scene.
// Components subscribe through the hooks in hooks/use-community.

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

import { EFFECTS } from "@/lib/effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import type { LibraryItem, LibraryKind } from "@/lib/library"
import { fetchJson, retryLater, retrySettled } from "@/lib/net"
import { readSaved, writeSaved } from "@/lib/saved"
import { editMine, mineRows, subscribeMine } from "@/lib/mine-store"

/** `authorImage` is the account's avatar and `authorVerified` its check;
 *  `createdAt` and `visibility` ride on the envelope itself. */
export type CommunityItem = LibraryItem & { mine: boolean; authorImage?: string | null; authorVerified?: boolean }

const BUILTIN_IDS: Partial<Record<LibraryKind, Set<string>>> = {
  grade: new Set(GRADE_PRESETS.map((i) => i.id)),
  effect: new Set(EFFECTS.map((i) => i.id)),
  graph: new Set(GRAPH_LIBRARY.map((i) => i.id)),
}

/** @internal — the hooks read this through a live binding. */
export let cache: CommunityItem[] | null = null
let inflight: Promise<CommunityItem[]> | null = null
// Has a fetch ever SUCCEEDED? Distinct from "cache is empty": until the rows
// land, every published item looks like it does not exist, and code that
// decides what is unpublished has to wait rather than guess. A failed fetch
// leaves this false — unknown is not the same as none — and so does a saved
// copy (lib/saved), which is good enough to browse and not to decide with.
export let settled = false
/** When the rows last landed, so a library opening refreshes a stale copy
 *  without every surface mounted at boot fetching the same list again. */
let loadedAt = 0
/** @internal */
export const listeners = new Set<() => void>()
// The seed mirrors builtins with the ADMIN ACCOUNT's live handle as author —
// the repo JSON can't know it, so display resolves through this map.
const builtinAuthors = new Map<string, string>()
// Avatars by AUTHOR NAME rather than by item id. Every row the server sends
// carries one, built-in mirrors included, so a rail that groups by maker can
// show the person without each library threading an image through its own list.
const authorImages = new Map<string, string>()
// The makers we vouch for, by name like the avatars: the newest answer any row
// gave about each. Verified belongs to the MAKER, not the row — the gallery keeps
// pages it read before a check was granted and refreshes only its first window,
// and judging each card by its own row left some of one maker's cards without
// it. A row without the field (a copy saved before it existed) says nothing.
const verifiedAuthors = new Map<string, boolean>()

/** Learn who is verified from rows fresh off the server — the libraries' here,
 *  the gallery's from its pages. */
export function noteVerified(rows: Iterable<{ author: string; authorVerified?: boolean }>) {
  for (const r of rows) if (typeof r.authorVerified === "boolean") verifiedAuthors.set(r.author, r.authorVerified)
}
// Bundled items the signed-in user owns. Built-ins are simply presets authored by
// the admin account, so for THAT account they belong under "Yours" like anything
// else they published — the bundle just can't know who is asking.
let mineIds = new Set<string>()

type PublicRow = Omit<CommunityItem, "mine">
const SAVED = "community.v1"
/** Everyone's rows, from /api/library (or the saved copy until it answers).
 *  Null until either has been read. */
let publicRows: PublicRow[] | null = null
let hydrating = false

/**
 * The cache is ONE merge: everyone's rows plus yours (lib/mine-store), yours
 * winning, built-ins left out (the repo is their authority), newest first.
 * Rebuilt whenever either side changes, so neither can overwrite the other.
 */
function rebuild() {
  const own = mineRows()
  mineIds = new Set(own.map((i) => i.id))
  const byId = new Map<string, CommunityItem>()
  for (const r of publicRows ?? []) byId.set(r.id, { ...r, mine: mineIds.has(r.id) })
  for (const r of own) byId.set(r.id, r)
  for (const i of byId.values()) {
    if (BUILTIN_IDS[i.kind]?.has(i.id)) builtinAuthors.set(i.id, i.author)
    if (i.authorImage) authorImages.set(i.author, i.authorImage)
  }
  noteVerified(byId.values())
  cache =
    publicRows === null && own.length === 0
      ? null
      : [...byId.values()]
          .filter((i) => !BUILTIN_IDS[i.kind]?.has(i.id))
          .sort((a, b) => ((a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : (a.createdAt ?? "") > (b.createdAt ?? "") ? -1 : 0))
  for (const l of listeners) l()
}
subscribeMine(rebuild)

// Which request is the current one. Only the newest response may write the
// rows, so two in flight (a library opening while the boot fetch is still out)
// cannot land out of order and leave the older one winning.
let generation = 0

/** @internal */
export function load(force = false): Promise<CommunityItem[]> {
  if (cache && settled && !force) return Promise.resolve(cache)
  if (inflight && !force) return inflight
  // First call in this tab: paint the saved copy while the network answers.
  // Here rather than at import, so the server render and the first client
  // render agree (both empty) and the saved rows arrive like any update. Only
  // if the network has not answered first: saved is never newer.
  if (publicRows === null && !hydrating) {
    hydrating = true
    void readSaved<{ items: PublicRow[] }>(SAVED).then((saved) => {
      if (publicRows !== null || !saved?.items) return
      publicRows = saved.items
      rebuild()
    })
  }
  const gen = ++generation
  const run = fetchJson<{ items?: PublicRow[] }>("/api/library")
    .then((d) => {
      if (gen !== generation) return cache ?? []
      publicRows = d.items ?? []
      writeSaved(SAVED, { items: publicRows })
      settled = true
      loadedAt = Date.now()
      inflight = null
      retrySettled("community")
      rebuild()
      return cache ?? []
    })
    .catch(() => {
      // The saved copy, builtins and drafts still browse; the line in the
      // library says so, and lib/net keeps asking until the route recovers.
      if (gen === generation) {
        inflight = null
        retryLater("community", () => void load(true))
      }
      return cache ?? []
    })
  inflight = run
  return run
}

/**
 * Warm the cache before anything asks for it.
 *
 * The libraries used to fetch on OPEN, so the first one opened in a session
 * rendered from an empty cache: built-ins and drafts painted, then the
 * published rows arrived a round trip to Singapore later and the ranking
 * visibly re-sorted under the pointer. Your own rows are lib/mine-store's,
 * which follows the session.
 */
export function preloadCommunity(): void {
  void load()
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

/** Whether an author is a maker we vouch for, once the library has been fetched. */
export function authorVerified(name: string): boolean {
  return verifiedAuthors.get(name) === true
}

/** Refresh the rows when they are older than a minute; otherwise answer with
 *  what is there, or join the fetch already in the air. */
export function loadFresh(): Promise<CommunityItem[]> {
  return load(!inflight && Date.now() - loadedAt > 60_000)
}

/** The cached rows for a kind, without subscribing — for callbacks that must not
 *  re-create themselves every time the cache changes. */
export function communityItems(kind: LibraryKind): CommunityItem[] {
  return (cache ?? []).filter((i) => i.kind === kind)
}

// The writes below are always to YOUR items (only an owner can rename,
// re-scope, delete or publish), so they edit your rows and, for the public
// ones, everyone's copy too; the merge then carries them into the cache.

/** Reflect a rename the server accepted. */
export function renameCommunityItem(id: string, name: string) {
  publicRows = publicRows?.map((i) => (i.id === id ? { ...i, name } : i)) ?? null
  editMine((rows) => rows.map((i) => (i.id === id ? { ...i, name } : i)))
}

/** Reflect a visibility change the server accepted. */
export function setCommunityVisibility(id: string, visibility: "public" | "private") {
  publicRows = publicRows?.map((i) => (i.id === id ? { ...i, visibility } : i)) ?? null
  editMine((rows) => rows.map((i) => (i.id === id ? { ...i, visibility } : i)))
}

/** Drop a row the server just deleted, without waiting for a refetch. */
export function removeCommunityItem(id: string) {
  publicRows = publicRows?.filter((i) => i.id !== id) ?? null
  editMine((rows) => rows.filter((i) => i.id !== id))
}

/** Merge a JUST-published row so the library shows it before any refetch. */
export function addCommunityItem(item: LibraryItem) {
  editMine((rows) => [...rows.filter((i) => i.id !== item.id), { ...item, owner: "user", mine: true }])
}

/** @internal */
export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
