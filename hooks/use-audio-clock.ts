"use client"

// Mirror the animation clock onto the scene's media elements — the model is the
// master.
//
// Extracted verbatim from app/page.tsx so the 0.4.0 chrome plays music the same
// way the shipped editor does. Every quirk in here is a lesson iOS Safari
// taught once and must not teach twice; change nothing casually.
//
// A MOVING BACKDROP RIDES THE SAME TICK, by one of two routes. A gif or
// animated webp is DRAWN (see use-media-backdrop): there is no element that can
// be told what time it is, and an <img> animates on the browser's clock. A
// VIDEO plays natively, because at 4K60 the copies a drawn frame costs are the
// difference between smooth and not. The branch at the end of the tick is what
// keeps the second one from moving the picture when nobody asked.

import { useEffect, useRef, type RefObject } from "react"
import { createMediaFollower } from "@/lib/media-clock"
import { primeAudioAnalysis } from "@/lib/audio-analysis"
import type { Engine } from "reze-engine"

export function useAudioClock({
  engineRef,
  masterId,
  audioRef,
  drawBackdrop,
  videoRef,
  syncLyricsTo,
  tickPlanes,
  disabled = false,
  autoplay = false,
}: {
  engineRef: RefObject<Engine | null>
  /** The model whose clip is the clock — first of the animated set, or null. */
  masterId: string | null
  audioRef: RefObject<HTMLAudioElement | null>
  /** Paint a DRAWN backdrop (gif/webp/apng) at a scene time. Every frame it
   *  shows is one this asked for, so it needs no play/pause branch of its own
   *  and follows a scrub and an export alike. */
  drawBackdrop?: (time: number) => void
  /** A VIDEO backdrop, which plays natively — see the branch at the end of the
   *  tick for why this one keeps an element. */
  videoRef?: RefObject<HTMLVideoElement | null>
  /** Keep the resident lyric page under the playhead. Cheap per frame: it
   *  compares against the range already loaded and almost always returns. */
  syncLyricsTo?: (time: number) => void
  /** Push every moving card's current frame into its texture, and keep the
   *  elements behind them on the clip's clock. */
  tickPlanes?: (time: number, playing: boolean, exporting: boolean) => void
  /** True while exporting: the render pipeline owns time, the element stays
   *  silent — and the export decodes the backdrop from the file itself, so the
   *  element has no part in what it produces. */
  disabled?: boolean
  /**
   * The clock starts on its own — a published scene plays on arrival — rather
   * than on a press of play. Sound then cannot wait for "the user has
   * interacted", because on desktop nobody has to; and on iOS the one gesture
   * that unlocks the element may land long before there is anything to play.
   * See the blessing below.
   */
  autoplay?: boolean
}) {
  /** The backdrop's own clock state. See lib/media-clock for the policy. */
  const followBackdrop = useRef(createMediaFollower())

  /** Whether the clock currently wants sound. Written by the tick, read by the
   *  blessing's gesture handler — a ref, because the handler is registered once
   *  and must see the CURRENT answer. */
  const wantAudio = useRef(false)

  /**
   * AUTOPLAY ONLY — iOS: take the element's autoplay blessing from the FIRST
   * gesture, whenever that turns out to be.
   *
   * An autoplaying clock makes its first play() from the rAF tick with no user
   * gesture behind it — WebKit rejects it, and every retry, none of them being
   * gestures either. So this listens from MOUNT, not from when the scene is
   * ready: on a phone the scene takes most of a minute, and the one tap a
   * reader gives a loading page must not land where nothing is listening.
   * play() inside a gesture clears the element's restriction in WebKit BEFORE
   * it looks at the source, so the blessing can be taken while the element has
   * no src yet, and it holds across the src React sets later.
   *
   * Three things this gets wrong if written casually, all learned the hard way:
   *
   * NOT MUTED. A muted prime lifts the video restriction, not the audio one.
   *
   * PAUSED SYNCHRONOUSLY, not in the promise — before a sample is produced, so
   * there is no blip. The play() then rejects with AbortError, which is the
   * expected outcome: the restriction was lifted on the way in.
   *
   * NOT ONCE. A prime taken before the element has a src may not stick, so this
   * primes again on a later gesture once there is a source.
   *
   * Desktop needs none of it — autoplay needs no gesture there — which is why
   * the editor, whose clock only starts on a press of play, leaves it off.
   */
  useEffect(() => {
    if (!autoplay) return
    const audio = audioRef.current
    if (!audio) return
    let primedWithSource = false
    const bless = () => {
      // The clock is already running: this tap is the reader asking for the
      // track, so join it in and leave it playing.
      if (wantAudio.current) {
        if (audio.paused && audio.src) void audio.play().catch(() => {})
        return
      }
      if (primedWithSource) return
      void audio.play().catch(() => {})
      audio.pause()
      if (audio.src) primedWithSource = true
    }
    // Capture, so a handler that stops propagation cannot take the gesture.
    const opts = { capture: true } as const
    window.addEventListener("pointerdown", bless, opts)
    window.addEventListener("keydown", bless, opts)
    return () => {
      window.removeEventListener("pointerdown", bless, opts)
      window.removeEventListener("keydown", bless, opts)
    }
  }, [autoplay, audioRef])

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
    if (!masterId) {
      wantAudio.current = false
      audio.pause()
      return
    }
    // AN EXPORT SILENCES THE SOUND AND KEEPS THE PICTURE.
    //
    // The tick used to return outright here, which is right for everything the
    // export owns: it writes setAudioTime and setMidiTime itself, from its own
    // exact frame times, and a second writer feeding it wall-clock progress
    // would fight it every frame. Sound has nowhere to go either — the export
    // is not playing the scene, it is stating what time it is.
    //
    // The backdrop is neither. Freezing it left the one thing on screen that
    // was not following the render, so an export of a moving background looked
    // broken while producing a correct file. It follows below, stepped rather
    // than played.
    if (disabled) audio.pause()
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
    /**
     * Whether a play() is already in flight.
     *
     * The tick asks an element that should be sounding and is not to play, and
     * it asks EVERY FRAME until it is. That is right while the answer is "no
     * user gesture yet" and wrong the moment the element is merely loading:
     * play() on a loading element resolves when it starts, and a second play()
     * before then aborts the first. At 60fps that is a new load request every
     * 16ms, each cancelling the one before, and the element never gets far
     * enough to sound — which is exactly the state a replaced or re-uploaded
     * track puts it in, since the clock is already running when the new bytes
     * arrive. A reload cleared it only because the element loads there while the
     * clock is stopped.
     *
     * So: one request at a time. A rejection (no gesture, src pulled) frees it
     * for the next frame to try again, which keeps the retry loop this relies on.
     */
    let playPending = false
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
    // Not under autoplay: the blessing's own play() already starts the fetch
    // from inside the gesture, and a load() here would only reset it.
    const warm = () => {
      if (audio.paused && audio.readyState < 3 && audio.src) audio.load()
    }
    if (!autoplay) {
      window.addEventListener("pointerdown", warm, { once: true })
      window.addEventListener("keydown", warm, { once: true })
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      wantAudio.current = !!p?.playing && !disabled
      if (!p) return
      // A frame advances the clock ≤ ~0.05s — anything bigger is a discrete
      // jump. Read before either half below, because both want it.
      const jumped = lastModelTime >= 0 && Math.abs(p.current - lastModelTime) > 0.35
      lastModelTime = p.current

      // Everything the EXPORT owns while it runs — see the note above.
      if (!disabled) {
        // The rzAudio* clock for effects — a 4-byte header write, every tick, so
        // audio-reactive shaders follow scrubs and pauses exactly as sound does.
        engineRef.current?.setAudioTime(p.current, p.playing)
        // The score's clock, on the SAME tick and the same value. Notes and the
        // music they were transcribed from have to advance together or the whole
        // point is lost — and driving both from the model's animation progress is
        // what makes a scrub, a pause and an offline export all agree.
        engineRef.current?.setMidiTime(p.current, p.playing)
        // An autoplaying clock asks regardless: a desktop browser lets it, and
        // iOS refuses until the blessing above has had its gesture.
        const playing = p.playing && (autoplay || userInteracted.current)
        if (playing) {
          // Free-running audio, like the reze.one demo: the clock is set at
          // playback start and on explicit jumps (scrub, loop wrap) and is then
          // LEFT ALONE — no drift lock, no rate bending. Continuous correction
          // of any kind is what stuttered on mobile Safari; real clock drift
          // over a dance is milliseconds and nobody hears it.
          // Stamp only when the clocks genuinely disagree (scrubbed while
          // stopped, loop wrap) — a resume with clocks already close plays on
          // untouched, seek-free.
          //
          // Arm the onset correction on EVERY start, not only the starts that
          // needed a stamp. Arming used to live inside the branch below, which
          // meant the most common start of all never armed it: pressing play at
          // frame 0 leaves audio.currentTime and p.current both at 0, so the 0.15
          // threshold cannot trip. Sound still begins well after play() on a cold
          // buffer, and with nothing armed onPlaying returned at its !stampArmed
          // guard — so that decode latency became a fixed offset for the whole
          // take, since free-run never corrects itself afterwards. That is the
          // "audio starts late from frame 0" report.
          //
          // Plain resumes stay safe: onPlaying only moves the clock when the two
          // are more than 0.05s apart, and a resume is already well inside that,
          // so it still does not flush the decoder or clip the first beat.
          if (!wasPlaying) stampArmed = true
          if ((!wasPlaying && Math.abs(audio.currentTime - p.current) > 0.15) || (!audio.seeking && jumped)) {
            audio.currentTime = p.current
            stampArmed = true
          }
          // A track SHORTER than the clip ends part-way through and leaves the
          // element paused. Seeking it back to 0 when the motion loops does not
          // resume an ended element — only play() does — so the second pass ran in
          // silence. Guarded on there being audio left, or an element sitting at
          // its own duration would be asked to start again every frame.
          //
          // `audio.src` is the same guard `warm` uses: a scene with no track, or one
          // whose track was just removed, otherwise fires a play() that can only
          // reject, once per frame, for as long as the motion runs.
          if (
            audio.src &&
            audio.paused &&
            !playPending &&
            (!Number.isFinite(audio.duration) || p.current < audio.duration - 0.05)
          ) {
            playPending = true
            void audio
              .play()
              .catch(() => {})
              .finally(() => {
                playPending = false
              })
          }
        } else if (!audio.paused) {
          audio.pause()
        }
        wasPlaying = playing
      }

      // Unconditional, and outside everything the export owns above: the
      // backdrop is the one thing on screen that should keep following while a
      // render runs.
      drawBackdrop?.(p.current)
      // Same reason and the same place: the words have to be resident before
      // the frame that shows them, and an export steps this clock too.
      syncLyricsTo?.(p.current)
      // Cards. The EXPORT owns them while it runs: it decodes their frames from
      // the file at its own frame times and writes them into the textures
      // itself, so this must not also be stepping the elements. It used to, by
      // seeking one per tick — which costs tens of milliseconds each and
      // advanced a card about once a second while the render ran on.
      tickPlanes?.(p.current, p.playing, disabled)

      // ── A video backdrop, which PLAYS ──
      //
      // The one moving kind that keeps an element. A decoded-and-drawn video
      // costs a full-resolution copy per frame on the same thread as the 3D
      // render, which 1080p60 survives and 4K60 does not; the element hands the
      // frames to the compositor with no copy at all, and often on an overlay
      // plane. Smooth at any resolution the machine can decode. Gifs keep the
      // drawn path — they have no element that can be told what time it is.
      //
      // THE PICTURE NEVER MOVES ON ITS OWN. Pausing does not seek: an element
      // free-running against the clip sits within a frame of it, and correcting
      // that on the way into a pause is what changed the picture after the
      // character had stopped. A stopped transport is not a reason to move
      // anything — only the scene time actually CHANGING while stopped is, and
      // that is a scrub, where a moving picture is the point.
      //
      // What it costs is that a paused preview can be one frame from what the
      // export writes for that moment. Invisible, and the file is unaffected:
      // the export decodes its own backdrop frames from the source.
      const video = videoRef?.current ?? null
      // An export owns the clock but not the picture: it decodes its own
      // backdrop frames, and freezing this would leave the one thing on screen
      // that is not following the render.
      if (video) followBackdrop.current(video, p.current, p.playing && !disabled)

    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener("playing", onPlaying)
      window.removeEventListener("pointerdown", warm)
      window.removeEventListener("keydown", warm)
    }
    // The refs are stable; listing them costs nothing and keeps the rule on.
  }, [masterId, engineRef, disabled, autoplay, audioRef, drawBackdrop, videoRef, syncLyricsTo, tickPlanes])
}

/**
 * The track's two other jobs, for every page that plays a scene: its analysis
 * for audio-reactive effects (rzAudio*), and the level it was mixed at.
 *
 * The analysis is primed when the track changes and cleared when it goes; the
 * engine samples it at the time the clock above writes, so effects, sound and
 * export agree. `volume` is a property with no content attribute behind it, so
 * React cannot carry it in the JSX — written here, and on every track change
 * too: a new src keeps the element's level, but a swapped element starts at 1.
 */
export function useTrackAudio({
  engineRef,
  audioRef,
  ready,
  url,
  volume,
}: {
  engineRef: RefObject<Engine | null>
  audioRef: RefObject<HTMLAudioElement | null>
  ready: boolean
  /** The playable track, or null/empty while there is none. */
  url: string | null | undefined
  volume: number
}) {
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (!url) {
      engine.setAudioData(null, 0, 0)
      return
    }
    let stale = false
    void primeAudioAnalysis(url).then((a) => {
      if (stale || !a) return
      engineRef.current?.setAudioData(a.data, a.bands, a.secondsPerFrame)
    })
    return () => {
      stale = true
    }
  }, [url, ready, engineRef])

  useEffect(() => {
    const el = audioRef.current
    if (el) el.volume = Math.max(0, Math.min(1, volume))
  }, [audioRef, volume, url])
}
