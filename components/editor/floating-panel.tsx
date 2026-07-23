"use client"

// A free-floating window: drag it by any descendant marked [data-drag-handle], and
// resize from any edge or corner. Position/size are controlled ({rect} + onRectChange)
// so the parent can persist them. During a gesture we mutate the DOM directly (no
// re-render per frame, so React Flow inside stays smooth) and commit to state on
// release. `fullscreen` overrides the rect with a near-viewport inset and disables
// drag/resize. Everything is clamped to stay on-screen.

import { useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export type Rect = { x: number; y: number; w: number; h: number }
type Mode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

const PAD = 8 // keep this many px between the panel and the viewport edge

// Drop the backdrop-blur (which re-samples the whole background every frame) and hint
// the compositor while a gesture is live; restore both on release. This is what keeps
// dragging smooth — a moving backdrop-filter is the expensive part, not the transform.
function setPerf(el: HTMLElement, active: boolean) {
  if (active) {
    el.style.setProperty("backdrop-filter", "none")
    el.style.setProperty("-webkit-backdrop-filter", "none")
    el.style.willChange = "transform"
  } else {
    el.style.removeProperty("backdrop-filter")
    el.style.removeProperty("-webkit-backdrop-filter")
    el.style.willChange = ""
  }
}

export function FloatingPanel({
  rect,
  onRectChange,
  open,
  fullscreen,
  minW = 360,
  minH = 240,
  className,
  children,
}: {
  rect: Rect
  onRectChange: (r: Rect) => void
  open: boolean
  fullscreen: boolean
  minW?: number
  minH?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: Mode; sx: number; sy: number; start: Rect } | null>(null)
  const latest = useRef<Rect>(rect)

  const onMove = (e: PointerEvent) => {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (d.mode === "move") {
      // Move via a compositor-only transform (no layout, no per-frame backdrop
      // re-sample — see setPerf) — left/top stay at the start; committed on release.
      const x = Math.min(Math.max(PAD, d.start.x + dx), vw - d.start.w - PAD)
      const y = Math.min(Math.max(PAD, d.start.y + dy), vh - d.start.h - PAD)
      latest.current = { x, y, w: d.start.w, h: d.start.h }
      el.style.transform = `translate3d(${x - d.start.x}px, ${y - d.start.y}px, 0)`
    } else {
      let { x, y, w, h } = d.start
      if (d.mode.includes("e")) w = Math.min(Math.max(minW, d.start.w + dx), vw - x - PAD)
      if (d.mode.includes("s")) h = Math.min(Math.max(minH, d.start.h + dy), vh - y - PAD)
      if (d.mode.includes("w")) {
        const nw = Math.min(Math.max(minW, d.start.w - dx), d.start.x + d.start.w - PAD)
        x = d.start.x + d.start.w - nw
        w = nw
      }
      if (d.mode.includes("n")) {
        const nh = Math.min(Math.max(minH, d.start.h - dy), d.start.y + d.start.h - PAD)
        y = d.start.y + d.start.h - nh
        h = nh
      }
      latest.current = { x, y, w, h }
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
    }
  }
  const onUp = () => {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
    const el = ref.current
    const d = drag.current
    if (el && d) {
      if (d.mode === "move") {
        // Bake the transform into left/top synchronously so there's no flash when
        // state re-renders to the same values.
        el.style.transform = ""
        el.style.left = `${latest.current.x}px`
        el.style.top = `${latest.current.y}px`
      }
      setPerf(el, false)
    }
    if (d) onRectChange(latest.current)
    drag.current = null
  }
  const begin = (mode: Mode) => (e: React.PointerEvent) => {
    if (fullscreen) return
    e.preventDefault()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: { ...rect } }
    latest.current = { ...rect }
    if (ref.current) setPerf(ref.current, true)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }
  const onContainerDown = (e: React.PointerEvent) => {
    if (fullscreen) return
    const t = e.target as HTMLElement
    // Drag from anywhere inside a [data-drag-handle] region (e.g. the whole header),
    // but never when the press lands on an interactive control there (buttons still work).
    if (!t.closest("[data-drag-handle]")) return
    if (t.closest("button, a, input, textarea, select, [role='button'], [data-no-drag]")) return
    begin("move")(e)
  }

  const style = fullscreen
    ? { left: 12, top: 12, width: "calc(100vw - 24px)", height: "calc(100dvh - 24px)" }
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }

  // Edge/corner resize affordances (invisible hit strips). Corners sit above edges.
  const edge = "absolute touch-none"
  if (typeof document === "undefined") return null
  // Portal to <body> so the panel's z-index compares directly against other body-level
  // portals (the library) — inside the page root it'd be trapped in a lower stacking
  // context and sit below them regardless of z.
  return createPortal(
    <div ref={ref} className={cn("fixed", className)} style={style} onPointerDown={onContainerDown}>
      {children}
      {!fullscreen && (
        <>
          <div className={cn(edge, "inset-x-0 top-0 h-1.5 cursor-ns-resize")} onPointerDown={begin("n")} />
          <div className={cn(edge, "inset-x-0 bottom-0 h-1.5 cursor-ns-resize")} onPointerDown={begin("s")} />
          <div className={cn(edge, "inset-y-0 left-0 w-1.5 cursor-ew-resize")} onPointerDown={begin("w")} />
          <div className={cn(edge, "inset-y-0 right-0 w-1.5 cursor-ew-resize")} onPointerDown={begin("e")} />
          <div className={cn(edge, "top-0 left-0 size-3 cursor-nwse-resize")} onPointerDown={begin("nw")} />
          <div className={cn(edge, "top-0 right-0 size-3 cursor-nesw-resize")} onPointerDown={begin("ne")} />
          <div className={cn(edge, "bottom-0 left-0 size-3 cursor-nesw-resize")} onPointerDown={begin("sw")} />
          <div className={cn(edge, "bottom-0 right-0 size-3 cursor-nwse-resize")} onPointerDown={begin("se")} />
        </>
      )}
    </div>,
    document.body,
  )
}
