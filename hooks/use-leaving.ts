"use client"

// Whether something that has been closed is still on screen: it stays for one
// motion (233ms, --default-transition-duration) so it can fade out where it
// stands, the way the AI panel does, rather than vanish.

import { useEffect, useState } from "react"

export function useLeaving(open: boolean): { shown: boolean; leaving: boolean } {
  const [held, setHeld] = useState(open)
  if (open && !held) setHeld(true)
  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => setHeld(false), 233)
    return () => clearTimeout(timer)
  }, [open])
  const shown = open || held
  return { shown, leaving: shown && !open }
}
