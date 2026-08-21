"use client"

// Where you left the timeline: zoom, scroll, and which channel was open.
//
// CHROME, not document state — the same distinction use-stored-rect draws. None
// of this changes the scene, nothing here is published or exported, and undo
// must never walk back through it. It is remembered for the same reason a
// panel's position is: reopening an editor that has forgotten where you were
// working makes you find your place again every time.
//
// The PLAYHEAD used to be in here too, and it is the one thing that could not
// be. Zoom and scroll change how the editor is drawn; the playhead moves the
// scene — every cast member, the music with them. Restoring it meant opening
// the fold teleported the scene to a frame from a previous session, which is
// "never mutate what the user is looking at" broken by the surface whose whole
// job is to show you what you are looking at. The scene's own position is the
// truth on open, and clip-bridge adopts it.
//
// Global rather than per-scene, which is what reze-studio does. A per-clip key
// would arguably be better — a zoom that suits a three-minute dance is wrong for
// a four-second loop — but it also means the editor opens at a stranger's zoom
// the first time you touch each clip, and the simple version is easier to be
// sure about. Worth revisiting once there is a reason to.

import { useCallback, useEffect, useRef, useState } from "react"
import { storageKey } from "@/lib/storage"

export type TimelineView = {
  /** Horizontal zoom, in pixels per frame. */
  pxPerFrame: number
  /** Vertical zoom of the curve band. */
  yZoom: number
  /** Horizontal scroll, in pixels. */
  scrollX: number
  /** Which channel the curve half was showing. */
  tab: string
}

const KEY = storageKey("timeline-view")

/** How long editing settles before the write. A zoom or a scrub is a burst of
 *  dozens of changes and localStorage is synchronous — writing per change puts
 *  a main-thread write in the middle of every drag. */
const SETTLE_MS = 400

function read(): TimelineView | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<TimelineView>
    // A hand-edited or half-written entry must not open the editor at NaN
    // frames per pixel, which renders nothing and looks like a broken canvas.
    const nums = [v.pxPerFrame, v.yZoom, v.scrollX]
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null
    if (typeof v.tab !== "string" || !v.tab) return null
    return v as TimelineView
  } catch {
    return null
  }
}

/**
 * Returns the view stored last session (read ONCE, at mount) and a setter that
 * persists after the edit settles.
 *
 * Read once on purpose. The timeline takes its restored zoom and scroll as
 * `initialView`, a lazy initialiser it reads at first mount and never again —
 * so a value that arrived later would be ignored anyway, and one that changed
 * underneath would fight the user's own scrolling.
 */
export function useTimelineView(): {
  restored: TimelineView | null
  save: (view: TimelineView) => void
} {
  const [restored] = useState(read)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<TimelineView | null>(null)

  const flush = useCallback(() => {
    const v = pending.current
    pending.current = null
    if (!v) return
    try {
      window.localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // A full or blocked store is not worth failing an edit over.
    }
  }, [])

  const save = useCallback(
    (view: TimelineView) => {
      pending.current = view
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SETTLE_MS)
    },
    [flush],
  )

  // A tab closed mid-settle would otherwise lose the last few hundred ms of
  // work — which, since the last thing you did is usually where you want to
  // resume, is exactly the part worth keeping.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", onHide)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      if (timer.current) clearTimeout(timer.current)
      flush()
    }
  }, [flush])

  return { restored, save }
}
