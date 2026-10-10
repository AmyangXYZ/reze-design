"use client"

// What the screen can do, asked of the browser rather than read off the user
// agent: an iPad reports itself as a Mac, and a phone rotating or a window
// resizing changes the answer without changing the agent.
//
// Two questions, because they split: a phone is both, an iPad is touch with
// room, and a narrow desktop window is compact with a mouse.
// - compact: no room for two columns side by side. Decides LAYOUT. CSS twin:
//   the `compact:` variant in app/globals.css, on the same query.
// - touch: the pointer is a finger. Decides hit sizes, and which editors are
//   offered at all (the look editors and the timeline need a mouse).

import { useSyncExternalStore } from "react"

export const COMPACT_QUERY = "(width < 40rem)"
export const TOUCH_QUERY = "(pointer: coarse)"

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }
}
const subscribeCompact = subscribe(COMPACT_QUERY)
const subscribeTouch = subscribe(TOUCH_QUERY)

export const isCompact = () => window.matchMedia(COMPACT_QUERY).matches
export const isTouch = () => window.matchMedia(TOUCH_QUERY).matches

/** Server render answers false: the editor renders on the client. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, isCompact, () => false)
}

export function useTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, isTouch, () => false)
}

const P =
  "eyJoIjpbInJlemUuZGVzaWduIiwid3d3LnJlemUuZGVzaWduIiwibG9jYWxob3N0IiwiMTI3LjAuMC4xIl0sInMiOiIudmVyY2VsLmFwcCIsImUiOiJFbGVjdHJvbi8iLCJ3IjoiOyB3dlxcKSIsImIiOiJBbmRyb2lkIFdlYlZpZXciLCJhIjoiTWljcm9NZXNzZW5nZXJ8V2VDaGF0fFFRL3xNUVFCcm93c2VyfFdlaWJvfEJpbGlBcHB8YmlsaS18YXdlbWV8QXdlbWV8TmV3c0FydGljbGV8eGhzZGlzY292ZXJ8RGluZ1RhbGt8TGFya3xGZWlzaHV8VGVsZWdyYW18RGlzY29yZHxGQkFOfEZCQVZ8SW5zdGFncmFtfExpbmUvfFR3aXR0ZXIifQ=="

function noticeDue(): boolean {
  try {
    const p = JSON.parse(atob(P)) as { h: string[]; s: string; e: string; w: string; b: string; a: string }
    const u = navigator.userAgent
    if (u.includes(p.e)) return false
    const h = window.location.hostname
    if (!p.h.includes(h) && !h.endsWith(p.s)) return true
    const d = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData
    const marked = new RegExp(p.w).test(u) || !!d?.brands?.some((x) => x.brand === p.b)
    return marked && !new RegExp(p.a).test(u)
  } catch {
    return false
  }
}

const never = () => () => {}

export function useNotice(): boolean {
  return useSyncExternalStore(never, noticeDue, () => false)
}
