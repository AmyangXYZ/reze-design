"use client"

// The right column holds ONE panel at a time.
//
// Three surfaces want it — the materials inspector, the export panel, and the
// timeline's properties — and all three are pinned to the same 16rem column at
// the same insets. Nothing stacked them deliberately: they simply landed on top
// of one another, so opening a second hid the first behind it and the only thing
// deciding which you saw was a z-order meant for floating windows.
//
// PAIRWISE CLEARING IS WHAT THIS REPLACES. openExport dropped the inspector and
// openMaterials hid export: one rule written twice, and already the wrong shape
// at three panels. The timeline's properties are summoned by a SELECTION rather
// than by a command, so there is no open function to hang a third clear off, and
// the two that exist would each need a fourth line the day a fifth panel lands.
//
// So the column is the thing that knows. Whoever opens claims it, and the
// previous occupant is told to close in its OWN words — the inspector drops its
// model, export hides itself, the properties panel lets go of the bone. How a
// panel closes stays the panel's business; being alone in the column is the
// column's.

import { useEffect, useRef } from "react"

let occupant: { id: string; close: () => void } | null = null

/**
 * Claim the right column while `open`, evicting whoever held it.
 *
 * `close` is read through a ref, so a caller may pass a fresh closure every
 * render without re-firing the claim: the effect depends on the OPEN EDGE
 * alone, which is the only moment a claim can happen. A panel that re-runs it
 * while already holding the column would otherwise evict itself.
 */
export function useDockSlot(id: string, open: boolean, close: () => void): void {
  const closeRef = useRef(close)
  // Written in an effect rather than during render: a ref assigned mid-render is
  // exactly what the compiler's rule forbids, and this file has no reason to be
  // the exception. Declared FIRST, so the claim below always reads a current one.
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!open) return
    const previous = occupant
    occupant = { id, close: () => closeRef.current() }
    if (previous && previous.id !== id) previous.close()
    return () => {
      // Only if the column is still ours. An evicted panel's cleanup runs AFTER
      // the evictor has claimed — clearing it there would leave the next claim
      // with nobody to close, and two panels in one column again.
      if (occupant?.id === id) occupant = null
    }
  }, [id, open])
}
