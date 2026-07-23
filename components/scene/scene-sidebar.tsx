"use client"

// Scene panel (chromeless): world / sun / bloom lighting and scene appearance
// colors. Lives in the LEFT dock's "Scene" tab now. Model / animation / music
// uploads moved to the Assets tab. The Section / SliderRow / ColorRow helpers
// are exported so the Assets panel and right dock can reuse the same rows.

import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ColorField } from "@/components/color-picker"
import { ENGINE_DEFAULT_SCENE_SETTINGS, type SceneSettings } from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

export function SliderRow({
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
    <div className="mt-2.5 flex items-center gap-2 first:mt-0">
      <span className="w-14 shrink-0 truncate text-xs">{label}</span>
      <Slider
        className="flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
      <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{fmt ? fmt(value) : value}</span>
    </div>
  )
}

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  // Full-bleed hairline between sections (-mx cancels the panel padding).
  return (
    <div className="-mx-4 mt-4 border-t border-white/10 px-4 pt-3.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="mt-2.5 flex items-center justify-between first:mt-0">
      <span className="text-xs">{label}</span>
      <ColorField value={value} onChange={onChange} />
    </div>
  )
}

export function ScenePanel({
  settings,
  onChange,
}: {
  settings: SceneSettings
  onChange: (settings: SceneSettings) => void
}) {
  const { colors, world, sun, bloom } = settings
  const patch = <K extends keyof SceneSettings>(key: K, value: Partial<SceneSettings[K]>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...value } })

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title="World" action={<ColorField value={world.color} onChange={(hex) => patch("world", { color: hex })} />}>
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

        <Section title="Sun" action={<ColorField value={sun.color} onChange={(hex) => patch("sun", { color: hex })} />}>
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

        <Section title="Bloom" action={<ColorField value={bloom.color} onChange={(hex) => patch("bloom", { color: hex })} />}>
          <div className="flex items-center justify-between">
            <span className="text-xs">Enabled</span>
            <Switch checked={bloom.enabled} onCheckedChange={(v) => patch("bloom", { enabled: v })} className="scale-75" />
          </div>
          <div className={cn("mt-2.5", !bloom.enabled && "pointer-events-none opacity-40")}>
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

        {/* Reset to the app's curated defaults (not the engine's neutral ones). */}
        <div className="-mx-4 mt-4 border-t border-white/10 px-4 pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(ENGINE_DEFAULT_SCENE_SETTINGS)}
          >
            <RotateCcw className="size-3" />
            Reset to defaults
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
