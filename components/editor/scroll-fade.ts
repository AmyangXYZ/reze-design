"use client"

// Whether a scroll box has more below what it shows. A box with its scrollbar
// hidden and a row cut at its bottom edge looks broken rather than scrollable;
// fading that edge while there is more says "scroll" instead.

import { useEffect, useState } from "react"

/** Fades the bottom 1.5rem: add it to the box's className while `more`. */
export const SCROLL_FADE = "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"

/** A callback ref for the box (it may mount and unmount, like the dock), and
 *  whether there is more of it below. */
export function useScrollFade<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!el) return
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    check()
    el.addEventListener("scroll", check, { passive: true })
    // The box and its rows both change size: rows open and close, the window
    // resizes.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
    }
  }, [el])
  return [setEl, more] as const
}
