"use client"

// Desktop-style window stacking for the floating panels and libraries.

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react"

// Above the docks (which the libraries already cleared at z-40), below the z-50 overlay layer
const BASE = 40
const MAX_STACK = 9

let order: string[] = []
const listeners = new Set<() => void>()
// Escape closes the TOPMOST surface, one per press — so a stack of editors and
// libraries unwinds in the order the user sees, instead of every open surface
// reacting to the same key.
const closers = new Map<string, () => void>()
let escInstalled = false

function installEscape() {
  if (escInstalled || typeof window === "undefined") return
  escInstalled = true
  window.addEventListener("keydown", (e) => {
    // No defaultPrevented guard: the library dialogs preventDefault in their own
    // onEscapeKeyDown to stop Radix closing them out of stacking order, and Radix
    // runs first — checking it here would swallow every Escape.
    if (e.key !== "Escape") return
    // Anything that genuinely owns Escape (node rename, the add-node search, a
    // context menu) calls stopPropagation, so it never reaches this listener.
    // Text fields are NOT blanket-exempt: a library's search box and the shader
    // editor's textarea should still close their surface.
    // A transient popper is dismissed by Radix on the same key; closing a panel
    // underneath it as well would consume two surfaces for one press.
    if (document.querySelector('[data-slot="popover-content"],[role="menu"]')) return
    for (let i = order.length - 1; i >= 0; i--) {
      const close = closers.get(order[i])
      if (close) {
        e.preventDefault()
        close()
        return
      }
    }
  })
}

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

/** z for this surface, plus the handler that raises it. `onEscape` opts the
 *  surface into Escape-closes-topmost. */
export function useZOrder(raiseKey?: unknown, onEscape?: () => void): { z: number; onPointerDownCapture: () => void } {
  const id = useId()
  useEffect(() => {
    bringToFront(id)
  }, [id, raiseKey])
  useEffect(() => () => release(id), [id])

  // Ref-free: the map is rewritten each render so the listener never holds a stale
  // closure, and cleanup drops the entry when the surface unmounts.
  const escRef = useRef(onEscape)
  useEffect(() => {
    escRef.current = onEscape
  })
  useEffect(() => {
    if (!onEscape) return
    installEscape()
    closers.set(id, () => escRef.current?.())
    return () => {
      closers.delete(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !onEscape])

  const index = useSyncExternalStore(
    subscribe,
    () => order.indexOf(id),
    () => -1, // SSR: unstacked; the mount effect assigns a real position
  )
  const onPointerDownCapture = useCallback(() => bringToFront(id), [id])
  return { z: BASE + Math.min(Math.max(index, 0), MAX_STACK - 1), onPointerDownCapture }
}
