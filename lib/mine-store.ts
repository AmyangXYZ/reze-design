// What the library shows only you: your own published presets (private ones
// among them) and what you liked, from /api/library/mine.
//
// React-free, like lib/community-store, which merges these rows into the
// public ones. Loaded when a session appears and after you change something,
// never on a timer: it is the one library read that reaches the database
// every time. Saved per account (lib/saved), so a signed-in cold start on a
// bad connection still shows your private items and your hearts.

import type { LibraryItem } from "@/lib/library"
import { fetchJson, retryLater, retrySettled } from "@/lib/net"
import { clearSaved, readSaved, writeSaved } from "@/lib/saved"

export type MineRow = LibraryItem & { mine: true; authorImage?: string | null; authorVerified?: boolean }
type Mine = { items: MineRow[]; liked: string[] }
type SavedMine = Mine & { userId: string }

const SAVED = "mine.v1"

/** Whose rows these are; null signed out. */
let userId: string | null = null
let rows: MineRow[] = []
let liked = new Set<string>()
let generation = 0
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}

export const mineRows = () => rows
export const likedIds = () => liked
export const mineUser = () => userId

export function subscribeMine(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/**
 * Follow the session: load this account's rows, or clear them on sign-out.
 * Safe to call on every render that knows the user; it acts only when the
 * account changes, or when `force` asks for a fresh copy (after a publish).
 */
export function syncMine(nextUser: string | null, force = false): void {
  if (nextUser === userId && !force) return
  const gen = ++generation
  // Set when the network answers, so a saved copy read after it is ignored.
  let landed = false
  if (nextUser !== userId) {
    retrySettled("mine")
    userId = nextUser
    rows = []
    liked = new Set()
    notify()
    if (!nextUser) clearSaved(SAVED)
    else
      void readSaved<SavedMine>(SAVED).then((saved) => {
        if (gen !== generation || landed || saved?.userId !== nextUser) return
        rows = saved.items
        liked = new Set(saved.liked)
        notify()
      })
  }
  if (!nextUser) return
  fetchJson<Mine>("/api/library/mine")
    .then((d) => {
      if (gen !== generation) return
      landed = true
      rows = d.items
      liked = new Set(d.liked)
      writeSaved(SAVED, { userId: nextUser, items: d.items, liked: d.liked } satisfies SavedMine)
      retrySettled("mine")
      notify()
    })
    .catch(() => {
      if (gen !== generation) return
      retryLater("mine", () => syncMine(userId, true))
    })
}

/** Change your rows to match a write the server just accepted (a publish, a
 *  rename, a visibility change, a delete), without waiting for a refetch. */
export function editMine(edit: (rows: MineRow[]) => MineRow[]): void {
  rows = edit(rows)
  if (userId) writeSaved(SAVED, { userId, items: rows, liked: [...liked] } satisfies SavedMine)
  notify()
}

/** Reflect a like the server just confirmed. */
export function noteLike(id: string, on: boolean): void {
  if (on === liked.has(id)) return
  liked = new Set(liked)
  if (on) liked.add(id)
  else liked.delete(id)
  if (userId) writeSaved(SAVED, { userId, items: rows, liked: [...liked] } satisfies SavedMine)
  notify()
}
