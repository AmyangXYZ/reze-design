"use client"

// Classic anime karaoke subtitles, over the canvas.
//
// The look every anison broadcast taught: a bold rounded line near the bottom
// edge, white glyphs in a dark outline, and the sung portion wiping to a
// colour as the clock crosses the line. Three stacked copies of the same text
// make it — outline underneath (stroke grows outward from the glyph edge),
// white fill above it, and a colour copy on top clipped to the sung fraction.
//
// This rides the SAME clock the engine's rzLyric* accessors read — the master
// model's animation progress — so what the subtitle shows and what a
// lyric-driven effect does always agree, scrubs and pauses included. React
// re-renders only when the live LINE changes; the per-frame wipe fraction is
// a CSS variable written straight to the DOM.

import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { Engine, LyricLine } from "reze-engine"

export function LyricSubtitles({
  lines,
  engineRef,
  masterId,
}: {
  lines: LyricLine[]
  engineRef: RefObject<Engine | null>
  /** The model whose clip is the clock — same master the audio element follows. */
  masterId: string | null
}) {
  const [index, setIndex] = useState(-1)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!lines.length || !masterId) {
      setIndex(-1)
      return
    }
    let raf = 0
    let last = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      if (!p) return
      const t = p.current
      let i = -1
      for (let k = 0; k < lines.length; k++) {
        if (t >= lines[k].start && t < lines[k].end) {
          i = k
          break
        }
      }
      if (i !== last) {
        last = i
        setIndex(i)
      }
      if (i >= 0 && boxRef.current) {
        const l = lines[i]
        const sung = Math.min(1, Math.max(0, (t - l.start) / (l.end - l.start)))
        boxRef.current.style.setProperty("--sung", `${(sung * 100).toFixed(2)}%`)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [lines, masterId, engineRef])

  if (index < 0) return null
  const text = lines[index].text

  const type: React.CSSProperties = {
    fontFamily: '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif',
    fontWeight: 700,
    fontSize: "clamp(18px, 2.4vw, 30px)",
    lineHeight: 1.35,
    whiteSpace: "pre-wrap",
    letterSpacing: "0.02em",
  }

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-x-0 bottom-[6%] flex justify-center px-8">
      {/* Keyed by line so each one cuts in fresh, the way broadcast subs do. */}
      <div key={index} className="relative max-w-[80%] text-center" style={type}>
        {/* Outline — the stroke straddles the glyph edge, so the copies above cover its inner half. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ ...type, WebkitTextStroke: "0.22em #101031", textShadow: "0 2px 10px rgba(0,0,0,0.45)" }}
        >
          {text}
        </span>
        {/* Fill — the line as read. */}
        <span className="relative" style={{ color: "#ffffff" }}>
          {text}
        </span>
        {/* Sung fraction — clipped from the right as the clock crosses the line. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ color: "#8ed1ff", clipPath: "inset(0 calc(100% - var(--sung, 0%)) 0 0)" }}
        >
          {text}
        </span>
      </div>
    </div>
  )
}
