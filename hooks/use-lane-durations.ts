"use client"

// How long each clip in the scene actually runs — the timeline lanes' time axis.
//
// Polled rather than read once, for the same reason the master-clip duration in
// page.tsx is: a VMD reports its length whenever parsing finishes and an <audio>
// element reports its own when metadata lands, both of them after the React
// state that named the file. A one-shot read races them and loses. This is that
// poller generalised to every lane, and it stops the moment every lane it is
// waiting on has answered.
//
// Keyed by a signature instead of reset-on-change: a stale reading simply stops
// matching, so swapping a motion never needs a synchronous zeroing write.

import { useEffect, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"

export type LaneDurations = {
  /** Seconds, by cast member id. Missing or 0 = not known yet. */
  byModel: Record<string, number>
  camera: number
  audio: number
  /**
   * The longest lane.
   *
   * A FALLBACK for the axis, not the axis itself: the timeline is drawn against
   * what actually plays (the master clip), because the transport's bar is, and
   * two scales for one clock put the playhead where the thumb was not. This is
   * what the lanes fall back to while no clip has reported a length — an
   * audio-only scene still has something to draw.
   */
  axis: number
}

const EMPTY: LaneDurations = { byModel: {}, camera: 0, audio: 0, axis: 0 }

const same = (a: LaneDurations, b: LaneDurations) =>
  a.camera === b.camera &&
  a.audio === b.audio &&
  a.axis === b.axis &&
  Object.keys(a.byModel).length === Object.keys(b.byModel).length &&
  Object.entries(b.byModel).every(([k, v]) => a.byModel[k] === v)

export function useLaneDurations({
  engineRef,
  audioRef,
  modelIds,
  hasCamera,
  hasAudio,
  signature,
  enabled = true,
}: {
  engineRef: RefObject<Engine | null>
  audioRef: RefObject<HTMLAudioElement | null>
  /** Cast members carrying a clip. Ones without have a drop slot, not a block. */
  modelIds: string[]
  hasCamera: boolean
  hasAudio: boolean
  /** Changes whenever any clip in the scene is swapped — restarts the poll. */
  signature: string
  /** Only while the lanes are visible: nothing else reads these. */
  enabled?: boolean
}): LaneDurations {
  const [entry, setEntry] = useState<{ sig: string; v: LaneDurations }>({ sig: "", v: EMPTY })
  // Read inside the interval, so a re-render with a new array identity does not
  // restart the poll — `signature` is what means the clips actually changed.
  const idsRef = useRef(modelIds)
  useEffect(() => {
    idsRef.current = modelIds
  })

  useEffect(() => {
    if (!enabled) return
    const read = (): LaneDurations => {
      const byModel: Record<string, number> = {}
      for (const id of idsRef.current) {
        byModel[id] = engineRef.current?.getModel(id)?.getAnimationProgress().duration ?? 0
      }
      const camera = hasCamera ? (engineRef.current?.getCameraVmdDuration() ?? 0) : 0
      const raw = audioRef.current?.duration
      const audio = hasAudio && typeof raw === "number" && Number.isFinite(raw) ? raw : 0
      return { byModel, camera, audio, axis: Math.max(0, ...Object.values(byModel), camera, audio) }
    }
    const answered = (v: LaneDurations) =>
      idsRef.current.every((id) => v.byModel[id] > 0) && (!hasCamera || v.camera > 0) && (!hasAudio || v.audio > 0)

    let timer: ReturnType<typeof setInterval> | null = null
    const tick = () => {
      const v = read()
      setEntry((prev) => (prev.sig === signature && same(prev.v, v) ? prev : { sig: signature, v }))
      if (answered(v) && timer) clearInterval(timer)
    }
    tick()
    timer = setInterval(tick, 300)
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [signature, enabled, hasCamera, hasAudio, engineRef, audioRef])

  return entry.sig === signature ? entry.v : EMPTY
}
