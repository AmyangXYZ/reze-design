"use client"

// Persistent bottom transport: play/pause · scrub · time · loop.

import { memo, useEffect, useRef, useState, type RefObject } from "react"
import { cn } from "@/lib/utils"
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

// Memoized: props are stable across unrelated Home re-renders (e.g.
export const AnimPlayer = memo(function AnimPlayer({
  engineRef,
  modelNames,
  hasCamera,
  onFollowingChange,
}: {
  engineRef: RefObject<Engine | null>
  /** Models WITH a loaded clip, master (longest clip) first. */
  modelNames: string[]
  /** A camera VMD is loaded — show the Follow/Free toggle. */
  hasCamera: boolean
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
  const fillRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const currentRef = useRef(0)
  const draggingRef = useRef(false)
  const paintBarRef = useRef<(current: number, duration: number, snap?: boolean) => void>(() => {})
  // Whether the loaded camera VMD is currently driving the view (vs. free orbit).
  const [following, setFollowing] = useState(true)
  // Camera VMD is default-on when loaded — mirror the engine's actual state.
  useEffect(() => {
    if (!hasCamera) return
    const live = engineRef.current?.isCameraVmdEnabled() ?? true
    setFollowing(live)
    onFollowingChange?.(live)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCamera, engineRef])
  const toggleCamera = () => {
    const engine = engineRef.current
    if (!engine) return
    const next = !following
    // Free orbit is FAITHFUL: the orbit still holds the framing the scene's
    // author stored (applied at load, untouched while the VMD drives), so
    // toggling off simply returns to it — no recentering, no manipulation.
    engine.setCameraVmdEnabled(next)
    onFollowingChange?.(next)
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
    const ro = new ResizeObserver((entries) => {
      trackW = entries[0]?.contentRect.width ?? track0?.clientWidth ?? 0
    })
    if (track0) {
      trackW = track0.clientWidth
      ro.observe(track0)
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
      if (!snap && now - lastPaintMs < MIN_PAINT_MS) return
      lastPaintMs = now
      const ratio = duration > 0 ? Math.min(1, current / duration) : 0
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${ratio})`
      if (thumbRef.current) thumbRef.current.style.transform = `translateX(${ratio * trackW}px) translate(-50%, -50%)`
      if (timeRef.current && now - lastLabel > 250) {
        lastLabel = now
        timeRef.current.textContent = fmt(current)
      }
    }
    paintBarRef.current = paintBar
    const tick = () => {
      raf = requestAnimationFrame(tick)
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

  const hasClip = modelNames.length > 0
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 py-1 pr-3 pl-3 shadow-float backdrop-blur-xs">
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
          "relative mx-1 flex h-4 w-[min(16rem,30vw)] touch-none items-center select-none",
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
      {hasCamera && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={following ? "size-7 shrink-0 rounded-full text-blue-400" : "size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"}
              onClick={toggleCamera}
            >
              {following ? <Video className="size-4" /> : <Orbit className="size-4" />}
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
            className={loop ? "size-7 shrink-0 rounded-full text-blue-400" : "size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground"}
            onClick={() => setLoop((v) => !v)}
          >
            {loop ? <Repeat className="size-4" strokeWidth={2.4} /> : <RepeatOff className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{loop ? t.transport.loopOn : t.transport.loopOff}</TooltipContent>
      </Tooltip>
    </div>
  )
})
