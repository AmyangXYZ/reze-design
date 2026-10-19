"use client"

// Hide every control but the scene — the editor's and the viewer's, one switch.
//
// The page puts `data-ui-hidden` on its root and `data-keep` on what stays (the
// canvas, the backdrop under it, the way back); app/globals.css hides every
// other child. Visibility, not unmounting: nothing re-measures or loses state,
// and a hidden control takes no clicks.
//
// Never remembered. A page that opens with no controls on it reads as broken.

import { useEffect, useRef, useState } from "react"
import { Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** H toggles, Escape brings the UI back. Not while typing or inside a menu or
 *  dialog, where H is a letter. */
export function useHideUi() {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest?.("input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]")) return
      if (e.key === "h" || e.key === "H") setHidden((h) => !h)
      else if (e.key === "Escape") setHidden(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return [hidden, setHidden] as const
}

/** The strip at the very top that calls the way back — the edge itself, as a
 *  hidden taskbar's is, so moving about the scene never trips it. */
const EDGE_PX = 4
/** Either side of the pill, so its spot is not a target only a pixel wide at
 *  the ends. */
const SPOT_PAD_PX = 16
/** A finger is blunter than a pointer: the spot is wider for a tap. */
const TOUCH_PAD_PX = 32
/** How long it lingers after the mouse leaves it: none, since the spot runs
 *  from the edge down to the pill and there is no gap to cross. A tap has no
 *  leaving, so it gets a moment. */
const LINGER_MS = 0
const TAP_MS = 1500

/**
 * The way back, at the top, behaving like Windows' auto-hidden taskbar: the
 * mouse pushed against the top edge, or over the pill's own spot, brings it
 * up; it stays while the mouse is there and fades once the mouse has left. A
 * finger has no hover, so a tap on that spot shows it for a moment (a tap, not
 * a drag: dragging orbits the camera).
 * Mount it only while the UI is hidden, so it always starts asleep.
 */
export function ShowUiButton({ onShow }: { onShow: () => void }) {
  const t = useT()
  const [awake, setAwake] = useState(false)
  const pillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let timer = 0
    let down: { x: number; y: number } | null = null
    // The pill's own spot, from the top edge down to its bottom, read from its
    // box rather than the event target: asleep it is click-through, so the
    // pointer is never "on" it.
    const overSpot = (e: PointerEvent, pad: number) => {
      const r = pillRef.current?.getBoundingClientRect()
      return !!r && e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY <= r.bottom + pad
    }
    const sleepIn = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setAwake(false), ms)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return
      if (e.clientY <= EDGE_PX || overSpot(e, SPOT_PAD_PX)) {
        window.clearTimeout(timer)
        setAwake(true)
      } else sleepIn(LINGER_MS)
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: PointerEvent) => {
      // A tap on the spot, not anywhere: a tap elsewhere is someone watching,
      // or about to orbit, and the pill popping up for each was noise.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && overSpot(e, TOUCH_PAD_PX)) {
        setAwake(true)
        sleepIn(TAP_MS)
      }
      down = null
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerdown", onDown)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("pointerup", onUp)
    }
  }, [])
  return (
    <div data-keep className="pointer-events-none absolute inset-x-3 top-3 flex justify-center">
      <Button
        ref={pillRef}
        variant="ghost"
        onClick={onShow}
        className={cn(
          "h-10 gap-2 rounded-full border border-line-strong bg-surface px-4 text-xs text-foreground shadow-float backdrop-blur-xs transition-opacity duration-150",
          awake ? "pointer-events-auto opacity-100" : "opacity-0",
        )}
      >
        <Maximize2 className="size-4" />
        {t.transport.showUi}
      </Button>
    </div>
  )
}
