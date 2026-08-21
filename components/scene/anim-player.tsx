"use client"

// Persistent bottom transport: play/pause · scrub · time · loop.

import { memo, useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { cn } from "@/lib/utils"
import { FPS } from "@/lib/clip"
import type { Engine, Model } from "reze-engine"
import { Orbit, Pause, Play, Repeat, RepeatOff, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"

/** A single scrub step past this reads as a teleport rather than motion. */
const SEEK_SETTLE_SECONDS = 0.35

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

const AT_END_EPS = 0.02

type Progress = { current: number; duration: number; playing: boolean; paused: boolean }

/**
 * The transport's scrub, handed out so another surface can drive it.
 *
 * The lanes below need to seek, and seeking is more than assigning a time: every
 * cast member moves together, the bar has to be repainted from the new position
 * rather than from the clock it is no longer following, and a jump big enough to
 * be a teleport has to settle the physics or the hair and skirt arrive from
 * wherever the character used to be. Reimplementing that against the engine
 * would be a second copy of it, correct until one of them changed.
 */
export type Scrub = {
  /** Take the bar off the clock for the duration of a drag. */
  begin: () => void
  /** Move every clip to `seconds`. */
  to: (seconds: number) => void
  /** Release, settling physics if the whole gesture moved far enough. */
  end: () => void
}

/**
 * What the transport hands to whatever it opens into.
 *
 * `playing` and `togglePlay` are here rather than being reimplemented below for
 * the same reason `Scrub` is: starting a scene is not calling play() on one
 * model. It is every cast member together, from wherever each was paused, with
 * an end-of-clip restart that has to reset physics or the hair arrives from the
 * last frame. A second copy of that would be correct until one of them changed.
 */
export type TransportSlot = {
  /** Camera follow, loop and the host's `trailing`, or null while collapsed —
   *  the pill still has a row of its own to show them in. */
  chrome: ReactNode
  /** What the ENGINE is doing, not what anything asked for. */
  playing: boolean
  togglePlay: () => void
}

// Memoized: props are stable across unrelated Home re-renders (e.g.
export const AnimPlayer = memo(function AnimPlayer({
  engineRef,
  modelNames,
  hasCamera,
  onFollowingChange,
  trailing,
  below,
  unfolded,
  axisDuration = 0,
  scrubRef,
  playheadDrawRef,
}: {
  engineRef: RefObject<Engine | null>
  /** Models WITH a loaded clip, master (longest clip) first. */
  modelNames: string[]
  /** A camera VMD is loaded — show the Follow/Free toggle. */
  hasCamera: boolean
  /** Extra controls at the right end of the row, after Loop. */
  trailing?: ReactNode
  /**
   * Beneath the row — the timeline the transport IS when expanded. Kept MOUNTED
   * while closed so the caller can fold it open; it is the caller's job to give
   * it zero height, not this component's to unmount it.
   *
   * Given a function, it receives this transport's CHROME — camera follow, loop
   * and whatever `trailing` holds — to place inside itself. That is how the row
   * above can go away entirely when open: the three controls that still mean
   * something once there is an editor move into the editor's own toolbar, and
   * the ones that do not (play, scrub, the two clocks) simply stop existing
   * rather than sitting there duplicated. A plain node keeps the old behaviour
   * and the chrome stays in the row.
   */
  below?: ReactNode | ((transport: TransportSlot) => ReactNode)
  /** The fold is OPEN. Only affects room: a pill wants to be tight, a panel with
   *  three lanes in it does not, and `below` cannot stand in for this because it
   *  stays mounted while closed so the fold has something to animate. */
  unfolded?: boolean
  /**
   * The lanes' time extent in seconds — the longest clip in the scene, which is
   * not always the master's. Publishes the playhead to `below` as a `--playhead`
   * custom property, 0..1 across that extent.
   *
   * A custom property rather than a prop because the bar deliberately never
   * re-renders while playing (see the tick), and a React-driven playhead across
   * four lanes would undo exactly that. The variable is set on this component's
   * root, so anything in `below` can position against it in CSS alone.
   *
   * 0 disables the write entirely — a closed fold has nothing to move, and the
   * cheapest write is the one that does not happen.
   */
  axisDuration?: number
  /** Filled in with this transport's scrub, for a caller that draws its own
   *  playhead — see Scrub. Nulled on unmount. */
  scrubRef?: RefObject<Scrub | null>
  /**
   * The dopesheet's playhead, in CLIP FRAMES, called off this same tick.
   *
   * The timeline below draws to a canvas, and a canvas cannot be moved by a
   * custom property the way the lanes are — something has to hand it the number
   * every frame. This is that hand-off, and it belongs HERE rather than in a
   * loop of the timeline's own: two rAFs both reading `getAnimationProgress()`
   * is duplicate work that can also disagree by a frame, which is visible as
   * the bar and the keys drifting apart during playback.
   *
   * Deliberately ABOVE the bar's throttle. The bar is inside a backdrop-blur
   * pane, so dirtying it on a phone costs a full blur recomposite and it drops
   * to 4Hz there; the canvas is outside that pane and pays none of it. Sharing
   * the clock does not have to mean sharing the paint rate, and a dopesheet
   * playhead ticking four times a second is not an editor.
   */
  playheadDrawRef?: RefObject<((frame: number) => void) | null>

  /** Live camera-VMD drive state — fires on toggle and on initial sync, so the
   *  host can enable/disable its camera controls with the ACTUAL mode. */
  onFollowingChange?: (following: boolean) => void
}) {
  const t = useT()
  const [progress, setProgress] = useState<Progress>({ current: 0, duration: 0, playing: false, paused: false })
  const [loop, setLoop] = useState(true)
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  })
  // The bar is driven OUTSIDE React: the rAF tick writes transform-only DOM
  // updates (fill scaleX, thumb translateX) — smooth 60fps without a single
  // re-render, which is what iOS Safari needs with a blurred pane over the
  // canvas. React keeps only structural state (playing/duration).
  const trackRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const axisRef = useRef(axisDuration)
  useEffect(() => {
    axisRef.current = axisDuration
  })
  const fillRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const currentRef = useRef(0)
  const draggingRef = useRef(false)
  const paintBarRef = useRef<(current: number, duration: number, snap?: boolean) => void>(() => {})
  // Whether the loaded camera VMD is currently driving the view (vs. free orbit).
  //
  // Mirrored from the engine in the tick below rather than read once on mount.
  // Asking once was wrong twice over: the host assigns the Engine reference
  // BEFORE awaiting init(), so the question arrived at a half-built engine, and
  // even answered it would have been answered before the scene's camera VMD had
  // loaded — a scene that boots with one would have reported free orbit while
  // the VMD was in fact driving, with no later event to correct it.
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(following)
  const hasCameraRef = useRef(hasCamera)
  const onFollowingChangeRef = useRef(onFollowingChange)
  const dopeDrawRef = useRef(playheadDrawRef)
  useEffect(() => {
    hasCameraRef.current = hasCamera
    onFollowingChangeRef.current = onFollowingChange
    dopeDrawRef.current = playheadDrawRef
  })
  const toggleCamera = () => {
    const engine = engineRef.current
    if (!engine) return
    const next = !following
    // Free orbit is FAITHFUL: the orbit still holds the framing the scene's
    // author stored (applied at load, untouched while the VMD drives), so
    // toggling off simply returns to it — no recentering, no manipulation.
    engine.setCameraVmdEnabled(next)
    onFollowingChange?.(next)
    followingRef.current = next // else the tick reads this back as a change and re-fires
    setFollowing(next)
  }

  // Stable key for effect deps
  const namesKey = modelNames.join("\0")
  const namesRef = useRef(modelNames)
  useEffect(() => {
    namesRef.current = modelNames
  })
  const cast = (): Model[] =>
    namesRef.current.map((n) => engineRef.current?.getModel(n)).filter((m): m is Model => !!m)
  const master = (): Model | null => (namesRef.current.length ? (engineRef.current?.getModel(namesRef.current[0]) ?? null) : null)

  useEffect(() => {
    let raf = 0
    let last: Progress = { current: -1, duration: -1, playing: false, paused: false }
    // No display quantum: the playhead is judged against a 60 Hz render, so any
    // throttle reads as stepping rather than sliding, whatever its size. That is
    // affordable only because the advancing clock never touches React — it goes
    // straight to two transforms below, and React sees a render only when the
    // clip's structure changes (loaded, played, paused).
    let lastLabel = 0
    // The track's width, cached. Reading clientWidth here is a LAYOUT READ, and
    // the line above it writes a transform — write-then-read forces the browser
    // to flush layout synchronously, every frame, for a number that only
    // changes when the window resizes. On WebKit that reflow blocks against the
    // compositor and costs far more than the work it measures; it is what made
    // playback drop frames on Safari and iOS while the profiler showed the main
    // thread idle (a forced reflow lands in "unaccounted", not in script).
    let trackW = 0
    const track0 = trackRef.current
    // Where the track sits, published for the lanes to line up with.
    //
    // They must align with the TRACK, not with the panel: the gutter to its left
    // holds a play button and a running time whose width moves with the locale
    // and with the clip's length, and the one to its right holds the duration,
    // loop and fold. Neither is a constant, so both are measured — a hardcoded
    // inset is right for exactly one language and one clip.
    //
    // Custom properties for the same reason --playhead is one: the fold reads
    // them in CSS, so a resize never costs a render. Safe to measure in here
    // because the lanes are absolutely positioned and cannot feed a width back
    // into the track, which is what would make this observer loop.
    const publishInset = () => {
      const root = rootRef.current
      const el = trackRef.current
      if (!root || !el) return
      const a = root.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      root.style.setProperty("--track-left", `${b.left - a.left}px`)
      root.style.setProperty("--track-right", `${a.right - b.right}px`)
    }
    const ro = new ResizeObserver((entries) => {
      trackW = entries[0]?.contentRect.width ?? track0?.clientWidth ?? 0
      publishInset()
    })
    if (track0) {
      trackW = track0.clientWidth
      ro.observe(track0)
      publishInset()
    }
    // Per frame on desktop; a 4Hz tick on touch devices.
    //
    // Both bar elements sit inside the transport's backdrop-blur pane, and
    // dirtying anything in a blurred region makes WebKit recomposite the blur.
    // Sixty times a second that was the frame on a phone — throttling this loop
    // to 4Hz was what proved it, by making iOS playback smooth.
    //
    // Only two rates are worth having. 60Hz reads as motion and 4Hz reads as a
    // deliberate tick; everything between reads as broken, fast enough to look
    // like it is trying to be smooth and too slow to be it. Interpolating the
    // gap with a compositor tween is worse still — smoothness the clip did not
    // actually have, which is legible as exactly that. So: full rate where it
    // is affordable, an honest tick where it is not.
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    const MIN_PAINT_MS = coarse ? 250 : 0
    let lastPaintMs = -Infinity
    const paintBar = (current: number, duration: number, snap = false) => {
      const now = performance.now()
      // The dopesheet first, and unthrottled — see playheadDrawRef. It draws to
      // its own canvas outside the blurred pane, so the reason the bar below
      // ticks at 4Hz on a phone does not apply to it, and an editor's playhead
      // is the last thing that should be sampled coarsely.
      dopeDrawRef.current?.current?.(current * FPS)
      if (!snap && now - lastPaintMs < MIN_PAINT_MS) return
      lastPaintMs = now
      const ratio = duration > 0 ? Math.min(1, current / duration) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`
      if (thumbRef.current) thumbRef.current.style.transform = `translateX(${ratio * trackW}px) translate(-50%, -50%)`
      // The lanes' playhead, on this same throttled write — one clock, so the
      // bar and the lanes cannot disagree by a frame. Its own ratio, because the
      // lanes span the LONGEST clip while the bar spans the master's: with music
      // running past the dance the two are different numbers for the same instant.
      const axis = axisRef.current
      if (axis > 0 && rootRef.current) {
        rootRef.current.style.setProperty("--playhead", `${Math.min(1, current / axis)}`)
      }
      if (timeRef.current && now - lastLabel > 250) {
        lastLabel = now
        timeRef.current.textContent = fmt(current)
      }
    }
    paintBarRef.current = paintBar
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // Above the no-model return: a camera VMD can drive a scene whose models
      // have no clip of their own, and that scene still needs its toggle right.
      if (hasCameraRef.current) {
        const live = engineRef.current?.isCameraVmdEnabled() ?? false
        if (live !== followingRef.current) {
          followingRef.current = live
          setFollowing(live)
          onFollowingChangeRef.current?.(live)
        }
      }
      const m = master()
      if (!m) {
        // Every clip removed: clear the frozen last progress (time + duration), otherwise
        if (last.current !== 0 || last.duration !== 0 || last.playing || last.paused) {
          last = { current: 0, duration: 0, playing: false, paused: false }
          setProgress(last)
          paintBar(0, 0, true)
        }
        return
      }
      const p = m.getAnimationProgress()
      // Only STRUCTURAL changes touch React; the advancing clock goes straight
      // to the DOM above, so playback re-renders nothing.
      if (p.duration !== last.duration || p.playing !== last.playing || p.paused !== last.paused) {
        last = { current: p.current, duration: p.duration, playing: p.playing, paused: p.paused }
        setProgress(last)
      }
      if (!draggingRef.current) {
        currentRef.current = p.current
        paintBar(p.current, p.duration)
      }
      if (loopRef.current && !p.playing && !p.paused && p.duration > 0 && p.current >= p.duration - AT_END_EPS) {
        // Restart the whole cast together — end → frame 0 teleports every bone,
        // so re-seed the bodies onto the new pose rather than letting them
        // stretch across the discontinuity.
        for (const model of cast()) model.seek(0)
        engineRef.current?.resetPhysics()
        paintBar(0, p.duration, true)
        for (const model of cast()) model.play()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineRef, namesKey])

  const toggle = () => {
    const m = master()
    if (!m) return
    const p = m.getAnimationProgress()
    if (p.playing) {
      for (const model of cast()) model.pause()
    } else if (p.paused) {
      for (const model of cast()) model.play() // resume from where each was paused
    } else if (p.duration > 0) {
      // Clip loaded but stopped (ended, or scrubbed while stopped).
      if (p.current >= p.duration - AT_END_EPS) {
        for (const model of cast()) model.seek(0)
        engineRef.current?.resetPhysics() // same end → 0 teleport as the loop path
      }
      // `play()` keeps currentFrame — `play(clip)` would reset to 0 (from-start bug).
      for (const model of cast()) model.play()
    }
  }

  // Space toggles play/pause globally (unless typing in a field).
  const toggleRef = useRef(toggle)
  useEffect(() => {
    toggleRef.current = toggle
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return
      const t = e.target as HTMLElement | null
      // Let a focused control handle space natively (button/slider/field)
      if (t && (["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(t.tagName) || t.isContentEditable)) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // A seek teleports every rigid body from wherever it was to wherever the new
  // pose puts it, and the solver reads that as enormous velocity — hair and
  // skirts detonate. Resetting fixes it, but resetting on every scrub event
  // would fight a smooth drag, which needs no help: step by step the bodies
  // track the pose fine.
  //
  // So what is measured is the largest SINGLE step of the interaction, not how
  // far it travelled in total. Dragging slowly across the whole clip is a
  // thousand small steps and resets nothing; clicking the far end of the track
  // is one big step and resets once, on release.
  // A scrub past this is a teleport rather than motion, and the bodies want
  // re-seeding once the user lets go — not on every step of the drag, which
  // would fight a slow scrub that the simulation tracks perfectly well.
  const biggestStep = useRef(0)
  const seek = (v: number) => {
    biggestStep.current = Math.max(biggestStep.current, Math.abs(v - currentRef.current))
    currentRef.current = v
    for (const model of cast()) model.seek(v)
    paintBarRef.current(v, master()?.getAnimationProgress().duration ?? 0, true)
  }
  const endSeek = () => {
    draggingRef.current = false
    if (biggestStep.current > SEEK_SETTLE_SECONDS) engineRef.current?.resetPhysics()
    biggestStep.current = 0
  }
  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    const m = master()
    if (!track || !m) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    seek(ratio * m.getAnimationProgress().duration)
  }

  // Reassigned every render rather than on a dep list: `seek` and `endSeek` are
  // plain closures over this render's props, and a stale one would seek the cast
  // the transport had a moment ago.
  useEffect(() => {
    if (!scrubRef) return
    scrubRef.current = {
      begin: () => {
        draggingRef.current = true
      },
      to: seek,
      end: endSeek,
    }
    return () => {
      scrubRef.current = null
    }
  })

  const hasClip = modelNames.length > 0
  // Camera follow, loop, and whatever the host appended. Built once and placed
  // in whichever row is actually on screen: the pill's, when collapsed, or the
  // editor's toolbar, when open. `btn` is the only thing that differs — a
  // size-7 pill button is taller than the 26px toolbar it would land in.
  const btn = unfolded
    ? "size-5 shrink-0 rounded-chip"
    : "size-7 shrink-0 rounded-full"
  const ico = unfolded ? "size-3.5" : "size-4"
  const chrome = (
    <>
      {hasCamera && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(btn, following ? "text-blue-400" : "text-muted-foreground hover:text-foreground")}
              onClick={toggleCamera}
            >
              {following ? <Video className={ico} /> : <Orbit className={ico} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{following ? t.transport.followCamera : t.transport.freeOrbit}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(btn, loop ? "text-blue-400" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setLoop((v) => !v)}
          >
            {loop ? <Repeat className={ico} strokeWidth={2.4} /> : <RepeatOff className={ico} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{loop ? t.transport.loopOn : t.transport.loopOff}</TooltipContent>
      </Tooltip>
      {trailing}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={cn(
        // The fold animates THROUGH the blur, which measurably costs frames —
        // the decision to keep it anyway (visual consistency with the shipped
        // chrome) is recorded on --color-surface in globals.css.
        "border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-xs",
        // ONE radius in both states, and deliberately not rounded-full.
        //
        // rounded-full is 9999px that the browser CLAMPS to half the box. It
        // renders as a pill, but animating it to a panel radius interpolates the
        // real number: 9999 → 16 only drops under half the height in the last
        // fraction of a percent, so the corner stays fully round for the whole
        // transition and then snaps at the end. That is the "big round shape
        // first, wrapper after" — the radius was not following the box.
        //
        // 20px is just over half the COLLAPSED row (py-1 around size-7, plus
        // borders = 38), so it clamps to a perfect pill there and is simply a
        // 20px corner once open. Track the collapsed padding if that changes, or
        // the pill turns back into a rounded rectangle.
        "rounded-[1.25rem]",
        // The editor inside has square corners and its toolbar paints a solid
        // background right up to them, so without this it covers the radius and
        // the open panel reads as a rectangle. Clipping to the root is also what
        // lets the fold reveal the canvas from behind a rounded edge instead of
        // over one. Tooltips and popovers portal out, so nothing that needs to
        // escape is caught by it.
        "overflow-hidden",
      )}
    >
      {/* The pill's own row, and it exists only while the pill does.
          Open, every control in it is either duplicated by the editor's toolbar
          (play, step, the frame readout) or meaningless at that scale (a
          whole-scene scrub bar sitting above a frame-accurate one), so rather
          than hide four things individually the row folds away as one — same
          0fr→1fr grid trick and the same curve as the editor opening below it,
          so the two read as ONE box changing shape instead of a row leaving
          while a panel arrives.

          Its chrome does not go with it: camera and loop still mean something
          open, and they reappear at the end of the editor's toolbar. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          unfolded ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
      <div className="overflow-hidden" inert={unfolded}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1 transition-opacity ease-out",
          unfolded ? "opacity-0 duration-150" : "opacity-100 duration-300",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full hover:bg-white/5 hover:text-foreground disabled:opacity-40"
          disabled={!hasClip}
          onClick={toggle}
        >
          {progress.playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </Button>
        <span ref={timeRef} className="shrink-0 text-xs leading-none text-muted-foreground tabular-nums">
          {fmt(0)}
        </span>
        {/* Ref-driven bar: transform-only updates from the rAF tick — never a
            re-render. Styled identically to the ui Slider it replaced (bg-muted
            track h-1, primary range, size-2.5 bordered white thumb). */}
        <div
          ref={trackRef}
          className={cn(
            // min-width + grow, not a fixed width: in a shrink-to-fit parent the
            // basis floor IS the width, so the shipped pill is unchanged, while
            // in a full-width one the track takes the slack instead of leaving
            // it at the end of the row.
            //
            // The floor is viewport-relative for a reason — at 375px it is 30vw
            // = 112px, which puts the whole row at ~294px and fits a phone. It
            // is NOT what made the pill overflow; a container inset 40.5rem for
            // the docks was (see the transport's placement in page.tsx). Moving
            // this to a flex-basis to "let it shrink" only bought a track
            // squeezed to nothing on a mid-size window.
            "relative mx-1 flex h-4 min-w-[min(16rem,30vw)] flex-1 touch-none items-center select-none",
            hasClip ? "cursor-pointer" : "opacity-50",
          )}
          onPointerDown={(e) => {
            if (!hasClip) return
            draggingRef.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            seekFromPointer(e)
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromPointer(e)
          }}
          onPointerUp={() => endSeek()}
          onPointerCancel={() => endSeek()}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 w-full origin-left bg-primary"
              style={{ transform: "scaleX(0)" }}
            />
          </div>
          <div
            ref={thumbRef}
            className="absolute top-1/2 left-0 size-2.5 rounded-full border border-primary bg-white shadow-sm ring-ring/50 hover:ring-2"
            style={{ transform: "translate(-50%, -50%)" }}
          />
        </div>
        <span className="shrink-0 text-xs leading-none text-muted-foreground tabular-nums">{fmt(progress.duration)}</span>
        {!unfolded && chrome}
      </div>
      </div>
      </div>
      {typeof below === "function"
        ? below({ chrome: unfolded ? chrome : null, playing: progress.playing, togglePlay: toggle })
        : below}
    </div>
  )
})
