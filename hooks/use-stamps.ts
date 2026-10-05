"use client"

// Stamp sounds, played — see lib/stamps.ts for how a landing is found.
//
// Two jobs on one frame tick. ANALYSIS: each character's clip is traced a few
// milliseconds at a time, ahead of the playhead, and again whenever the clip
// is replaced or edited. PLAYBACK: the stamps found so far are scheduled on
// the AudioContext's clock a quarter of a second ahead of the playhead.
//
// SCHEDULED, NOT TRIGGERED. A sound started when its frame is drawn is already
// a frame late and then waits on the output buffer; started ahead of time on
// the audio clock it is sample-accurate. The clip's time is tied to the audio
// clock by an OFFSET measured every tick — and the largest recent one is the
// true one, because this tick may run before the engine has advanced the clip
// for the frame, never after it has advanced it twice. A jump (a scrub, a
// loop, a return from a hidden tab) shows as that offset moving by more than
// JUMP: what was scheduled and has not started is cancelled and the list is
// entered again from the new time.
//
// A SLOW FRAME LOOP MUST NOT DROP STAMPS. At six frames a second a tick comes
// every 170ms and now and then much later, so both the look-ahead and what
// counts as a jump stretch with the slowest recent frame — found by running
// this against a heavy scene, where a fixed quarter second let a full stomp
// fall between two ticks. And a stamp that is found a few milliseconds late is
// played at once rather than skipped.
//
// NO LATENCY COMPENSATION, deliberately. The music plays through the same
// device with the same output delay, and a stamp that kept time with the
// picture by leaving the music's beat would be the worse mistake of the two.

import { useEffect, useRef, type RefObject } from "react"
import { FPS, type Engine, type Model } from "reze-engine"
import { STAMP_SPRITE, StampAnalysis, knownStamps, stampVoice, type Stamp } from "@/lib/stamps"
import { visibilityAt, type VisibilityWindow } from "@/lib/timeline/visibility"

const AHEAD = 0.25 // seconds of stamps scheduled at a time, plus two slow frames
const JUMP = 0.05 // seconds the clip may move against the audio clock before it is a jump
const LATE = 0.04 // seconds late a stamp may be and still play, now
const WINDOW = 20 // ticks the offset is the largest of
const FRAMES = 12 // ticks the slowest recent frame is taken over
// Analysis per tick: a share of the frame, so a slow device still traces
// faster than it plays, with a floor for a fast one.
const SHARE_PLAYING = 0.25
const SHARE_IDLE = 0.5
const BUDGET_MIN = 4 // ms
const BUDGET_MAX = 60 // ms

interface Voice {
  model: Model
  stamps: Stamp[]
  /** Clip time minus audio time, recent ticks, newest last. */
  offsets: number[]
  next: number
  queued: Set<{ src: AudioBufferSourceNode; when: number }>
}

export function useStamps({
  engineRef,
  ids,
  enabled,
  volume,
  lanes,
  disabled = false,
}: {
  engineRef: RefObject<Engine | null>
  /** The characters whose feet are heard — the animated cast. */
  ids: string[]
  enabled: boolean
  /** 0–1. */
  volume: number
  /** Who is on stage when (the scene timeline's visibility): a character that
   *  is off stage makes no sound. */
  lanes?: Record<string, VisibilityWindow[]>
  /** True while exporting: the render owns the clock, and the file gets its
   *  stamps mixed in (lib/video-export). */
  disabled?: boolean
}) {
  const live = useRef({ volume, lanes, disabled })
  const master = useRef<GainNode | null>(null)
  useEffect(() => {
    live.current = { volume, lanes, disabled }
    if (master.current) master.current.gain.value = volume
  }, [volume, lanes, disabled])
  const key = ids.join("|")

  useEffect(() => {
    if (!enabled || !key) return
    const cast = key.split("|")
    const ctx = new AudioContext({ latencyHint: "interactive" })
    const out = ctx.createGain()
    out.gain.value = live.current.volume
    out.connect(ctx.destination)
    master.current = out
    let sprite: AudioBuffer | null = null
    void fetch(STAMP_SPRITE)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((b) => (sprite = b))
      .catch((e) => console.error("[stamps] sound failed to load", e))

    const voices = new Map<string, Voice>()
    const jobs = new Map<string, StampAnalysis>()
    /** Stops what a voice has scheduled — all of it, or only what has not
     *  started, so a stamp already sounding is never cut off. */
    const cancel = (v: Voice, all: boolean) => {
      for (const q of v.queued) {
        if (!all && q.when <= ctx.currentTime) continue
        q.src.onended = null
        try {
          q.src.stop()
        } catch {}
        v.queued.delete(q)
      }
    }

    let raf = 0
    let last = performance.now()
    const frames: number[] = []
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const engine = engineRef.current
      if (!engine) return
      const { lanes, disabled } = live.current
      const frame = performance.now() - last
      last = performance.now()
      frames.push(frame)
      if (frames.length > FRAMES) frames.shift()
      /** The slowest recent frame, in seconds — at most one, so a tab that
       *  was hidden for a minute does not schedule a minute ahead. */
      const slow = Math.min(1, Math.max(...frames) / 1000)
      let playing = false

      for (const id of cast) {
        const model = engine.getModel(id)
        if (!model) continue
        const p = model.getAnimationProgress()

        // The finished list, or what an analysis under way has found so far.
        let stamps = knownStamps(model)
        if (stamps) jobs.delete(id)
        else if (p.animationName && p.duration > 0) {
          let job = jobs.get(id)
          if (!job || job.model !== model || !job.current) {
            job = new StampAnalysis(model, engine.getIKEnabled())
            jobs.set(id, job)
          }
          stamps = job.stamps
        }
        if (!stamps) continue

        let v = voices.get(id)
        if (!v || v.model !== model || v.stamps !== stamps) {
          // A new list (the analysis grew, or the clip changed): keep what is
          // already sounding, and enter the new one at the playhead below.
          if (v) cancel(v, false)
          v = { model, stamps, offsets: [], next: 0, queued: v?.queued ?? new Set() }
          voices.set(id, v)
        }
        if (!p.playing || disabled || !sprite) {
          if (v.offsets.length) {
            cancel(v, true)
            v.offsets = []
          }
          continue
        }
        playing = true
        if (ctx.state === "suspended") void ctx.resume()
        const now = ctx.currentTime
        const offset = p.current - now
        const held = v.offsets.length ? Math.max(...v.offsets) : null
        if (held === null || Math.abs(offset - held) > Math.max(JUMP, 1.5 * slow)) {
          // Starting, or the clip jumped: enter the list at the new time.
          cancel(v, false)
          v.offsets = [offset]
          v.next = 0
          while (v.next < stamps.length && stamps[v.next].time < p.current) v.next++
        } else {
          v.offsets.push(offset)
          if (v.offsets.length > WINDOW) v.offsets.shift()
        }
        const clipToAudio = Math.max(...v.offsets)
        const horizon = now + clipToAudio + AHEAD + 2 * slow
        for (; v.next < stamps.length && stamps[v.next].time <= horizon; v.next++) {
          const s = stamps[v.next]
          if (lanes?.[id] && !visibilityAt(lanes[id], s.time * FPS).visible) continue
          const when = s.time - clipToAudio
          if (when < now - LATE) continue
          const voice = stampVoice(s, sprite.duration)
          const src = ctx.createBufferSource()
          src.buffer = sprite
          const gain = ctx.createGain()
          gain.gain.value = voice.gain
          const pan = ctx.createStereoPanner()
          pan.pan.value = voice.pan
          src.connect(gain).connect(pan).connect(out)
          src.start(Math.max(when, now), voice.offset, voice.length)
          const q = { src, when }
          const queued = v.queued
          queued.add(q)
          src.onended = () => queued.delete(q)
        }
      }

      // Analysis: every clip still unknown gets an equal part of this frame's
      // budget. Not during an export — it owns the models' clocks.
      if (jobs.size && !disabled) {
        const share = playing ? SHARE_PLAYING : SHARE_IDLE
        const budget = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.min(frame, 100) * share)) / jobs.size
        for (const [id, job] of jobs) if (job.step(budget)) jobs.delete(id)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const v of voices.values()) cancel(v, true)
      master.current = null
      void ctx.close()
    }
  }, [engineRef, key, enabled])
}
