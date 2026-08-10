"use client"

// A floating panel's position and size, remembered across sessions.
//
// The graph editor, the grade editor and the WGSL editor each carried their own
// copy of this: a Rect, a localStorage key, a write-through setter with its own
// try/catch, and a resize clamp so a shrinking window never strands a panel
// off-edge. Only the graph editor actually had the clamp, so the other two could
// be lost off-screen — which is the kind of bug three near-identical
// implementations produce.
//
// This is CHROME, not document state: where a panel sits is a property of a
// layout, and a layout that has no draggable windows simply never calls this.

import { useCallback, useEffect, useState } from "react"

export type Rect = { x: number; y: number; w: number; h: number }

/** Keep this many px between a panel and the viewport edge. */
const PAD = 8

function read(key: string): Rect | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<Rect>
    // A hand-edited or half-written entry must not place a panel at NaN.
    return [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))
      ? (r as Rect)
      : null
  } catch {
    return null
  }
}

/** Pull a rect back inside the viewport without resizing it more than it must. */
function clamp(r: Rect): Rect {
  const w = Math.min(r.w, window.innerWidth - 2 * PAD)
  const h = Math.min(r.h, window.innerHeight - 2 * PAD)
  return {
    w,
    h,
    x: Math.min(Math.max(PAD, r.x), Math.max(PAD, window.innerWidth - w - PAD)),
    y: Math.min(Math.max(PAD, r.y), Math.max(PAD, window.innerHeight - h - PAD)),
  }
}

export function useStoredRect(
  key: string,
  /** Where the panel goes the first time it is opened. */
  fallback: () => Rect,
  /** Eager panels compute their rect during the first render; lazy ones stay null
   *  until opened, so nothing is read from storage for a panel never used. */
  { eager = false }: { eager?: boolean } = {},
) {
  const [rect, setRect] = useState<Rect | null>(() =>
    eager && typeof window !== "undefined" ? (read(key) ?? fallback()) : null,
  )

  const update = useCallback(
    (r: Rect) => {
      setRect(r)
      try {
        window.localStorage.setItem(key, JSON.stringify(r))
      } catch {
        // Storage full or blocked — the panel still moves, it just won't be
        // remembered. Not worth interrupting the user over.
      }
    },
    [key],
  )

  /** Give the panel a rect if it has none — its stored one, else the fallback. */
  const ensure = useCallback(() => {
    setRect((r) => r ?? read(key) ?? fallback())
  }, [key, fallback])

  // Never strand a panel off-edge when the window shrinks. All three editors
  // wanted this; only one had it.
  useEffect(() => {
    const onResize = () => setRect((r) => (r ? clamp(r) : r))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return { rect, update, ensure }
}
