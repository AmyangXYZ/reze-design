"use client"

// The export's watermark over the framed canvas, drawn by the export's own
// drawMark so the preview cannot disagree with the file. The canvas works at
// 1080 lines, the smallest export, and is scaled to the frame: the mark is
// sized from the height, so every export size reads the same as this.

import { useEffect, useRef } from "react"
import { drawMark, markFont, type Mark } from "@/lib/watermark"

const LINES = 1080

export function MarksPreview({
  rect,
  mark,
}: {
  rect: { x: number; y: number; w: number; h: number }
  mark: Mark
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = Math.max(1, Math.round((LINES * rect.w) / rect.h))

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const font = markFont()
    const draw = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawMark(ctx, canvas.width, canvas.height, font, mark, time)
    }
    // A moving mark is drawn every frame; a placed one once.
    if (!mark.moving) {
      draw(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      draw((now - start) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [w, mark])

  return (
    <canvas
      ref={ref}
      width={w}
      height={LINES}
      className="pointer-events-none absolute"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  )
}
