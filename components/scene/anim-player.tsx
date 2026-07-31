"use client"

// Persistent bottom transport: play/pause · scrub · time · loop.

import { memo, useEffect, useRef, useState, type RefObject } from "react"
import type { Engine, Model } from "reze-engine"
import { Orbit, Pause, Play, Repeat, RepeatOff, Video } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"

/** A single scrub step past this reads as a teleport rather than motion. Matches
 *  the discontinuity threshold the audio clock uses, so the two agree about what
 *  counts as a jump. */
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
}: {
  engineRef: RefObject<Engine | null>
  /** Models WITH a loaded clip, master (longest clip) first. */
  modelNames: string[]
  /** A camera VMD is loaded — show the Follow/Free toggle. */
  hasCamera: boolean
}) {
  const t = useT()
  const [progress, setProgress] = useState<Progress>({ current: 0, duration: 0, playing: false, paused: false })
  const [loop, setLoop] = useState(true)
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  })
  const [dragVal, setDragVal] = useState<number | null>(null)
  // Whether the loaded camera VMD is currently driving the view (vs. free orbit).
  const [following, setFollowing] = useState(true)
  // Camera VMD is default-on when loaded — mirror the engine's actual state.
  useEffect(() => {
    if (hasCamera) setFollowing(engineRef.current?.isCameraVmdEnabled() ?? true)
  }, [hasCamera, engineRef])
  const toggleCamera = () => {
    const engine = engineRef.current
    if (!engine) return
    const next = !following
    engine.setCameraVmdEnabled(next) // off falls back to orbit
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
    // No display quantum. The playhead is judged against a 60 Hz render, so any
    // throttle reads as stepping rather than sliding, whatever its size — a
    // clip-relative quantum only moves which durations look bad. `progress` is
    // local to this row and is passed to nothing, so updating per frame
    // re-renders one small subtree; and while nothing is playing `current` stops
    // changing, so the loop idles without touching state.
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const m = master()
      if (!m) {
        // Every clip removed: clear the frozen last progress (time + duration), otherwise
        if (last.current !== 0 || last.duration !== 0 || last.playing || last.paused) {
          last = { current: 0, duration: 0, playing: false, paused: false }
          setProgress(last)
        }
        return
      }
      const p = m.getAnimationProgress()
      if (p.current !== last.current || p.duration !== last.duration || p.playing !== last.playing || p.paused !== last.paused) {
        last = { current: p.current, duration: p.duration, playing: p.playing, paused: p.paused }
        setProgress(last)
      }
      if (loopRef.current && !p.playing && !p.paused && p.duration > 0 && p.current >= p.duration - AT_END_EPS) {
        // Restart the whole cast together — jumping end → frame 0 teleports every bone
        for (const model of cast()) model.seek(0)
        engineRef.current?.resetPhysics()
        for (const model of cast()) model.play()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
        engineRef.current?.resetPhysics() // same end→0 teleport as the loop path
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
  const biggestStep = useRef(0)
  const seek = (v: number) => {
    biggestStep.current = Math.max(biggestStep.current, Math.abs(v - (dragVal ?? progress.current)))
    setDragVal(v)
    for (const model of cast()) model.seek(v)
  }
  const endSeek = () => {
    setDragVal(null)
    if (biggestStep.current > SEEK_SETTLE_SECONDS) engineRef.current?.resetPhysics()
    biggestStep.current = 0
  }

  const current = dragVal ?? progress.current

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
      <span className="shrink-0 text-xs leading-none text-muted-foreground tabular-nums">{fmt(current)}</span>
      <Slider
        className="w-[min(16rem,30vw)] [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        value={[current]}
        min={0}
        max={Math.max(progress.duration, 0.01)}
        step={0.01}
        disabled={!hasClip}
        onValueChange={([v]) => seek(v)}
        onValueCommit={endSeek}
      />
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
