"use client"

// Drops element focus when the window loses it (browser-tab switch, app switch).
// Some browsers re-mark the previously focused element :focus-visible when the
// tab regains focus, resurrecting a focus ring on whatever button was last
// clicked — blurring on the way out means there is nothing to resurrect.

import { useEffect } from "react"

export function NoStickyFocus() {
  useEffect(() => {
    const onBlur = () => {
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body) el.blur()
    }
    window.addEventListener("blur", onBlur)
    return () => window.removeEventListener("blur", onBlur)
  }, [])
  return null
}
