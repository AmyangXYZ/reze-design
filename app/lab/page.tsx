"use client"

// The 0.4.0 chrome, built fresh rather than adapted.
//
// A visual shell: the real engine, the real scene, the real hooks — but the
// handlers that would make every control work still live in app/page.tsx, so
// anything needing one is inert here. That is the point. Whether a collapsed row
// naming its preset reads better than today's docks is a question you answer by
// looking, and it is worth answering before 59 callbacks get consolidated around
// the answer.
//
// Reference: docs/design/chrome-study.html. Rules: AGENTS.md.
//
// What differs from the study, deliberately: there is no View/Compose/Edit
// switch. The study said "depth, not modes" and then shipped three mode buttons.
// One collapse toggle instead — collapsed IS the view state, so "what a share
// link renders" stops being a mode anybody has to maintain.

import { useState } from "react"
import {
  Camera,
  ChevronDown,
  Clapperboard,
  Cloud,
  Command,
  Contrast,
  Music,
  Mountain,
  PanelLeftClose,
  PanelLeft,
  Play,
  Repeat,
  Sparkles,
  Sun,
  WandSparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Surface } from "@/components/editor/surface"
import { LayerRow, PresetChips, StackGroup } from "@/components/editor/layer-row"
import { SliderRow } from "@/components/scene/scene-sidebar"
import { useEngine } from "@/hooks/use-engine"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import { hydrateScene } from "@/lib/scene"
import { cn } from "@/lib/utils"

/** Each layer's presets. Static here — the real stack reads these from the
 *  document and the libraries; the shell only needs them to have names. */
const LAYERS = [
  { id: "camera", name: "Camera", icon: Camera, presets: ["Wide", "Portrait", "Low angle", "Follow"] },
  { id: "stage", name: "Stage", icon: Mountain, presets: [] },
  { id: "background", name: "Background", icon: Cloud, presets: ["Shining Stars", "Aurora", "Rain", "None"] },
  { id: "light", name: "Light", icon: Sun, presets: ["Soft key", "Golden hour", "Stage", "Rim only"] },
  { id: "bloom", name: "Bloom", icon: Sparkles, presets: ["Gentle", "Dreamy", "Hard", "Off"] },
  { id: "grade", name: "Grade", icon: Contrast, presets: ["Neutral", "Warm film", "Cool night", "Bleach"] },
  { id: "music", name: "Music", icon: Music, presets: [] },
] as const

export default function Lab() {
  const [scene] = useState(() => hydrateScene(DEFAULT_SCENE))
  const { canvasRef, error } = useEngine(scene)

  // Only one row open at a time — that is what lets presets-then-parameters sit
  // inside a row without the stack becoming a wall of sliders.
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({
    camera: "Wide",
    background: "Shining Stars",
    light: "Soft key",
    bloom: "Gentle",
    grade: "Neutral",
  })
  const [expanded, setExpanded] = useState(true)

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      {/* Full bleed, always. Chrome floats over it; nothing ever shrinks the
          thing you are making. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {error && (
        <div className="absolute inset-0 grid place-items-center p-8 text-center text-xs text-muted-foreground">
          {error}
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex items-center gap-2">
        <Surface placement="float" className="pointer-events-auto static flex-row items-center gap-2 px-2.5 py-1.5">
          <WandSparkles className="size-4 text-pink-400" />
          <span className="text-xs font-semibold tracking-tight">Reze</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-xs text-muted-foreground">My first scene</span>
        </Surface>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse panels" : "Show panels"}
          className="pointer-events-auto size-8 rounded-interior border border-line-strong bg-surface text-muted-foreground shadow-float hover:text-foreground"
        >
          {expanded ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
        </Button>

        <span className="flex-1" />

        {/* The palette's visible door. Keyboard-only would make it invisible to
            the people most likely to miss it, and it is the only route on touch. */}
        <Button
          variant="ghost"
          className="pointer-events-auto h-8 gap-2 rounded-interior border border-line-strong bg-surface px-3 text-xs text-muted-foreground shadow-float hover:text-foreground"
        >
          <Command className="size-3.5" />
          Search anything
          <kbd className="rounded-chip border border-line-strong bg-white/5 px-1 py-px font-mono text-[10px]">⌘K</kbd>
        </Button>
        <Button size="sm" className="pointer-events-auto h-8 rounded-interior bg-blue-400 px-3.5 text-xs font-semibold text-[#06131f] hover:bg-blue-300">
          Share
        </Button>
      </div>

      {/* ── The stack ── */}
      <Surface
        placement="float"
        className={cn(
          "top-14 left-3 max-h-[calc(100%-8.5rem)] w-[17rem] overflow-hidden transition-all duration-200",
          !expanded && "pointer-events-none -translate-x-3 opacity-0",
        )}
      >
        <div className="min-h-0 overflow-y-auto">
          <StackGroup label="Cast">
            <div className="flex items-center gap-2.5 px-3 py-2">
              <span className="size-6 shrink-0 rounded-interior bg-gradient-to-br from-purple-200 via-purple-400 to-violet-700" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs">苍鹭·托特「扉页之吻」</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">One More Last Time.vmd</span>
              </span>
            </div>
          </StackGroup>

          <StackGroup label="Scene">
            {LAYERS.map((l) => (
              <LayerRow
                key={l.id}
                icon={l.icon}
                name={l.name}
                summary={picked[l.id] ?? "—"}
                open={openRow === l.id}
                onToggle={() => setOpenRow((r) => (r === l.id ? null : l.id))}
              >
                {l.presets.length > 0 && (
                  <PresetChips
                    options={[...l.presets]}
                    value={picked[l.id] ?? null}
                    onPick={(name) => setPicked((p) => ({ ...p, [l.id]: name }))}
                  />
                )}
                {/* Placeholder parameters — the shell is judging the row, not
                    the controls, and these are wired to nothing. */}
                <SliderRow label="Amount" value={0.5} min={0} max={1} step={0.01} onChange={() => {}} fmt={(v) => v.toFixed(2)} />
              </LayerRow>
            ))}
          </StackGroup>
        </div>
      </Surface>

      {/* ── Transport ── */}
      <Surface placement="sheet" className="w-[min(34rem,80%)] px-3.5 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground hover:text-foreground">
            <Play className="size-3.5" />
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">0:04</span>
          <span className="relative flex h-3.5 flex-1 items-center">
            <span className="h-[3px] w-full overflow-hidden rounded-full bg-white/15">
              <span className="block h-full w-[26%] bg-white/75" />
            </span>
            <span className="absolute top-1/2 left-[26%] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </span>
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">0:16</span>
          <Button variant="ghost" size="icon" className="size-7 rounded-full text-blue-400 hover:text-blue-300">
            <Repeat className="size-3.5" />
          </Button>
          {/* Expansion unfolds BENEATH this row in the real thing, so the play
              button your hand already knows never moves. */}
          <Button variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </Surface>

      {/* Marks the route as the shell it is, so nobody mistakes it for the app. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
        <Clapperboard className="size-3" />
        lab — layout shell, controls inert
      </div>
    </main>
  )
}
