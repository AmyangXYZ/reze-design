"use client"

// Scene panel (chromeless): world / sun / bloom lighting and scene appearance
// colors. Lives in the LEFT dock's "Scene" tab now. Model / animation / music /
// backdrop uploads live in the Assets tab. The Section / SliderRow / ColorRow
// helpers are exported so the Assets panel and right dock can reuse the same rows.

import { memo } from "react"
import { RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ColorField } from "@/components/color-picker"
import { useT } from "@/lib/i18n"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import type { SceneSettings } from "@/lib/scene-settings"
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
    <div className="-mx-4 mt-3 border-t border-white/10 px-4 pt-2.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between">
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

// Memoized for the same keep-alive reason as AssetsPanel/MaterialsPanel: hidden
// tabs re-render with the page otherwise. When Scene IS the visible tab its
// `settings` prop changes per edit, so memo never blocks a real update.
export const ScenePanel = memo(function ScenePanel({
  settings,
  onChange,
  effectName,
  onOpenEffects,
}: {
  settings: SceneSettings
  onChange: (settings: SceneSettings) => void
  /** Applied background-effect name (null = none) — the row opens the library. */
  effectName: string | null
  onOpenEffects: () => void
}) {
  const t = useT()
  const { background, ground, world, sun, bloom } = settings
  const patch = <K extends keyof SceneSettings>(key: K, value: Partial<SceneSettings[K]>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...value } })

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title={t.scene.world} action={<ColorField value={world.color} onChange={(hex) => patch("world", { color: hex })} />}>
          <SliderRow
            label={t.scene.strength}
            value={world.strength}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => patch("world", { strength: v })}
            fmt={(v) => v.toFixed(2)}
          />
        </Section>

        <Section title={t.scene.sun} action={<ColorField value={sun.color} onChange={(hex) => patch("sun", { color: hex })} />}>
          <SliderRow
            label={t.scene.strength}
            value={sun.strength}
            min={0}
            max={6}
            step={0.05}
            onChange={(v) => patch("sun", { strength: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <SliderRow
            label={t.scene.azimuth}
            value={sun.azimuth}
            min={0}
            max={360}
            step={1}
            onChange={(v) => patch("sun", { azimuth: v })}
            fmt={(v) => `${v}°`}
          />
          <SliderRow
            label={t.scene.elevation}
            value={sun.elevation}
            min={0}
            max={90}
            step={1}
            onChange={(v) => patch("sun", { elevation: v })}
            fmt={(v) => `${v}°`}
          />
        </Section>

        <Section title={t.scene.bloom} action={<ColorField value={bloom.color} onChange={(hex) => patch("bloom", { color: hex })} />}>
          {/* No on/off switch — intensity 0 IS off (page.tsx maps it to enabled:false,
              skipping the bloom passes entirely). One less row in a long panel. */}
          <div>
            <SliderRow
              label={t.scene.threshold}
              value={bloom.threshold}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => patch("bloom", { threshold: v })}
              fmt={(v) => v.toFixed(2)}
            />
            <SliderRow
              label={t.scene.radius}
              value={bloom.radius}
              min={0}
              max={8}
              step={0.1}
              onChange={(v) => patch("bloom", { radius: v })}
              fmt={(v) => v.toFixed(1)}
            />
            <SliderRow
              label={t.scene.intensity}
              value={bloom.intensity}
              min={0}
              max={1}
              step={0.005}
              onChange={(v) => patch("bloom", { intensity: v })}
              fmt={(v) => v.toFixed(3)}
            />
          </div>
        </Section>

        {/* Ground: its own domain — color, opacity, shadow, grid; presets later. */}
        <Section title={t.scene.ground}>
          <ColorRow label={t.scene.color} value={ground.color} onChange={(hex) => patch("ground", { color: hex })} />
          <SliderRow
            label={t.scene.size}
            value={ground.size}
            min={40}
            max={400}
            step={10}
            onChange={(v) => patch("ground", { size: v })}
            fmt={(v) => v.toFixed(0)}
          />
          <SliderRow
            label={t.scene.opacity}
            value={ground.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => patch("ground", { opacity: v })}
            fmt={(v) => v.toFixed(2)}
          />
          {/* Shadow persists below opacity (shadow catcher) — this turns it off entirely. */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs">{t.scene.shadow}</span>
            <Switch
              checked={ground.shadow}
              onCheckedChange={(v) => patch("ground", { shadow: v })}
              className="scale-75"
            />
          </div>
          {/* Grid lines: toggle + color chip in one row (chip only while on). */}
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs">{t.scene.gridLines}</span>
            <div className="flex items-center gap-2">
              {ground.gridEnabled && (
                <ColorField value={ground.grid} onChange={(hex) => patch("ground", { grid: hex })} />
              )}
              <Switch
                checked={ground.gridEnabled}
                onCheckedChange={(v) => patch("ground", { gridEnabled: v })}
                className="scale-75"
              />
            </div>
          </div>
        </Section>


        {/* Background & effect — last section: the most advanced one. The Library
            pill lives in the SECTION TITLE row, mirroring the shader-graph
            library's placement in the materials inspector (same pill, same
            "Library" label — the sparkles icon is the only difference). Rows are
            values: base color, and the applied effect's name (a link into the
            same library). Image/360 uploads stay in the Assets tab for now —
            when the image layer moves here it becomes the third row. */}
        <Section
          title={t.scene.background}
          action={
            <button
              onClick={onOpenEffects}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
            >
              <Sparkles className="size-3.5" />
              {t.materials.library}
            </button>
          }
        >
          <ColorRow label={t.scene.color} value={background.color} onChange={(hex) => patch("background", { color: hex })} />
          <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0 text-xs">{t.scene.effects}</span>
            <button
              onClick={onOpenEffects}
              className={cn(
                "min-w-0 cursor-pointer truncate text-xs underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current",
                effectName ? "text-blue-400" : "text-muted-foreground/50",
              )}
            >
              {effectName ?? t.scene.noEffect}
            </button>
          </div>
        </Section>

        {/* Undo/redo is keyboard-only (⌘/Ctrl+Z, ⇧⌘Z via useHistory) — buttons
            added visual noise for a shortcut people reach for by habit anyway. */}
        <div className="-mx-4 mt-4 flex items-center gap-1 border-t border-white/10 px-4 pt-2">
          {/* Reset restores the CURATED first-open look — the "default" users
              actually met — not the engine's neutral gray, which only developers
              have seen (it stays exported in scene-settings for a future
              "Neutral" preset). */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(DEFAULT_SCENE.state.settings)}
          >
            <RotateCcw className="size-3" />
            {t.scene.resetDefaults}
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
})
