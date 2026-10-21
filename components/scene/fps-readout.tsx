"use client"

// The frame rate, at the cover's bottom right: "60 FPS". Read off the engine
// once a second and written straight into the text, so nothing re-renders. A
// fixed box of tabular figures, wide enough for 120 FPS, so it never drifts.

import { useEffect, useRef, type RefObject } from "react"
import type { Engine } from "reze-engine"

export function FpsReadout({ engineRef }: { engineRef: RefObject<Engine | null> }) {
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const fps = engineRef.current?.getStats().fps
      if (textRef.current && fps !== undefined) textRef.current.textContent = `${Math.round(fps)} FPS`
    }, 1000)
    return () => clearInterval(timer)
  }, [engineRef])
  return (
    <div data-edge="right" className="cover-type pointer-events-none absolute right-7 bottom-5 flex h-8 items-center font-mono text-2xs">
      <span ref={textRef} data-ink-zone className="w-[7ch] text-right leading-none text-muted-foreground tabular-nums">
        – FPS
      </span>
    </div>
  )
}
