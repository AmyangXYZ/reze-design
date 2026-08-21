"use client"

// A VMD keyframe's easing, as the picture MMD itself draws.
//
// Ported from reze-studio, where it is the same 127×127 canvas. The space is
// the format's: a VMD stores four bytes per channel, each 0…127, and this is a
// direct view of them rather than a normalised curve that happens to round-trip.
// Editing in the file's own units is what keeps an exported curve identical to
// the one on screen.
//
// Canvas rather than SVG for one reason: the handles are dragged, and a drag
// that re-renders React sixty times to move two rectangles is the cost this
// avoids entirely — a pointer move paints straight to the context.

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { easeInOut } from "reze-engine"
import { cn } from "@/lib/utils"

// 144, not studio's 160. This dock is 16rem wide and the chart shares a row
// with eight preset chips; at 160 the chips were 58px of truncated words, and
// the block was the tallest thing in a panel whose subject is the sliders above
// it. The 127-space is unchanged — only how many device pixels it is drawn in.
const SIZE = 144
// The plot's inset, and it is sized by the LABELS rather than by taste. A
// control point at y=127 sits exactly on the top of the plot, and its readout
// is drawn above it — so anything less than the label's own height plus the
// handle's half-width puts "(52, 127)" through the top edge, which is where it
// was. 18 = 9px of type + 4 of handle + room to breathe.
const PAD = 18
const GX = PAD
const GY = PAD
const GW = SIZE - PAD * 2
const GH = SIZE - PAD * 2

/** Main spline stroke — readable on the dock's ground without competing with
 *  the axis hues the sliders above it use. */
const CURVE = "#22d3ee"
/** Dashed handles from endpoints to P1/P2 — brighter than the grid so tangents
 *  read clearly. */
const HANDLE_DASH = "rgba(255,255,255,0.42)"
const CP_RECT = 8
const CP_HALF = CP_RECT / 2
/** Generous next to the 8px square it hits: these are dragged, and a target the
 *  size of the thing drawn is a target you miss. */
const CP_HIT = 11

/** Control-point readout: type size, and how close it may come to the edge. */
const LABEL_PX = 9
const LABEL_EDGE = 3

export type CurvePoint = { x: number; y: number }

export const PRESETS: { label: string; p1: CurvePoint; p2: CurvePoint }[] = [
  { label: "Linear", p1: { x: 20, y: 20 }, p2: { x: 107, y: 107 } },
  { label: "In", p1: { x: 64, y: 0 }, p2: { x: 107, y: 107 } },
  { label: "Out", p1: { x: 20, y: 20 }, p2: { x: 64, y: 127 } },
  { label: "InOut", p1: { x: 64, y: 0 }, p2: { x: 64, y: 127 } },
  { label: "Slow In", p1: { x: 100, y: 0 }, p2: { x: 107, y: 107 } },
  { label: "Slow Out", p1: { x: 20, y: 20 }, p2: { x: 27, y: 127 } },
  { label: "Slow IO", p1: { x: 100, y: 0 }, p2: { x: 27, y: 127 } },
  { label: "Over", p1: { x: 0, y: 127 }, p2: { x: 127, y: 0 } },
]

function toCanvas(px: number, py: number) {
  return { x: GX + (px / 127) * GW, y: GY + GH - (py / 127) * GH }
}

function fromCanvas(cx: number, cy: number): CurvePoint {
  return {
    x: Math.round(Math.max(0, Math.min(127, ((cx - GX) / GW) * 127))),
    y: Math.round(Math.max(0, Math.min(127, ((GY + GH - cy) / GH) * 127))),
  }
}

function bezierPoint(
  t: number,
  p0x: number,
  p0y: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  p3x: number,
  p3y: number,
) {
  const u = 1 - t
  return {
    x: u * u * u * p0x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p3x,
    y: u * u * u * p0y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p3y,
  }
}

/** Animation duration for prop-driven curve transitions (ms). Short enough to
 *  feel snappy when crossing keyframe boundaries during playback, long enough
 *  to read as motion rather than a jump. */
const ANIM_MS = 220

type InterpolationCurveEditorProps = {
  p1: CurvePoint
  p2: CurvePoint
  disabled?: boolean
  onChange: (p1: CurvePoint, p2: CurvePoint) => void
}

export const InterpolationCurveEditor = memo(function InterpolationCurveEditor({
  p1,
  p2,
  disabled,
  onChange,
}: InterpolationCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef<"p1" | "p2" | null>(null)
  const [dpr, setDpr] = useState(1)

  // Last points actually painted. Drives the animation start state when props
  // change, and is updated every rAF tick during a transition so interrupting
  // transitions (e.g. rapid keyframe crossings) can smoothly retarget from the
  // current midpoint instead of the last committed target.
  const displayedRef = useRef<{ p1: CurvePoint; p2: CurvePoint }>({ p1, p2 })
  const animRef = useRef<number | null>(null)

  useEffect(() => {
    setDpr(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
  }, [])

  const drawWith = useCallback(
    (a: CurvePoint, b: CurvePoint) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, SIZE, SIZE)

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.15)"
      ctx.lineWidth = 0.5
      for (let i = 0; i <= 4; i++) {
        const x = GX + (i / 4) * GW
        const y = GY + (i / 4) * GH
        ctx.beginPath()
        ctx.moveTo(x, GY)
        ctx.lineTo(x, GY + GH)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(GX, y)
        ctx.lineTo(GX + GW, y)
        ctx.stroke()
      }

      // The straight line the curve is being bent away from.
      ctx.strokeStyle = "rgba(255,255,255,0.1)"
      ctx.lineWidth = 0.5
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(GX, GY + GH)
      ctx.lineTo(GX + GW, GY)
      ctx.stroke()
      ctx.setLineDash([])

      const s = toCanvas(0, 0)
      const e = toCanvas(127, 127)
      const c1 = toCanvas(a.x, a.y)
      const c2 = toCanvas(b.x, b.y)

      // Tangents
      ctx.strokeStyle = HANDLE_DASH
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(c1.x, c1.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(e.x, e.y)
      ctx.lineTo(c2.x, c2.y)
      ctx.stroke()
      ctx.setLineDash([])

      // Curve
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      for (let t = 0; t <= 1; t += 0.01) {
        const pt = bezierPoint(t, s.x, s.y, c1.x, c1.y, c2.x, c2.y, e.x, e.y)
        ctx.lineTo(pt.x, pt.y)
      }
      ctx.strokeStyle = CURVE
      ctx.lineWidth = 1.75
      ctx.stroke()

      // Endpoints — fixed at (0,0) and (127,127); drawn so the curve reads as
      // spanning a segment rather than floating.
      for (const pt of [s, e]) {
        ctx.fillStyle = "rgba(255,255,255,0.4)"
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }

      // Control points, labelled with the numbers the file stores.
      const pts: [CurvePoint, CurvePoint] = [a, b]
      ;[c1, c2].forEach((pt, i) => {
        const cpColor = i === 0 ? "#e25555" : "#44bb55"
        ctx.fillStyle = cpColor
        ctx.fillRect(pt.x - CP_HALF, pt.y - CP_HALF, CP_RECT, CP_RECT)
        ctx.strokeStyle = "rgba(255,255,255,0.45)"
        ctx.lineWidth = 1
        ctx.strokeRect(pt.x - CP_HALF, pt.y - CP_HALF, CP_RECT, CP_RECT)

        // Kept inside the canvas on both axes, because a handle can be dragged
        // into any corner of the 127-space and the readout is what tells you
        // where it landed. Padding alone cannot do it: it buys room above the
        // topmost point, but a point at x=0 still centres its label off the
        // left edge. So the label flips below the handle when there is no room
        // above, and its x is clamped to its own measured half-width.
        const label = `(${Math.round(pts[i].x)}, ${Math.round(pts[i].y)})`
        ctx.font = `${LABEL_PX}px -apple-system, sans-serif`
        ctx.textAlign = "center"
        ctx.textBaseline = "bottom"
        ctx.fillStyle = cpColor
        const halfW = ctx.measureText(label).width / 2
        const above = pt.y - CP_HALF - 2
        const y = above - LABEL_PX >= LABEL_EDGE ? above : pt.y + CP_HALF + 2 + LABEL_PX
        ctx.fillText(label, Math.max(halfW + LABEL_EDGE, Math.min(SIZE - halfW - LABEL_EDGE, pt.x)), y)
      })
    },
    [dpr],
  )

  // Keep the backing store sized to DPR. Redraw-on-DPR-change is handled by the
  // animation effect below — when DPR flips, `drawWith`'s identity changes and
  // that effect re-runs.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
  }, [dpr])

  // Smooth transition to new p1/p2 whenever the props change. During an active
  // drag, sync instantly — the pointer handlers paint directly, and tweening
  // would fight the pointer position. If a transition is already in flight,
  // restart from the currently-displayed midpoint so rapid playhead crossings
  // ease continuously instead of snapping.
  useEffect(() => {
    if (dragging.current) {
      displayedRef.current = { p1, p2 }
      drawWith(p1, p2)
      return
    }
    const start = { p1: { ...displayedRef.current.p1 }, p2: { ...displayedRef.current.p2 } }
    const same = start.p1.x === p1.x && start.p1.y === p1.y && start.p2.x === p2.x && start.p2.y === p2.y
    if (same) {
      drawWith(p1, p2)
      return
    }
    if (animRef.current != null) cancelAnimationFrame(animRef.current)
    const t0 = performance.now()
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / ANIM_MS)
      const k = easeInOut(u)
      const cur1 = { x: start.p1.x + (p1.x - start.p1.x) * k, y: start.p1.y + (p1.y - start.p1.y) * k }
      const cur2 = { x: start.p2.x + (p2.x - start.p2.x) * k, y: start.p2.y + (p2.y - start.p2.y) * k }
      displayedRef.current = { p1: cur1, p2: cur2 }
      drawWith(cur1, cur2)
      animRef.current = u < 1 ? requestAnimationFrame(step) : null
    }
    animRef.current = requestAnimationFrame(step)
    return () => {
      if (animRef.current != null) {
        cancelAnimationFrame(animRef.current)
        animRef.current = null
      }
    }
  }, [p1, p2, drawWith])

  const getMousePos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (SIZE / rect.width), y: (e.clientY - rect.top) * (SIZE / rect.height) }
  }

  const hitCp = (mx: number, my: number, cx: number, cy: number) =>
    Math.abs(mx - cx) <= CP_HIT && Math.abs(my - cy) <= CP_HIT

  /** P2 is painted after P1 — test P2 first so stacked handles prefer the top control. */
  const pickDragTarget = (m: { x: number; y: number }, a: CurvePoint, b: CurvePoint): "p1" | "p2" | null => {
    const c1 = toCanvas(a.x, a.y)
    const c2 = toCanvas(b.x, b.y)
    if (hitCp(m.x, m.y, c2.x, c2.y)) return "p2"
    if (hitCp(m.x, m.y, c1.x, c1.y)) return "p1"
    return null
  }

  const setCanvasCursor = (e: React.PointerEvent<HTMLCanvasElement> | null, draggingNow: boolean) => {
    const el = canvasRef.current
    if (!el || disabled) return
    if (draggingNow) {
      el.style.cursor = "grabbing"
      return
    }
    if (!e) {
      el.style.cursor = "default"
      return
    }
    el.style.cursor = pickDragTarget(getMousePos(e), p1, p2) ? "grab" : "default"
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const m = getMousePos(e)
    const t = pickDragTarget(m, p1, p2)
    if (!t) return
    e.preventDefault()
    dragging.current = t
    setCanvasCursor(e, true)
    e.currentTarget.setPointerCapture(e.pointerId)
    const pt = fromCanvas(m.x, m.y)
    if (t === "p1") {
      onChange(pt, p2)
      drawWith(pt, p2)
    } else {
      onChange(p1, pt)
      drawWith(p1, pt)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    if (dragging.current) {
      const pt = fromCanvas(...(Object.values(getMousePos(e)) as [number, number]))
      if (dragging.current === "p1") {
        onChange(pt, p2)
        drawWith(pt, p2)
      } else {
        onChange(p1, pt)
        drawWith(p1, pt)
      }
      setCanvasCursor(e, true)
      return
    }
    setCanvasCursor(e, false)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Capture can already be gone (pointercancel); nothing to release.
    }
    setCanvasCursor(e, false)
  }

  return (
    <div
      className={cn(
        "shrink-0 rounded-interior border border-line-strong bg-surface-raised p-0.5",
        disabled && "pointer-events-none opacity-50",
      )}
      style={{ width: SIZE + 4, height: SIZE + 4 }}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="block cursor-default rounded-chip"
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!dragging.current) setCanvasCursor(null, false)
        }}
        onLostPointerCapture={() => {
          dragging.current = null
          setCanvasCursor(null, false)
        }}
      />
    </div>
  )
})
