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

export type ForkHandoff = { scene: string; bundle?: string }

export function setForkTarget(sceneId: string, bundleId?: string): void {
  try {
    const handoff: ForkHandoff = bundleId ? { scene: sceneId, bundle: bundleId } : { scene: sceneId }
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
