// The built-ins: the grades, shader graphs and effects the admin account has
// published, served by /api/library/builtins. They are rows like anyone's;
// what makes them the curated shelf is who owns them (lib/builtin-rows).
//
// React-free, like lib/community-store: the scene pipeline reads this (refs,
// auto-style, scene parsing), and those run outside components.
//
// The editor does not start until the whole shelf is here (hooks/use-builtins):
// auto-style, the look packs and the scene it opens on all name built-ins, and
// a first frame without them is a wrong frame. The saved copy (lib/saved) makes
// that wait an IndexedDB read on every visit after the first. A scene page gets
// only the rows its document names, from the server, and installs them as a
// part (`whole: false`), which never counts as the shelf.

import type { EffectItem, GradeItem, GraphItem, LibraryItem } from "@/lib/library"
import { fetchJson, retryLater, retrySettled } from "@/lib/net"
import { readSaved, writeSaved } from "@/lib/saved"

type Shelf = { graph: GraphItem[]; effect: EffectItem[]; grade: GradeItem[] }

const EMPTY: Shelf = { graph: [], effect: [], grade: [] }
let shelf: Shelf = EMPTY
let ids = new Set<string>()
let whole = false
let version = 0
const listeners = new Set<() => void>()

/** Put rows on the shelf. A whole shelf replaces what is there; a part is
 *  merged into it by id. */
export function installBuiltins(items: LibraryItem[], { whole: isWhole = true } = {}): void {
  const byId = new Map<string, LibraryItem>()
  if (!isWhole) for (const i of [...shelf.graph, ...shelf.effect, ...shelf.grade]) byId.set(i.id, i)
  for (const i of items) byId.set(i.id, { ...i, owner: "builtin" })
  const next: Shelf = { graph: [], effect: [], grade: [] }
  for (const i of byId.values()) if (i.kind !== "scene") (next[i.kind] as LibraryItem[]).push(i)
  shelf = next
  ids = new Set(byId.keys())
  whole ||= isWhole
  version++
  for (const l of listeners) l()
}

export const builtinGraphs = (): GraphItem[] => shelf.graph
export const builtinEffects = (): EffectItem[] => shelf.effect
export const builtinGrades = (): GradeItem[] => shelf.grade

export const isBuiltin = (id: string): boolean => ids.has(id)

/** Has the whole shelf arrived, as opposed to nothing or a scene page's part? */
export const builtinsWhole = (): boolean => whole

/** A number that changes whenever the shelf does, for memos and
 *  useSyncExternalStore. */
export const builtinsVersion = (): number => version

export function subscribeBuiltins(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const SAVED = "builtins.v1"
let loading: Promise<void> | null = null

/**
 * Fetch the whole shelf, once per tab. Resolves when one is installed: the
 * saved copy if it is read first, else the server's, which then replaces it.
 * A failed fetch is retried (lib/net) and the promise waits for it.
 */
export function loadBuiltins(): Promise<void> {
  loading ??= new Promise<void>((resolve) => {
    let fresh = false
    void readSaved<{ items: LibraryItem[] }>(SAVED).then((saved) => {
      if (fresh || !saved?.items?.length) return
      installBuiltins(saved.items)
      resolve()
    })
    const attempt = () =>
      fetchJson<{ items?: LibraryItem[] }>("/api/library/builtins")
        .then((d) => {
          fresh = true
          retrySettled("builtins")
          installBuiltins(d.items ?? [])
          writeSaved(SAVED, { items: d.items ?? [] })
          resolve()
        })
        .catch(() => void retryLater("builtins", attempt))
    void attempt()
  })
  return loading
}
