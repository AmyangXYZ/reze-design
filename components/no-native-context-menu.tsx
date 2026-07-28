"use client"

// Suppresses the browser's native context menu site-wide so a right-click never pops an ugly

import { useEffect } from "react"

export function NoNativeContextMenu() {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return
      e.preventDefault()
    }
    document.addEventListener("contextmenu", onCtx)
    return () => document.removeEventListener("contextmenu", onCtx)
  }, [])
  return null
}
