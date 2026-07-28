"use client"

// Desktop-style window stacking for the floating panels and libraries.

import { useCallback, useEffect, useId, useSyncExternalStore } from "react"

// Above the docks (which the libraries already cleared at z-40), below the z-50 overlay layer
const BASE = 40
const MAX_STACK = 9

let order: string[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Raise a surface above every other. */
export function bringToFront(id: string) {
  if (order[order.length - 1] === id) return
  order = [...order.filter((x) => x !== id), id]
  emit()
}

function release(id: string) {
  if (!order.includes(id)) return
  order = order.filter((x) => x !== id)
  emit()
}

/** z for this surface, plus the handler that raises it. */
export function useZOrder(raiseKey?: unknown): { z: number; onPointerDownCapture: () => void } {
  const id = useId()
  useEffect(() => {
    bringToFront(id)
  }, [id, raiseKey])
  useEffect(() => () => release(id), [id])

  const index = useSyncExternalStore(
    subscribe,
    () => order.indexOf(id),
    () => -1, // SSR: unstacked; the mount effect assigns a real position
  )
  const onPointerDownCapture = useCallback(() => bringToFront(id), [id])
  return { z: BASE + Math.min(Math.max(index, 0), MAX_STACK - 1), onPointerDownCapture }
}
