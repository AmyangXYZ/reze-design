"use client"

// What the screen can do, asked of the browser rather than read off the user
// agent: an iPad reports itself as a Mac, and a phone rotating or a window
// resizing changes the answer without changing the agent.
//
// - phone: a touch screen under 600px on its shorter side. The editor is the
//   computer's on a phone too, turned sideways (components/editor/
//   turn-sideways); the gallery and the scene viewer have phone layouts.
// - touch only: no mouse or trackpad at all, a phone or a tablet. Not a layout
//   question: what a touch-only device's GPU makes slow (hooks/use-cover-ink).
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

/** No mouse or trackpad at all: a phone, or a tablet without its trackpad. */
export function isTouchOnly(): boolean {
  return !window.matchMedia("(any-pointer: fine)").matches
}

/** The shorter side under which a screen is a phone's: Android's own tablet
 *  line (sw600dp). The smallest iPad, the mini, is 744. */
const PHONE_SIDE = 600

/**
 * A PHONE: the editor asks it to turn sideways, and the gallery and viewer
 * lay out for it and play without Fork.
 *
 * Asked of the HARDWARE. The SCREEN's size, not the window's, so a computer's
 * window drawn small stays a computer, and a phone turned on its side stays a
 * phone. Then touch: no fine pointer at all, or an agent that reports a phone
 * on a touch screen (a phone with a mouse paired is still a phone). The agent
 * may add a phone but never removes one, so "request desktop site" changes
 * nothing.
 */
export function isPhone(): boolean {
  if (Math.min(screen.width, screen.height) >= PHONE_SIDE) return false
  if (isTouchOnly()) return true
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
