"use client"

// Effect strips, on the timeline's own axis.
//
// The sequence level of a timeline that already has a channel level: a row here
// is an effect, and a bar on it is one FIRING of that effect. Every tool with
// both levels arranges them this way — After Effects' layer bars over their
// keyframes, Blender's NLA strips over the Dope Sheet, Unity's activation
// clips, Unreal's Niagara sections. None of them puts an effect inside a
// keyframe editor, because an effect was never a channel of a clip.
//
// DOM over the canvas rather than drawn into it, and that is not a shortcut.
// The mapping is the canvas's own — `pxPerFrame` and `scrollX` are React state
// inside Timeline, so a band rendered there re-renders exactly when the axis
// moves and cannot drift from it. Drawing it into the canvas would buy nothing
// but hit-testing arithmetic; an earlier version of this band was pinned to the
// TRANSPORT's track instead and the seam showed the moment anyone zoomed.
//
// A LANE HOLDS MANY STRIPS. That is the difference between an effect being on
// during a passage and an effect that FIRES — a skill hit at bar 8 and again at
// bar 24 is two strips, and each one restarts the effect's own clock so it
// plays its opening both times.

import { useRef, type PointerEvent as ReactPointerEvent } from "react"
import { framesToSeconds, secondsToFrames } from "@/lib/clip"
import type { AppliedEffect } from "@/lib/effects"
import type { EffectWindow } from "@/lib/effect-schedule"
import { cn } from "@/lib/utils"

/** How close to an end grabs it rather than the bar. Pixels, not a share: an
 *  edge is a target for a pointer, and a short strip would otherwise be two
 *  handles with no middle. */
const EDGE = 6
/** One row. Short — a lane is a bar and a name, and a PV can hold a dozen. */
export const STRIP_H = 18

type Grab = "move" | "start" | "end"

/** Snap a frame to whatever is worth landing on. The playhead first, because it
 *  is where you just were; then any other strip's edge, so firings line up. */
function snapped(frame: number, targets: number[], pxPerFrame: number): number {
  // A fixed PIXEL reach, so snapping feels the same at every zoom — six pixels
  // of pull whether that is two frames or forty.
  const reach = pxPerFrame > 0 ? 6 / pxPerFrame : 0
  let best = frame
  let bestD = reach
  for (const t of targets) {
    const d = Math.abs(t - frame)
    if (d <= bestD) {
      bestD = d
      best = t
    }
  }
  return Math.round(best)
}

function StripLane({
  effect,
  pxPerFrame,
  scrollX,
  labelWidth,
  frameCount,
  playhead,
  selectedStrip,
  onSelect,
  onLane,
}: {
  effect: AppliedEffect
  pxPerFrame: number
  scrollX: number
  labelWidth: number
  frameCount: number
  playhead: number
  selectedStrip: number | null
  onSelect: (i: number) => void
  onLane: (lane: EffectWindow[]) => void
}) {
  const drag = useRef<{ grab: Grab; x: number; i: number; from: EffectWindow } | null>(null)
  const lane = effect.window ?? []
  // The canvas's own mapping, to the pixel. Anything else is a second axis.
  const toX = (f: number) => labelWidth - scrollX + f * pxPerFrame

  const commit = (i: number, w: EffectWindow) => onLane(lane.map((x, j) => (j === i ? w : x)))

  const onDown = (i: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    onSelect(i)
    const box = e.currentTarget.getBoundingClientRect()
    const grab: Grab =
      e.clientX - box.left <= EDGE ? "start" : box.right - e.clientX <= EDGE ? "end" : "move"
    drag.current = { grab, x: e.clientX, i, from: lane[i] }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d || pxPerFrame <= 0) return
    const df = Math.round((e.clientX - d.x) / pxPerFrame)
    const from = d.from
    const end = from.end ?? from.start + 1
    // Everything worth landing on EXCEPT this strip's own edges — a bar cannot
    // snap to where it already is, or it would never leave.
    const targets = [playhead, ...lane.flatMap((w, j) => (j === d.i ? [] : [w.start, w.end ?? w.start]))]
    if (d.grab === "move") {
      const span = end - from.start
      const start = Math.max(0, snapped(from.start + df, targets, pxPerFrame))
      commit(d.i, { ...from, start, end: start + span })
      return
    }
    if (d.grab === "start") {
      // At least one frame left: a start dragged past its end is a strip that
      // plays nothing and cannot be grabbed back.
      commit(d.i, { ...from, start: Math.max(0, Math.min(end - 1, snapped(from.start + df, targets, pxPerFrame))), end })
      return
    }
    commit(d.i, { ...from, end: Math.max(from.start + 1, snapped(end + df, targets, pxPerFrame)) })
  }

  const onUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /** Clicking bare track FIRES IT AGAIN — a new strip there, the length of the
   *  last one. The most direct answer to "trigger it once more", and it needs
   *  no keyboard and no menu. */
  const addAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pxPerFrame <= 0) return
    const box = e.currentTarget.getBoundingClientRect()
    const f = Math.round((e.clientX - box.left + scrollX - labelWidth) / pxPerFrame)
    const last = lane[lane.length - 1]
    const span = last ? (last.end ?? last.start + 1) - last.start : Math.round(secondsToFrames(1))
    const start = Math.max(0, snapped(f, [playhead, ...lane.flatMap((w) => [w.start, w.end ?? w.start])], pxPerFrame))
    onLane([...lane, { start, end: start + span }])
    onSelect(lane.length)
  }

  return (
    <div className="relative" style={{ height: STRIP_H }} onDoubleClick={addAt}>
      {/* The lane key, in the canvas's own label gutter so the two columns are
          one column. Mono and tracked: it names the KIND of thing the row holds
          and must not read as content. */}
      <span
        className="absolute inset-y-0 left-0 flex items-center overflow-hidden pr-1"
        style={{ width: labelWidth }}
      >
        <span
          className="truncate font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
          title={effect.name}
        >
          {effect.name}
        </span>
      </span>
      {/* AMBIENT effects get a hairline the width of the scene rather than a
          bar. They have no moment — stars are a condition the scene is in — and
          drawing them as a full-length strip invites you to trim something that
          was never placed. */}
      {lane.length === 0 && (
        <span
          className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-line-strong"
          style={{ left: toX(0), width: Math.max(0, frameCount * pxPerFrame) }}
        />
      )}
      {lane.map((w, i) => {
        const end = w.end ?? w.start + 1
        const x = toX(w.start)
        const width = Math.max(3, (end - w.start) * pxPerFrame)
        const span = Math.max(end - w.start, 1)
        return (
          <span
            key={i}
            onPointerDown={onDown(i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ left: x, width }}
            className={cn(
              "absolute inset-y-[2px] touch-none cursor-grab overflow-hidden rounded-chip border active:cursor-grabbing",
              selectedStrip === i
                ? "border-blue-400 bg-blue-400/35"
                : "border-blue-400/50 bg-blue-400/20 hover:bg-blue-400/30",
            )}
          >
            {/* The blends as the slopes they are — the same picture an NLA strip
                draws. Their numbers live in the panel beside the effect, which
                is where Blender keeps them too. */}
            {(w.blendIn ?? 0) > 0 && (
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent"
                style={{ width: `${Math.min(100, ((w.blendIn ?? 0) / span) * 100)}%` }}
              />
            )}
            {(w.blendOut ?? 0) > 0 && (
              <span
                className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/50 to-transparent"
                style={{ width: `${Math.min(100, ((w.blendOut ?? 0) / span) * 100)}%` }}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

/**
 * The strips band. Nothing at all with no effects applied — an empty band is a
 * gutter with a hole in it, and effects are added from the dock where the rest
 * of the scene is assembled.
 */
export function EffectStrips({
  effects,
  pxPerFrame,
  scrollX,
  labelWidth,
  frameCount,
  playhead,
  selectedEffect,
  selectedStrip,
  onSelectStrip,
  onLane,
}: {
  effects: AppliedEffect[]
  pxPerFrame: number
  scrollX: number
  labelWidth: number
  frameCount: number
  playhead: number
  selectedEffect: string | null
  selectedStrip: number | null
  onSelectStrip: (uid: string, i: number) => void
  onLane: (uid: string, lane: EffectWindow[]) => void
}) {
  if (effects.length === 0) return null
  return (
    <div className="overflow-hidden border-b border-line">
      {effects.map((e) => (
        <StripLane
          key={e.uid ?? e.id}
          effect={e}
          pxPerFrame={pxPerFrame}
          scrollX={scrollX}
          labelWidth={labelWidth}
          frameCount={frameCount}
          playhead={playhead}
          selectedStrip={selectedEffect === e.uid ? selectedStrip : null}
          onSelect={(i) => e.uid && onSelectStrip(e.uid, i)}
          onLane={(lane) => e.uid && onLane(e.uid, lane)}
        />
      ))}
    </div>
  )
}

/** Seconds a lane's strips are worth, for anything that wants to size a row. */
export const laneSeconds = (lane: EffectWindow[]): number =>
  lane.reduce((n, w) => n + framesToSeconds((w.end ?? w.start + 1) - w.start), 0)
