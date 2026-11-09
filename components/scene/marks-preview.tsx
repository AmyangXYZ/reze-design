"use client"

// The export's watermark over the framed canvas, drawn by the export's own
// drawMark so the preview cannot disagree with the file. The mark is laid out
// on a frame of 1080 lines, the smallest export, and that layout is scaled
// onto a canvas backed at the frame's own device pixels: the proportions are
// the export's, and the type is as sharp as the screen.

import { useEffect, useRef, useState } from "react"
import { drawMark, loadMarkFont, markFont, type Mark } from "@/lib/watermark"

const LINES = 1080

export function MarksPreview({
  rect,
  mark,
}: {
  rect: { x: number; y: number; w: number; h: number }
  mark: Mark
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Read on mount and again when the screen or the zoom changes it.
  const [dpr, setDpr] = useState(1)
  useEffect(() => {
    let query: MediaQueryList | null = null
    const read = () => {
      setDpr(window.devicePixelRatio || 1)
      query?.removeEventListener("change", read)
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      query.addEventListener("change", read)
    }
    read()
    return () => query?.removeEventListener("change", read)
  }, [])

  const pxW = Math.max(1, Math.round(rect.w * dpr))
  const pxH = Math.max(1, Math.round(rect.h * dpr))
  // The layout frame: 1080 lines at the frame's aspect.
  const layoutW = (LINES * rect.w) / rect.h

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const font = markFont()
    let live = true
    const scale = pxH / LINES
    const draw = (time: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      drawMark(ctx, layoutW, LINES, font, mark, time)
    }
    let raf = 0
    // Drawn once the face is in: a placed mark once, a moving one every frame.
    void loadMarkFont(font, mark).then(() => {
      if (!live) return
      if (!mark.moving) return draw(0)
      const start = performance.now()
      const tick = (now: number) => {
        draw((now - start) / 1000)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })
    return () => {
      live = false
      cancelAnimationFrame(raf)
    }
  }, [pxW, pxH, layoutW, mark])

  return (
    <canvas
      ref={ref}
      width={pxW}
      height={pxH}
      className="pointer-events-none absolute"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  )
}
