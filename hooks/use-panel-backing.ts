"use client"

// The docks' backing: a black overlay behind the cover's columns, as deep as
// the person asks (0 = the frameless cover). A viewing preference, kept in this
// browser; the scene never carries it.

import { useSyncExternalStore } from "react"
import { storageKey } from "@/lib/storage"

const KEY = storageKey("panel-backing")
/** The deepest it goes, in percent. */
export const BACKING_MAX = 80

const listeners = new Set<() => void>()
// Held here too, so the slider still works where storage is refused.
let current: number | null = null

function read(): number {
  if (current !== null) return current
  try {
    const n = Number(localStorage.getItem(KEY))
    current = Number.isFinite(n) ? Math.min(BACKING_MAX, Math.max(0, n)) : 0
  } catch {
    current = 0
  }
  return current
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function usePanelBacking(): [number, (percent: number) => void] {
  const value = useSyncExternalStore(subscribe, read, () => 0)
  const set = (percent: number) => {
    current = percent
    try {
      localStorage.setItem(KEY, String(percent))
    } catch {}
    for (const l of listeners) l()
  }
  return [value, set]
}
