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
export type DraftPayload = GradePayload | EffectPayload | GraphPayload

const KEY = "reze-design.drafts.1"
const EMPTY: Record<DraftKind, LibraryItem[]> = { grade: [], effect: [], graph: [] }

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

export function loadDrafts(): Record<DraftKind, LibraryItem[]> {
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Record<DraftKind, LibraryItem[]>>) } : EMPTY
  } catch {
    return EMPTY
  }
}

function save(store: Record<DraftKind, LibraryItem[]>) {
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

/** Prefixed so a draft id can never be mistaken for a built-in's hand-written id
 *  or a server-generated one. */
const draftId = () =>
  `local_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`

export function createDraft(
  kind: DraftKind,
  opts: { name: string; payload: DraftPayload; author: string; description?: string; tags?: string[] },
): LibraryItem {
  const store = loadDrafts()
  const item: LibraryItem = {
    id: draftId(),
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

export const isDraftId = (id: string) => id.startsWith("local_")
