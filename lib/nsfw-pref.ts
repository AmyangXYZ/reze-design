import { useSyncExternalStore } from "react"

// Whether this browser shows NSFW scenes' covers.
//
// Off until the viewer turns it on in the gallery. Off, a flagged scene is still
// listed — its cover blurs behind a label, one click reveals that one card, and
// its page asks before it loads. On, all of that steps aside.
//
// NOT under storageKey(), for export-consent's reason: that scheme versions the
// key per build, and a release would quietly flip every viewer back.
const KEY = "reze-design.show-nsfw"

let cached: boolean | null = null
const listeners = new Set<() => void>()

/** Anything that is not a stored yes reads as no — a private window, blocked
 *  storage, a malformed value. Off is the only safe direction to fail. */
export function showNsfw(): boolean {
  if (typeof window === "undefined") return false
  if (cached !== null) return cached
  try {
    cached = window.localStorage.getItem(KEY) === "1"
  } catch {
    cached = false
  }
  return cached
}

export function setShowNsfw(on: boolean): void {
  cached = on
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    // Storage blocked: the switch holds for this session only.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab flipping the switch.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cached = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useShowNsfw(): boolean {
  return useSyncExternalStore(subscribe, showNsfw, () => false)
}
