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

/**
 * A phone or tablet by its agent — the one question asked of it, for defaults
 * on a first visit, where a wrong guess costs one tap. An iPad that calls
 * itself a Mac gives itself away by its touch points.
 */
export function isMobileAgent(): boolean {
  const d = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData
  if (d?.mobile) return true
  const u = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1)
}

/**
 * A PHONE: the editor gives it the scene and the transport, and the gallery
 * and viewer play without Fork; nothing on it edits.
 *
 * Asked of the HARDWARE, which an agent string cannot fake: no fine pointer at
 * all (no mouse, no trackpad — `any-pointer`, so an iPad with its keyboard and
 * trackpad on is a computer), a finger for the pointer, and a small screen; or
 * on a larger touch screen, held upright or turned into a strip wider than 2:1.
 * The agent may add a phone (one that reports itself so) but never removes one,
 * so "request desktop site" changes nothing.
 */
export function isPhone(): boolean {
  const mm = (q: string) => window.matchMedia(q).matches
  const d = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData
  const agent = !!d?.mobile || /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent)
  if (mm("(any-pointer: fine)")) return agent && navigator.maxTouchPoints > 0
  if (!mm("(pointer: coarse) and (hover: none)")) return agent
  const ratio = window.innerWidth / Math.max(1, window.innerHeight)
  const short = Math.min(window.screen.width, window.screen.height)
  return agent || short < 600 || ratio < 1 || ratio > 2
}
function subscribePhone(onChange: () => void) {
  const queries = ["(pointer: coarse) and (hover: none)", "(any-pointer: fine)"].map((q) => window.matchMedia(q))
  window.addEventListener("resize", onChange)
  for (const mq of queries) mq.addEventListener("change", onChange)
  return () => {
    window.removeEventListener("resize", onChange)
    for (const mq of queries) mq.removeEventListener("change", onChange)
  }
}
export function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhone, () => false)
}

/** Server render answers false: the editor renders on the client. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, isCompact, () => false)
}

export function useTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, isTouch, () => false)
}
