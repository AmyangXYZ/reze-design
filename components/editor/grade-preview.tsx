"use client"

// LIVE grade thumbnails.

import { memo, useEffect, useRef } from "react"
import { resolveSpec, type GradeSpec } from "@/lib/grade"
import { cn } from "@/lib/utils"

// Sized for the EDITOR's preview (the largest consumer, ~360px wide on a default panel)
const W = 448
const H = 280

let captured: ImageData | null = null

/** Grab the current scene into the module-level frame. */
export function captureScene(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  try {
    const c = document.createElement("canvas")
    c.width = W
    c.height = H
    const ctx = c.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(canvas, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H)
    // An all-but-transparent read means the drawing buffer was already gone
    let opaque = 0
    for (let i = 3; i < data.data.length; i += 4 * 37) if (data.data[i] > 8) opaque++
    if (opaque > 8) captured = data
  } catch {
    // cross-origin or context loss — fallback stands
  }
}

/** Tones a grade actually acts on, as a gradient field */
function syntheticFrame(): ImageData {
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const ctx = c.getContext("2d")!
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, "#2b2b38")
  g.addColorStop(0.35, "#9e99bd")
  g.addColorStop(0.6, "#f2ccb8")
  g.addColorStop(1, "#e8e8ee")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = "#f2ccb8"
  ctx.beginPath()
  ctx.ellipse(W * 0.5, H * 0.62, W * 0.2, H * 0.3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = "#1a1a24"
  ctx.fillRect(0, H * 0.86, W, H * 0.14)
  return ctx.getImageData(0, 0, W, H)
}

let synthetic: ImageData | null = null
function sourceFrame(): ImageData {
  if (captured) return captured
  synthetic ??= syntheticFrame()
  return synthetic
}

/** The engine's grade(), in TypeScript. */
function gradeInto(src: ImageData, spec: GradeSpec, intensity: number): ImageData {
  const cdl = resolveSpec(spec, intensity)
  const chan = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]
  }
  const sh = chan(cdl.shadows)
  const mid = chan(cdl.midtones)
  const hi = chan(cdl.highlights)
  const offset = sh.map((c) => (c - 0.5) * 0.5)
  const power = mid.map((c) => Math.max(0.05, 1 - (c - 0.5) * 1.5))
  const slope = hi.map((c) => Math.max(0, 1 + (c - 0.5) * 1.5))
  const { contrast, saturation } = cdl

  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    let r = Math.pow(Math.max((d[i] / 255) * slope[0] + offset[0], 0), power[0])
    let g = Math.pow(Math.max((d[i + 1] / 255) * slope[1] + offset[1], 0), power[1])
    let b = Math.pow(Math.max((d[i + 2] / 255) * slope[2] + offset[2], 0), power[2])
    r = (r - 0.5) * contrast + 0.5
    g = (g - 0.5) * contrast + 0.5
    b = (b - 0.5) * contrast + 0.5
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722
    d[i] = (luma + (r - luma) * saturation) * 255
    d[i + 1] = (luma + (g - luma) * saturation) * 255
    d[i + 2] = (luma + (b - luma) * saturation) * 255
  }
  return out
}

export const GradePreview = memo(function GradePreview({
  spec,
  intensity = 1,
  className,
}: {
  spec: GradeSpec
  intensity?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Keyed on the resolved CDL rather than object identity
  const key = JSON.stringify(resolveSpec(spec, intensity))
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.putImageData(gradeInto(sourceFrame(), spec, intensity), 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <canvas ref={ref} width={W} height={H} className={cn("h-full w-full object-cover", className)} />
})

