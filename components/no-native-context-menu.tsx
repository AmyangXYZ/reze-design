"use client"

// Suppresses the browser's native context menu site-wide so a right-click never pops
// an ugly OS menu over the app — the editor provides its own custom menus. The native
// menu is kept on editable fields (input/textarea/contenteditable) so right-click
// cut/copy/paste there still works.

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
