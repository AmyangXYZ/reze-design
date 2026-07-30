"use client"

// Scene panel (chromeless). Grade and Background lead — they're the two-click way to
// change everything — with the lighting and appearance sections below them.

import { memo } from "react"
import { Palette, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ColorField } from "@/components/color-picker"
import { rememberIntensity } from "@/lib/grade"
import { QuickPick, type QuickPickItem } from "@/components/scene/quick-pick"
import { useT } from "@/lib/i18n"
import type { SceneSettings } from "@/lib/scene-settings"
import type { SceneCamera } from "@/lib/scene"
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
      {/* w-16 fits the longest label ("Saturation") */}
      <span className="w-16 shrink-0 truncate text-xs">{label}</span>
      <Slider
        className="min-w-0 flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
      <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{fmt ? fmt(value) : value}</span>
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

// Memoized for the same keep-alive reason as AssetsPanel/MaterialsPanel
export const ScenePanel = memo(function ScenePanel({
  settings,
  onChange,
  camera,
  onCameraChange,
  cameraDriven,
  effectName,
  onOpenEffects,
  gradeName,
  gradeValue,
  gradeItems,
  onPickGrade,
  onOpenGrades,
  onEditGrade,
  effectItems,
  onPickEffect,
  onEditEffect,
  onReset,
}: {
  settings: SceneSettings
  onChange: (settings: SceneSettings) => void
  camera: SceneCamera
  onCameraChange: (camera: SceneCamera) => void
  /** True while a camera motion is driving the shot, which overrides these values. */
  cameraDriven?: boolean
  /** Applied background-effect name (null = none) — the row opens the library. */
  effectName: string | null
  onOpenEffects: () => void
  /** Display name of the applied grade (built-in label or the user's own). */
  gradeName: string
  /** Quick-switch entries — the fast path beside the full library. */
  /** Resolved selection id — an applied user grade maps back to its library entry. */
  gradeValue: string
  gradeItems: QuickPickItem[]
  onPickGrade: (id: string) => void
  onOpenGrades: () => void
  /** Open the grade editor on whatever is applied. */
  onEditGrade: () => void
  effectItems: QuickPickItem[]
  onPickEffect: (id: string) => void
  /** Open the WGSL editor on the applied effect — absent when none is applied. */
  onEditEffect?: () => void
  /** Restore EVERYTHING this panel governs to the scene document's values. */
  onReset: () => void
}) {
  const t = useT()
  const { background, ground, world, sun, bloom, grade } = settings
  const patch = <K extends keyof SceneSettings>(key: K, value: Partial<SceneSettings[K]>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...value } })
  const setTarget = (axis: 0 | 1 | 2, v: number) => {
    const target: SceneCamera["target"] = [...camera.target]
    target[axis] = v
    onCameraChange({ ...camera, target })
  }
  const oneDp = (v: number) => v.toFixed(1)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section
          title={t.scene.grade}
          action={
            <button
              onClick={onOpenGrades}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
            >
              <Palette className="size-3.5" />
              {t.materials.library}
            </button>
          }
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0 text-xs">{t.scene.preset}</span>
            {/* Value text is a quick-switch list; the pill above opens the full library with previews. */}
            {/* Neutral is a CHOICE, not an absence — it reads blue like any other applied value. */}
            <QuickPick
              value={gradeValue}
              items={gradeItems}
              onPick={onPickGrade}
              onBrowse={onOpenGrades}
              onEdit={onEditGrade}
              editLabel={t.gradeLibrary.edit}
              placeholder={gradeName}
            />
          </div>
          {/* Intensity is remembered PER grade, so switching looks restores the strength you last used */}
          <div className={cn("mt-1", grade.preset === "Neutral" && "pointer-events-none opacity-40")}>
            <SliderRow
              label={t.scene.intensity}
              value={grade.intensity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => {
                patch("grade", { intensity: v })
                // Remembered per preset, so switching back restores this strength.
                rememberIntensity(grade.preset, v)
              }}
              fmt={(v) => v.toFixed(2)}
            />
          </div>
        </Section>

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
            <QuickPick
              value={effectName}
              items={effectItems}
              onPick={onPickEffect}
              onBrowse={onOpenEffects}
              onEdit={onEditEffect}
              editLabel={t.bgLibrary.editShader}
              placeholder={t.scene.noEffect}
            />
          </div>
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

        <Section title={t.scene.bloom} action={<ColorField value={bloom.color} onChange={(hex) => patch("bloom", { color: hex })} />}>
          {/* No on/off switch — intensity 0 IS off (page.tsx maps it to enabled:false, skipping */}
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

        <Section title={t.scene.ground}>
          <ColorRow label={t.scene.color} value={ground.color} onChange={(hex) => patch("ground", { color: hex })} />
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

        <Section title={t.scene.camera}>
          <SliderRow
            label={t.scene.distance}
            value={camera.distance}
            min={1}
            max={100}
            step={0.1}
            onChange={(v) => onCameraChange({ ...camera, distance: v })}
            fmt={oneDp}
          />
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <SliderRow
              key={axis}
              label={`${t.scene.target} ${axis}`}
              value={camera.target[i]}
              min={i === 1 ? -10 : -50}
              max={i === 1 ? 50 : 50}
              step={0.1}
              onChange={(v) => setTarget(i as 0 | 1 | 2, v)}
              fmt={oneDp}
            />
          ))}
          {cameraDriven && <p className="mt-2 text-[11px] text-muted-foreground/70">{t.scene.cameraVmdNote}</p>}
        </Section>

        {/* Undo/redo is keyboard-only (⌘/Ctrl+Z, ⇧⌘Z via useHistory) */}
        <div className="-mx-4 mt-4 flex items-center gap-1 border-t border-white/10 px-4 pt-2">
          {/* Reset restores the CURATED first-open look — the "default" users actually met */}
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
