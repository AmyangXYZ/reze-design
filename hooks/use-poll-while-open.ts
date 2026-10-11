"use client"

import { useEffect, useRef } from "react"

/** How often an open library or gallery checks for what others published. */
export const UPDATE_POLL_MS = 5 * 60_000

/**
 * Call `refresh` every `everyMs` while the component is mounted and the tab is
 * visible, and on coming back to a tab that missed its turn.
 *
 * For picking up other people's new work, not for recovering from a failure
 * (lib/net retryLater does that, in seconds). Slow on purpose, and only while
 * a library or the gallery is OPEN: a signed-in read of /api/library goes to
 * the database for your private rows, so a poll from every idle tab would keep
 * the free-plan database from ever scaling to zero. Opening a panel already
 * refreshes anything older than a minute; this keeps an open one current.
 */
export function usePollWhileOpen(refresh: () => void, everyMs = UPDATE_POLL_MS): void {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  useEffect(() => {
    let last = Date.now()
    const tick = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < everyMs) return
      last = Date.now()
      latest.current()
    }
    // Checked every 30s rather than set to everyMs, so a tab hidden through its
    // turn catches up when shown instead of waiting out a whole interval.
    const timer = setInterval(tick, 30_000)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [everyMs])
}
