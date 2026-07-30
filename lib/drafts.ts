// Local drafts: content you've made or forked but not published.
//
// Why they belong in the library at all: creation STARTS there ("New effect",
// "New grade"), so a library that then disowns the result is the confusing part.
// Drafts appear alongside built-ins, badged `local`, and publishing promotes one
// into a real row that everybody can see.
//
// Local, not server-side — they're unpublished by definition, and a draft shelf
// that needed an account would put a sign-in wall in front of experimenting.

import type { EffectPayload, GradePayload, GraphPayload, LibraryItem } from "@/lib/library"

export type DraftKind = "grade" | "effect" | "graph"

/**
 * A local draft: a library item that hasn't been published yet.
 *
 * `sourceId` — a working copy of something YOU published; publishing writes that
 * item's next version. `forkedFromId` — derived from someone ELSE's published
 * item; publishing creates your own item and records where it came from. Exactly
 * one of them is ever set.
 */
export type Draft = LibraryItem & { sourceId?: string; forkedFromId?: string }
export type DraftPayload = GradePayload | EffectPayload | GraphPayload

const KEY = "reze-design.drafts.1"
const EMPTY: Record<DraftKind, Draft[]> = { grade: [], effect: [], graph: [] }

// Every mutation bumps a version and notifies subscribers, so two components
// holding drafts (a library dialog, the page's quick-pick) can never disagree.
let version = 0
const listeners = new Set<() => void>()
export const draftsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getVersion: () => version,
}

export function loadDrafts(): Record<DraftKind, Draft[]> {
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Record<DraftKind, Draft[]>>) } : EMPTY
  } catch {
    return EMPTY
  }
}

function save(store: Record<DraftKind, Draft[]>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked: the draft still lives in the open editor.
  }
  version++
  for (const l of listeners) l()
}

/** `Untitled Effect`, then `Untitled Effect 2`, `3`… — the same convention style
 *  groups already use, so the app names things one way. */
export function nextDraftName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  let name = base
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`
  return name
}

/** A plain uuid, like every other item: a draft that gets published keeps the same
 *  identity rather than being copied to a new one. Where it lives is `owner`, not
 *  a prefix on the id. */
const draftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`

export function createDraft(
  kind: DraftKind,
  opts: {
    name: string
    payload: DraftPayload
    author: string
    description?: string
    tags?: string[]
    /** The PUBLISHED item this draft is a working copy of, when you own it.
     *  Publishing then writes that item's next version instead of a new item. */
    sourceId?: string
    /** Someone else's published item this was derived from — lineage, not identity. */
    forkedFromId?: string
  },
): Draft {
  const store = loadDrafts()
  const item: Draft = {
    id: draftId(),
    ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
    ...(opts.forkedFromId ? { forkedFromId: opts.forkedFromId } : {}),
    kind,
    name: nextDraftName(
      opts.name,
      store[kind].map((d) => d.name),
    ),
    author: opts.author,
    description: opts.description ?? "",
    tags: opts.tags ?? [],
    version: 1,
    owner: "local",
    payload: opts.payload,
  }
  save({ ...store, [kind]: [...store[kind], item] })
  return item
}

/** Edits to an existing draft, by id. Silently ignores unknown ids so a stale
 *  editor can't resurrect a deleted draft. */
export function updateDraft(kind: DraftKind, id: string, patch: Partial<LibraryItem>): void {
  const store = loadDrafts()
  save({ ...store, [kind]: store[kind].map((d) => (d.id === id ? { ...d, ...patch } : d)) })
}

export function removeDraft(kind: DraftKind, id: string): void {
  const store = loadDrafts()
  save({ ...store, [kind]: store[kind].filter((d) => d.id !== id) })
}

/** Is this id a local draft? Asked of the store rather than read off the id —
 *  identity is a plain uuid now, and only the store knows where a thing lives. */
export function isDraft(kind: DraftKind, id: string): boolean {
  return loadDrafts()[kind].some((d) => d.id === id)
}

/** How a draft relates to published content, if at all. */
export function draftOrigin(kind: DraftKind, id: string): { sourceId?: string; forkedFromId?: string } {
  const d = loadDrafts()[kind].find((x) => x.id === id)
  return { sourceId: d?.sourceId, forkedFromId: d?.forkedFromId }
}
