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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ColorField } from "@/components/color-picker"
import { GRADE_PRESETS, resolveGrade } from "@/lib/grade"
import { useT } from "@/lib/i18n"
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
      {/* w-16 fits the longest label ("Saturation"); truncate stays as the
          safety net for a future longer one or a wider translation. */}
      <span className="w-16 shrink-0 truncate text-xs">{label}</span>
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
  onReset,
}: {
  settings: SceneSettings
  onChange: (settings: SceneSettings) => void
  /** Applied background-effect name (null = none) — the row opens the library. */
  effectName: string | null
  onOpenEffects: () => void
  /** Restore EVERYTHING this panel governs to the demo defaults — all settings
   *  sections AND the background effect (owned by page state, so the panel
   *  can't reset it through onChange alone — the original "reset didn't clear
   *  the effect" bug). */
  onReset: () => void
}) {
  const t = useT()
  const { background, ground, world, sun, bloom, grade } = settings
  // What the engine actually receives — the readout below shows it.
  const cdl = resolveGrade(grade)
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

        {/* Grade: the LOOK layer — ASC CDL on the tonemapped scene (engine
            setColorGrading). The three tonal controls are colors, not sliders,
            because the craft control here is "which way do I push this tonal
            range" — mid-gray is neutral and distance from it is the amount, so
            there's no separate strength slider to keep in sync. The background
            layer stays ungraded by design (see composite.ts). */}
        <Section
          title={t.scene.grade}
          action={
            /* The look lives here; "Neutral" is the first entry, so this is also
               the reset. No "Custom" state to derive — the preset IS the stored
               value now, not something reverse-engineered from nine numbers. */
            <Select
              /* Fall back if a saved scene names a preset we've since retired —
                 resolveGrade already does the same, so the two agree. */
              value={GRADE_PRESETS.some((p) => p.id === grade.preset) ? grade.preset : "neutral"}
              onValueChange={(id) => patch("grade", { preset: id })}
            >
              <SelectTrigger className="-my-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t.scene.gradePresets[p.id as keyof typeof t.scene.gradePresets]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          {/* iOS Photos' shape: a look, then how much of it. Dimmed rather than
              hidden on Neutral — hiding it would jump the panel's height. */}
          <div className={cn(grade.preset === "neutral" && "pointer-events-none opacity-40")}>
            <SliderRow
              label={t.scene.intensity}
              value={grade.intensity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch("grade", { intensity: v })}
              fmt={(v) => v.toFixed(2)}
            />
          </div>
          {/* READ-ONLY resolution of preset × intensity into the engine's three
              CDL range tints. Without it, switching presets changed the scene
              while every number in the panel stayed put — no confirmation of
              what a preset actually did. Dragging Intensity now visibly washes
              these toward neutral grey. Not editable on purpose: per-range
              editing is the wheels we removed. */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                [t.scene.shadows, cdl.shadows],
                [t.scene.midtones, cdl.midtones],
                [t.scene.highlights, cdl.highlights],
              ] as const
            ).map(([label, hex]) => (
              <div key={label} className="min-w-0 text-center">
                <div className="mx-auto h-3.5 w-12 rounded-[3px] ring-1 ring-white/10" style={{ backgroundColor: hex }} />
                {/* Value sits with the swatch it describes; the name reads last.
                    Hex uses ColorField's treatment (font-mono, muted) so the two
                    readouts share one vocabulary across the panel. */}
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{hex}</div>
                <div className="truncate text-[10px] text-foreground">{label}</div>
              </div>
            ))}
          </div>

          {/* Your adjustment ON TOP of the preset (1 = leave the preset alone),
              the way Photos' Adjust panel composes over its Filters strip. Both
              ranges are symmetric about 1, so the thumbs align when untouched. */}
          <SliderRow
            label={t.scene.contrast}
            value={grade.contrast}
            min={0.5}
            max={1.5}
            step={0.01}
            onChange={(v) => patch("grade", { contrast: v })}
            fmt={(v) => v.toFixed(2)}
          />
          <SliderRow
            label={t.scene.saturation}
            value={grade.saturation}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => patch("grade", { saturation: v })}
            fmt={(v) => v.toFixed(2)}
          />
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
              "Neutral" preset). Lives in page.tsx (onReset) because it spans
              panel-external state (the background effect). */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onReset}
          >
            <RotateCcw className="size-3" />
            {t.scene.resetDefaults}
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
})
