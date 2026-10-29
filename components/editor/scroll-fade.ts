"use client"

// Whether a scroll box has more below what it shows. A box with its scrollbar
// hidden and a row cut at its bottom edge looks broken rather than scrollable;
// fading that edge while there is more says "scroll" instead.

import { useEffect, useState } from "react"

/** Fades the bottom 1.5rem: add it to the box's className while `more`. */
export const SCROLL_FADE = "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
/** The same at the top, for a box with more above (a field that scrolled to
 *  its caret), and at both edges. */
export const SCROLL_FADE_TOP = "[mask-image:linear-gradient(to_top,black_calc(100%-1.5rem),transparent)]"
export const SCROLL_FADE_BOTH =
  "[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]"

/** The fade for a box with `less` above and `more` below. */
export function scrollFade(less: boolean, more: boolean) {
  return less && more ? SCROLL_FADE_BOTH : less ? SCROLL_FADE_TOP : more ? SCROLL_FADE : undefined
}

/** A callback ref for the box (it may mount and unmount, like the dock),
 *  whether there is more of it below, and whether there is more above. */
export function useScrollFade<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [more, setMore] = useState(false)
  const [less, setLess] = useState(false)
  useEffect(() => {
    if (!el) return
    const check = () => {
      setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
      setLess(el.scrollTop > 1)
    }
    check()
    el.addEventListener("scroll", check, { passive: true })
    // A field's text grows inside a box that no longer does.
    el.addEventListener("input", check)
    // The box and its rows both change size: rows open and close, the window
    // resizes.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener("scroll", check)
      el.removeEventListener("input", check)
      ro.disconnect()
    }
  }, [el])
  return [setEl, more, less] as const
}
