"use client"

// Shared row primitives for the scene controls: a labelled slider, a section
// heading, a colour row. The panel that used to live here went with the 0.4.0
// chrome — these are what the dock's rows are built from.

import { useState } from "react"
import { Slider } from "@/components/ui/slider"
import { ColorField } from "@/components/color-picker"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The value column, shared by its readout and its editor so switching between
 *  them moves nothing. `p-0` is load-bearing: browsers pad an input by default,
 *  and `leading-4` pins the text to the same baseline the span sits on.
 *
 *  Exported because a typed number should look the same everywhere it appears —
 *  the plane row's size boxes are the same control in a different arrangement,
 *  and a second definition of it would drift on the first tweak. */
export const VALUE_BOX =
  "block h-4 w-10 shrink-0 rounded border bg-transparent p-0 text-right text-[11px] leading-4 tabular-nums"

export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  inputMin = -Infinity,
  inputMax = Infinity,
  onChange,
  fmt,
  disabled,
  dense,
  labelClass,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** What a TYPED value may reach. The slider's own min/max is the range you
   *  drag through — the range worth having under the thumb — and a stage that
   *  needs to sit 300 units out should not be limited to the range that makes
   *  the track useful. Unbounded unless a caller names a limit. */
  inputMin?: number
  inputMax?: number
  onChange: (v: number) => void
  fmt?: (v: number) => string
  disabled?: boolean
  /** Tighter row spacing, for a popover rather than the dock's own column: a
   *  panel hanging off a row is read as one control, and the dock's breathing
   *  room reads as three. */
  dense?: boolean
  /** Override the label column. The dock's labels are words it chose; an
   *  effect's are WGSL identifiers its author chose, and they are longer. */
  labelClass?: string
}) {
  // Double-click the value to type one. The slider stays the primary control —
  // it is what you reach for while judging a look — and typing is there for the
  // times you already know the number. Same gesture as renaming a scene or a
  // style group, so it needs no affordance of its own.
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const commit = (raw: string) => {
    setEditing(false)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    // Stepped, then held to the TYPED range rather than the track's. Typing is
    // how you reach a number the track does not cover; clamping it back to the
    // track made the field a slower way to use the slider.
    const stepped = Math.round(parsed / step) * step
    const clamped = Math.min(inputMax, Math.max(inputMin, stepped))
    if (clamped !== value) onChange(Number(clamped.toFixed(6)))
  }

  // Single line: label · slider · value.
  return (
    <div
      className={cn(
        "flex items-center first:mt-0",
        dense ? "mt-1.5 gap-1.5" : "mt-2.5 gap-2",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {/* w-16 fits the longest label ("Saturation"); dense rows carry an axis
          and a word, and w-10 is what "Pos X" needs. */}
      <span className={cn("shrink-0 truncate", dense ? "text-[11px]" : "text-xs", labelClass ?? (dense ? "w-10" : "w-16"))}>
        {label}
      </span>
      <Slider
        className="min-w-0 flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        // Parked at the end of the track while the value is past it. Radix
        // clamps an out-of-range value anyway; doing it here keeps the thumb
        // from reporting the clamp back as an edit.
        value={[Math.min(max, Math.max(min, value))]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
      />
      {/* ONE element for both states. A span that becomes an input can never be
          pixel-identical — the input reserves caret space and centres its text
          by its own rules, so the value stepped a hair on every double-click.
          The same input in both states cannot drift: read-only it shows the
          formatted value, editable it shows the raw draft, and only the border
          colour and readOnly change. */}
      <input
        readOnly={!editing}
        value={editing ? draft : String(fmt ? fmt(value) : value)}
        title={editing ? undefined : t.scene.typeValue}
        onDoubleClick={(e) => {
          if (editing) return
          setDraft(String(value))
          setEditing(true)
          requestAnimationFrame(() => (e.target as HTMLInputElement).select())
        }}
        onChange={(e) => editing && setDraft(e.target.value)}
        onBlur={() => editing && commit(draft)}
        onKeyDown={(e) => {
          if (!editing) return
          if (e.key === "Enter") e.currentTarget.blur()
          else if (e.key === "Escape") setEditing(false)
        }}
        className={cn(
          VALUE_BOX,
          "outline-none",
          dense && "w-8 text-[10px]",
          editing
            ? "border-blue-400/50 bg-white/5 text-foreground"
            : "cursor-text border-transparent text-muted-foreground select-none",
        )}
      />
    </div>
  )
}

/** The bone the camera follows. センター is the body's root in every standard MMD
 *  rig, so it tracks travel without inheriting the bob of a spine or a head. */
export const FOLLOW_BONE = "センター"
/** Defaults for the two meanings of the target triple: as an OFFSET from the
 *  followed bone (センター already sits at hip height, so only a small lift) and
 *  as an ABSOLUTE point (the scene default framing). */
export const FOLLOW_OFFSET_DEFAULT: [number, number, number] = [0, 3, 0]
export const TARGET_DEFAULT: [number, number, number] = [0, 11.4, 0]

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

export function ColorRow({
  label,
  value,
  onChange,
  dense,
  labelClass,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  /** The tighter rhythm and type size SliderRow's dense rows use, so a colour
   *  and a number sitting in one panel read as one list rather than two. */
  dense?: boolean
  labelClass?: string
}) {
  return (
    <div className={cn("flex items-center justify-between first:mt-0", dense ? "mt-1.5 gap-1.5" : "mt-2.5")}>
      <span className={cn("shrink-0 truncate", dense ? "text-[11px]" : "text-xs", labelClass)}>{label}</span>
      <ColorField value={value} onChange={onChange} />
    </div>
  )
}
