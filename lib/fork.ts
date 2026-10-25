// Handing a scene from the viewer to the editor.
//
// sessionStorage rather than a query string: `/?from=5VvAQA6d` is noise in the
// address bar of a tool people keep open all day, and tab-scoped keeps a fork from
// leaking into another tab's work.
//
// Consumed ONCE, the moment the editor route resolves the fork. From then on the
// forked scene is the working scene and persistence owns it — left in place, the
// target re-forked on every refresh, overwriting whatever had been done since:
// uploads vanished, a reset sprang back to the fork, and the scene loaded twice.

const KEY = storageKey("fork")

/**
 * What the viewer hands over.
 *
 * `bundle` is the IndexedDB scene id the viewer parked its ALREADY UNZIPPED
 * assets under before navigating. The viewer necessarily holds them — it is
 * rendering them — so a fork that re-fetched and re-unzipped the same zip was
 * paying twice for bytes already in memory. Absent when the write failed or the
 * bundle had not finished loading, in which case the editor opens the scene the
 * ordinary way.
 */
import { storageKey } from "@/lib/storage"

export type ForkHandoff = {
  scene: string
  bundle?: string
  /**
   * The author opening their OWN scene to correct it, rather than anyone taking
   * a copy. The editor then keeps the scene's name instead of marking it a copy,
   * and publishing updates that scene in place — same URL, same counters —
   * instead of minting a second one beside it.
   */
  edit?: boolean
}

export function setForkTarget(sceneId: string, bundleId?: string, edit?: boolean): void {
  try {
    const handoff: ForkHandoff = {
      scene: sceneId,
      ...(bundleId ? { bundle: bundleId } : {}),
      ...(edit ? { edit: true } : {}),
    }
    window.sessionStorage.setItem(KEY, JSON.stringify(handoff))
  } catch {
    // Storage blocked: the fork simply doesn't carry, and the editor opens normally.
  }
}

/** Spend the target. On failure it is left alone so a refresh can retry the fork. */
export function clearForkTarget(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // a blocked store never carried the fork in the first place
  }
}

// WHERE A WORKING SCENE CAME FROM, kept past the handoff: a fork can be worked
// on for days before it is published, and the publish is what records it
// (lib/forks). Keyed by the working scene's id, in localStorage, newest last.
const SOURCES = storageKey("fork-sources")
const SOURCES_KEPT = 50

/** Remember that the working scene `sceneId` was forked from `source`. */
export function rememberForkSource(sceneId: string, source: string): void {
  try {
    const all = readSources().filter(([id]) => id !== sceneId)
    all.push([sceneId, source])
    window.localStorage.setItem(SOURCES, JSON.stringify(all.slice(-SOURCES_KEPT)))
  } catch {
    // Storage blocked: the publish simply carries no trail.
  }
}

/** The published scene the working scene `sceneId` was forked from, if any. */
export function forkSourceOf(sceneId: string): string | undefined {
  return readSources().find(([id]) => id === sceneId)?.[1]
}

function readSources(): [string, string][] {
  if (typeof window === "undefined") return []
  try {
    const all = JSON.parse(window.localStorage.getItem(SOURCES) ?? "[]") as unknown
    return Array.isArray(all) ? all.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string") : []
  } catch {
    return []
  }
}

export function forkTarget(): ForkHandoff | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    // A tab that loaded before this became a record stored the bare scene id.
    // Reading it as one costs a character test and saves that tab a failed fork.
    if (!raw.startsWith("{")) return { scene: raw }
    const parsed = JSON.parse(raw) as ForkHandoff
    return typeof parsed?.scene === "string" ? parsed : null
  } catch {
    return null
  }
}
