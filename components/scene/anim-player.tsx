"use client"

// Minimal VMD transport: play/pause, scrub, time, auto-loop, stop — one row.
// Progress is polled per animation frame (the engine advances the clip in its
// render loop), with a change check so the component is idle while paused.
// Loop is handled here rather than via play options so toggling it mid-playback
// never restarts the clip.

import { useEffect, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { Pause, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

const AT_END_EPS = 0.02

type Progress = { current: number; duration: number; playing: boolean; paused: boolean }

export function AnimPlayer({
  engineRef,
  modelName,
  clipName,
  onStop,
}: {
  engineRef: RefObject<Engine | null>
  modelName: string
  clipName: string
  onStop: () => void
}) {
  const [progress, setProgress] = useState<Progress>({ current: 0, duration: 0, playing: true, paused: false })
  const [loop, setLoop] = useState(true)
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  })
  // While scrubbing, the local value wins over the polled one.
  const [dragVal, setDragVal] = useState<number | null>(null)

  useEffect(() => {
    let raf = 0
    let last: Progress = { current: -1, duration: -1, playing: false, paused: false }
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const model = engineRef.current?.getModel(modelName)
      if (!model) return
      const p = model.getAnimationProgress()
      if (
        p.current !== last.current ||
        p.duration !== last.duration ||
        p.playing !== last.playing ||
        p.paused !== last.paused
      ) {
        last = { current: p.current, duration: p.duration, playing: p.playing, paused: p.paused }
        setProgress(last)
      }
      // Manual auto-loop: when the timeline idles at the end, restart.
      if (loopRef.current && !p.playing && !p.paused && p.duration > 0 && p.current >= p.duration - AT_END_EPS) {
        model.seek(0)
        model.play()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engineRef, modelName])

  const toggle = () => {
    const model = engineRef.current?.getModel(modelName)
    if (!model) return
    const p = model.getAnimationProgress()
    if (p.playing) {
      model.pause()
    } else if (p.paused) {
      model.play() // resume from where it paused
    } else {
      // Idle — either never started or finished; from the end, restart.
      if (p.duration > 0 && p.current >= p.duration - AT_END_EPS) model.seek(0)
      model.play(clipName)
    }
  }

  const seek = (v: number) => {
    setDragVal(v)
    engineRef.current?.getModel(modelName)?.seek(v)
  }

  const current = dragVal ?? progress.current

  return (
    <div className="mt-2 rounded-lg border border-white/5 bg-white/[0.03] px-1.5 py-1.5" title={clipName}>
      {/* Transport row: play · scrubber · time */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-zinc-300 hover:text-zinc-100"
          onClick={toggle}
        >
          {progress.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Slider
          className="flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
          value={[current]}
          min={0}
          max={Math.max(progress.duration, 0.01)}
          step={0.01}
          onValueChange={([v]) => seek(v)}
          onValueCommit={() => setDragVal(null)}
        />
        <span className="shrink-0 text-xs text-zinc-500 tabular-nums">
          {fmt(current)}/{fmt(progress.duration)}
        </span>
      </div>

      {/* Options row: loop · remove, grouped near the center */}
      <div className="flex items-center justify-center gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
          <Checkbox
            checked={loop}
            onCheckedChange={(v) => setLoop(v === true)}
            className="size-3 rounded-[3px] border-white/20 [&_svg]:size-2"
          />
          loop
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-zinc-500 hover:text-red-400"
              onClick={onStop}
            >
              <Trash2 className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove — back to bind pose</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
