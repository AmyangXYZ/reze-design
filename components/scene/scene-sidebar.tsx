"use client"

// Figma-style right sidebar: scene/world tools. Top section loads a local PMX
// model folder and a VMD animation; below it, world / sun / bloom lighting and
// the scene appearance colors. Collapsible like the materials sidebar on the
// left — the page swaps it with a floating icon button at the same y.

import { FolderUp, Clapperboard, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ColorField } from "@/components/color-picker"
import { type SceneSettings } from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
}) {
  // Single line: label · slider · value.
  return (
    <div className="mt-1.5 flex items-center gap-2 first:mt-0">
      <span className="w-16 shrink-0 text-xs text-zinc-500">{label}</span>
      <Slider
        className="flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
      <span className="w-10 shrink-0 text-right text-xs text-zinc-400 tabular-nums">{fmt ? fmt(value) : value}</span>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  // Full-bleed hairline between sections (-mx cancels the panel padding).
  return (
    <div className="-mx-3 mt-3 border-t border-white/5 px-3 pt-2.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-xs font-medium tracking-[0.16em] text-zinc-400 uppercase">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="mt-1.5 flex items-center justify-between first:mt-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <ColorField value={value} onChange={onChange} />
    </div>
  )
}

export function SceneSidebar({
  settings,
  onChange,
  onCollapse,
  onUploadModel,
  onUploadAnimation,
  player,
}: {
  settings: SceneSettings
  onChange: (settings: SceneSettings) => void
  onCollapse: () => void
  onUploadModel: () => void
  onUploadAnimation: () => void
  /** Transport controls for the loaded VMD clip (null when none is loaded). */
  player: React.ReactNode
}) {
  const { colors, world, sun, bloom } = settings
  const patch = <K extends keyof SceneSettings>(key: K, value: Partial<SceneSettings[K]>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...value } })

  return (
    <aside className="flex min-h-0 w-64 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/60 shadow-2xl backdrop-blur-sm">
      <header className="flex items-center gap-1 px-3 py-2">
        <div className="min-w-0 flex-1 text-xs font-medium text-zinc-300">Scene</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6 text-zinc-500 hover:text-zinc-200" onClick={onCollapse}>
              <PanelRightClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse</TooltipContent>
        </Tooltip>
      </header>
      <Separator className="bg-white/5" />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <Section title="Model">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 gap-1.5 border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                onClick={onUploadModel}
              >
                <FolderUp className="size-3" />
                PMX folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 gap-1.5 border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
                onClick={onUploadAnimation}
              >
                <Clapperboard className="size-3" />
                VMD motion
              </Button>
            </div>
            {player}
          </Section>

          <Section
            title="World"
            action={<ColorField value={world.color} onChange={(hex) => patch("world", { color: hex })} />}
          >
            <SliderRow
              label="Strength"
              value={world.strength}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => patch("world", { strength: v })}
              fmt={(v) => v.toFixed(2)}
            />
          </Section>

          <Section
            title="Sun"
            action={<ColorField value={sun.color} onChange={(hex) => patch("sun", { color: hex })} />}
          >
            <SliderRow
              label="Strength"
              value={sun.strength}
              min={0}
              max={6}
              step={0.05}
              onChange={(v) => patch("sun", { strength: v })}
              fmt={(v) => v.toFixed(2)}
            />
            <SliderRow
              label="Azimuth"
              value={sun.azimuth}
              min={0}
              max={360}
              step={1}
              onChange={(v) => patch("sun", { azimuth: v })}
              fmt={(v) => `${v}°`}
            />
            <SliderRow
              label="Elevation"
              value={sun.elevation}
              min={0}
              max={90}
              step={1}
              onChange={(v) => patch("sun", { elevation: v })}
              fmt={(v) => `${v}°`}
            />
          </Section>

          <Section
            title="Bloom"
            action={
              <span className="flex items-center gap-2">
                <ColorField value={bloom.color} onChange={(hex) => patch("bloom", { color: hex })} />
                <Switch
                  checked={bloom.enabled}
                  onCheckedChange={(v) => patch("bloom", { enabled: v })}
                  className="scale-75"
                />
              </span>
            }
          >
            <div className={cn(!bloom.enabled && "pointer-events-none opacity-40")}>
              <SliderRow
                label="Threshold"
                value={bloom.threshold}
                min={0}
                max={2}
                step={0.01}
                onChange={(v) => patch("bloom", { threshold: v })}
                fmt={(v) => v.toFixed(2)}
              />
              <SliderRow
                label="Knee"
                value={bloom.knee}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => patch("bloom", { knee: v })}
                fmt={(v) => v.toFixed(2)}
              />
              <SliderRow
                label="Radius"
                value={bloom.radius}
                min={0}
                max={8}
                step={0.1}
                onChange={(v) => patch("bloom", { radius: v })}
                fmt={(v) => v.toFixed(1)}
              />
              <SliderRow
                label="Intensity"
                value={bloom.intensity}
                min={0}
                max={1}
                step={0.005}
                onChange={(v) => patch("bloom", { intensity: v })}
                fmt={(v) => v.toFixed(3)}
              />
            </div>
          </Section>

          <Section title="Colors">
            <ColorRow label="Background" value={colors.background} onChange={(hex) => patch("colors", { background: hex })} />
            <ColorRow label="Ground" value={colors.ground} onChange={(hex) => patch("colors", { ground: hex })} />
            <ColorRow label="Grid lines" value={colors.grid} onChange={(hex) => patch("colors", { grid: hex })} />
          </Section>
        </div>
      </ScrollArea>
    </aside>
  )
}
