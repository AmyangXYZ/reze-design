"use client"

// Drops element focus when the window loses it (browser-tab switch, app switch).

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
