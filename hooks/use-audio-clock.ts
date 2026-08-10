"use client"

// Mirror the animation clock onto an audio element — the model is the master.
//
// Extracted verbatim from app/page.tsx so the 0.4.0 chrome plays music the same
// way the shipped editor does. Every quirk in here is a lesson iOS Safari
// taught once and must not teach twice; change nothing casually.

import { useEffect, useRef, type RefObject } from "react"
import type { Engine } from "reze-engine"

export function useAudioClock({
  engineRef,
  masterId,
  audioRef,
  disabled = false,
}: {
  engineRef: RefObject<Engine | null>
  /** The model whose clip is the clock — first of the animated set, or null. */
  masterId: string | null
  audioRef: RefObject<HTMLAudioElement | null>
  /** True while exporting: the render pipeline owns time, the element stays silent. */
  disabled?: boolean
}) {
  // Browsers block audio until the user interacts.
  const userInteracted = useRef(false)
  useEffect(() => {
    const on = () => {
      userInteracted.current = true
      window.removeEventListener("pointerdown", on)
      window.removeEventListener("keydown", on)
    }
    window.addEventListener("pointerdown", on)
    window.addEventListener("keydown", on)
    return () => {
      window.removeEventListener("pointerdown", on)
      window.removeEventListener("keydown", on)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!masterId || disabled) {
      audio.pause()
      return
    }
    let raf = 0
    let wasPlaying = false
    let lastModelTime = -1
    // The one correction free-run allows: when sound ACTUALLY starts (decode
    // can lag play() by hundreds of ms on a cold cache), stamp the clock once.
    // Fires per start, never during steady playback.
    // Armed ONLY when the tick just stamped the clock (start/scrub/loop):
    // sound may begin hundreds of ms after that stamp, so correct once at true
    // onset. Plain resumes never arm it — seeking there flushes the decoder
    // and mutes the first beat, which is worse than the drift.
    let stampArmed = false
    const onPlaying = () => {
      if (!stampArmed) return
      stampArmed = false
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      if (p?.playing && Math.abs(audio.currentTime - p.current) > 0.05) audio.currentTime = p.current
    }
    audio.addEventListener("playing", onPlaying)
    // preload="auto" is a hint iOS Safari ignores until a user gesture — warm
    // the buffer on the FIRST gesture anywhere (usually well before play), so
    // pressing play starts sound without a fetch+decode stall. Guarded: never
    // fires once data is buffered or playback has begun.
    const warm = () => {
      if (audio.paused && audio.readyState < 3 && audio.src) audio.load()
    }
    window.addEventListener("pointerdown", warm, { once: true })
    window.addEventListener("keydown", warm, { once: true })

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      if (!p) return
      const playing = p.playing && userInteracted.current
      // A frame advances the clock ≤ ~0.05s — anything bigger is a discrete jump.
      const jumped = lastModelTime >= 0 && Math.abs(p.current - lastModelTime) > 0.35
      lastModelTime = p.current
      if (playing) {
        // Free-running audio, like the reze.one demo: the clock is set at
        // playback start and on explicit jumps (scrub, loop wrap) and is then
        // LEFT ALONE — no drift lock, no rate bending. Continuous correction
        // of any kind is what stuttered on mobile Safari; real clock drift
        // over a dance is milliseconds and nobody hears it.
        // Stamp only when the clocks genuinely disagree (scrubbed while
        // stopped, loop wrap) — a resume with clocks already close plays on
        // untouched, seek-free.
        if ((!wasPlaying && Math.abs(audio.currentTime - p.current) > 0.15) || (!audio.seeking && jumped)) {
          audio.currentTime = p.current
          stampArmed = true
        }
        // A track SHORTER than the clip ends part-way through and leaves the
        // element paused. Seeking it back to 0 when the motion loops does not
        // resume an ended element — only play() does — so the second pass ran in
        // silence. Guarded on there being audio left, or an element sitting at
        // its own duration would be asked to start again every frame.
        if (audio.paused && (!Number.isFinite(audio.duration) || p.current < audio.duration - 0.05)) {
          void audio.play().catch(() => {})
        }
      } else if (!audio.paused) {
        audio.pause()
      }
      wasPlaying = playing
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener("playing", onPlaying)
      window.removeEventListener("pointerdown", warm)
      window.removeEventListener("keydown", warm)
    }
    // The refs are stable; listing them costs nothing and keeps the rule on.
  }, [masterId, engineRef, disabled, audioRef])
}
