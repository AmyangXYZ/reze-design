"use client"

// Export framing: the letterboxed preview rectangle, the compositing preview,
// and whether an export is running.
//
// These five pieces of state only make sense together — `activeFrame` and
// `liveBackground` were derived inline in the page from four of them, so
// reading any one meant finding the other three first.
//
// `lastFrame` is here for a reason worth keeping visible: collapsing the docks
// UNMOUNTS the render panel, which drops the frame it was reporting, and an
// export already in flight must keep its framing. That is a coupling between
// export state and chrome, and it is why this hook is shared rather than owned
// by a layout — a layout with no dock still needs the frame to survive whatever
// its own collapse does.

import { useCallback, useEffect, useState } from "react"
import type { FramePreview } from "@/components/editor/render-panel"
import type { ExportBackground } from "@/lib/export-background"

export function useRenderFraming() {
  /** An export is running; it drives the same model clock the live mirrors watch. */
  const [exporting, setExporting] = useState(false)
  /** What sits behind the cast on export. A render-tab PREVIEW, not a scene
   *  mode — see liveBackground. */
  const [background, setBackground] = useState<ExportBackground>("scene")
  /** Live framing while the render surface is open; null once it closes. */
  const [framePreview, setFramePreview] = useState<FramePreview | null>(null)
  /** The last framing seen, so an in-flight export survives the panel unmounting. */
  const [lastFrame, setLastFrame] = useState<FramePreview | null>(null)

  const handleFramePreview = useCallback((p: FramePreview | null) => {
    setFramePreview(p)
    if (p) setLastFrame(p)
  }, [])

  const activeFrame = framePreview ?? (exporting ? lastFrame : null)
  const liveBackground: ExportBackground = activeFrame === null ? "scene" : background

  // Seeded from the window rather than left null until an effect runs: the pair
  // (frame, viewport) decides the render size, and measuring one render later
  // made opening the render surface resize the WebGPU canvas TWICE — once to the
  // viewport, once to the framed size.
  const [frameVp, setFrameVp] = useState<{ w: number; h: number } | null>(() =>
    typeof window === "undefined" ? null : { w: window.innerWidth, h: window.innerHeight },
  )
  useEffect(() => {
    if (!activeFrame) return
    const update = () => setFrameVp({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [activeFrame])

  return {
    exporting,
    setExporting,
    background,
    setBackground,
    framePreview,
    handleFramePreview,
    activeFrame,
    liveBackground,
    frameVp,
  }
}
