"use client"

// What the screen can do, asked of the browser rather than read off the user
// agent: an iPad reports itself as a Mac, and a phone rotating or a window
// resizing changes the answer without changing the agent.
//
// - phone: a device with no mouse or trackpad — a phone or a tablet. It plays;
//   nothing on it edits.
// - compact: a phone-width screen, for the pages that play there (the gallery,
//   the scene viewer). CSS twin: the `compact:` variant in app/globals.css, on
//   the same query.

import { useSyncExternalStore } from "react"

export const COMPACT_QUERY = "(width < 40rem)"

const subscribeCompact = (onChange: () => void) => {
  const mq = window.matchMedia(COMPACT_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

export const isCompact = () => window.matchMedia(COMPACT_QUERY).matches

/**
 * A PHONE (or a tablet): the editor gives it the scene and the transport, and
 * the gallery and viewer play without Fork; nothing on it edits.
 *
 * Asked of the HARDWARE, which an agent string cannot fake: no fine pointer at
 * all (no mouse, no trackpad — `any-pointer`, so an iPad with its keyboard and
 * trackpad on is a computer). The agent may add a phone (one that reports
 * itself so) but never removes one, so "request desktop site" changes nothing.
 */
export function isPhone(): boolean {
  if (!window.matchMedia("(any-pointer: fine)").matches) return true
  const d = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData
  const agent = !!d?.mobile || /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent)
  return agent && navigator.maxTouchPoints > 0
}
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia("(any-pointer: fine)")
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
export function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhone, () => false)
}

/** Server render answers false: the pages render on the client. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, isCompact, () => false)
}
