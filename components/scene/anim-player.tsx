"use client"

// Persistent bottom transport: play/pause · scrub · time · loop. reze-design is a
// finishing tool, not an animation editor — this drives a finished VMD clip (and
// a synced music track), it does not edit keyframes. Progress is polled per frame
// with a change check, so it's idle while paused. Space toggles play/pause
// (reze-engine-web parity). Removing the clip lives in the Assets tab, not here.

import { useEffect, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { Pause, Play, Repeat, RepeatOff } from "lucide-react"
import { Button } from "@/components/ui/button"
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
}: {
  engineRef: RefObject<Engine | null>
  modelName: string
  clipName: string
}) {
  const [progress, setProgress] = useState<Progress>({ current: 0, duration: 0, playing: false, paused: false })
  const [loop, setLoop] = useState(true)
  const loopRef = useRef(loop)
  useEffect(() => {
    loopRef.current = loop
  })
  const [dragVal, setDragVal] = useState<number | null>(null)

  useEffect(() => {
    let raf = 0
    let last: Progress = { current: -1, duration: -1, playing: false, paused: false }
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const model = engineRef.current?.getModel(modelName)
      if (!model) return
      const p = model.getAnimationProgress()
      if (p.current !== last.current || p.duration !== last.duration || p.playing !== last.playing || p.paused !== last.paused) {
        last = { current: p.current, duration: p.duration, playing: p.playing, paused: p.paused }
        setProgress(last)
      }
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
    if (p.playing) model.pause()
    else if (p.paused) model.play()
    else {
      if (p.duration > 0 && p.current >= p.duration - AT_END_EPS) model.seek(0)
      model.play(clipName)
    }
  }

  // Space toggles play/pause globally (unless typing in a field). Latest-ref so
  // the listener is registered once but always calls the current toggle.
  const toggleRef = useRef(toggle)
  useEffect(() => {
    toggleRef.current = toggle
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return
      const t = e.target as HTMLElement | null
      // Let a focused control handle space natively (button/slider/field);
      // our global toggle only fires when focus is on the canvas/body.
      if (t && (["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(t.tagName) || t.isContentEditable)) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const seek = (v: number) => {
    setDragVal(v)
    engineRef.current?.getModel(modelName)?.seek(v)
  }

  const current = dragVal ?? progress.current

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 py-1 pr-3 pl-3 shadow-float backdrop-blur-xs"
      title={clipName}
    >
      <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full hover:bg-white/5 hover:text-foreground" onClick={toggle}>
        {progress.playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </Button>
      <span className="shrink-0 text-xs leading-none text-muted-foreground tabular-nums">{fmt(current)}</span>
      <Slider
        className="w-64 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        value={[current]}
        min={0}
        max={Math.max(progress.duration, 0.01)}
        step={0.01}
        onValueChange={([v]) => seek(v)}
        onValueCommit={() => setDragVal(null)}
      />
      <span className="shrink-0 text-xs leading-none text-muted-foreground tabular-nums">{fmt(progress.duration)}</span>
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
        <TooltipContent side="top">Loop {loop ? "on" : "off"}</TooltipContent>
      </Tooltip>
    </div>
  )
}
