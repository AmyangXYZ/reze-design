"use client"

// One channel of a pose: a coloured bar you drag and a number you can type.
//
// Ported from reze-studio. The part that matters, and the part that is easy to
// throw away when porting, is the PREVIEW/COMMIT split: `onChange` fires on
// every tick of a drag and `onCommit` once when the pointer lifts. The caller
// uses that to keep a drag off React entirely — the preview path mutates the
// clip and pushes it to the engine, and only the commit clones a clip, notifies
// the store and lands a step in history.
//
// `localValue` exists for the same reason. A preview that deliberately does not
// commit leaves the `value` prop stale mid-drag, and a controlled Radix slider
// fed a stale value snaps its thumb back under the pointer. So the thumb follows
// the local number while dragging and the prop the rest of the time.

import { memo, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export const AxisSliderRow = memo(function AxisSliderRow({
  axis,
  color,
  value,
  min,
  max,
  decimals,
  inputMin = -Infinity,
  inputMax = Infinity,
  origin = 0,
  disabled,
  onChange,
  onCommit,
}: {
  axis: string
  color: string
  value: number
  min: number
  max: number
  decimals: number
  /** What a TYPED value may reach. min/max is the range you drag through; the
   *  field is how you reach a number worth having but not worth a third of the
   *  track. Unbounded unless a caller names a limit. */
  inputMin?: number
  inputMax?: number
  /** Where the fill grows from. Zero for a signed channel; pass `min` for one
   *  that only counts up, like a morph weight. */
  origin?: number
  disabled?: boolean
  /** Every drag tick — preview path, must NOT commit. */
  onChange: (v: number) => void
  /** Once, on pointer-up — commit path: history, and one engine upload. */
  onCommit?: (v: number) => void
}) {
  const step = useMemo(() => (decimals <= 2 ? 10 ** -decimals : 10 ** -4), [decimals])
  // State, not a ref: a ref READ during render is what this repo's lint forbids,
  // and the value is being used to render. Setting it on every tick is free —
  // React bails out when the value is unchanged.
  const [dragging, setDragging] = useState(false)
  const [localValue, setLocalValue] = useState(value)
  /**
   * The number just committed, held until a fresh sample agrees with it.
   *
   * Without this the row FLASHED on release. Releasing drops `dragging`, so the
   * row goes back to reading the `value` prop — but that prop is sampled from
   * the engine on a rAF, so for exactly one paint it is still the number from
   * before the drag. The eye catches it: drag to 30, let go, see 12, then 30.
   *
   * Holding the committed value across that gap is honest rather than
   * cosmetic — the clip does hold it, and the sample that lands next frame is
   * what confirms it. When a fresh `value` arrives this clears and the prop
   * wins again, so a value the engine genuinely disagrees with (a bone under
   * an IK chain, a clamped channel) still corrects itself.
   */
  const [pending, setPending] = useState<number | null>(null)
  // The prop as of the last render, so a CHANGE in it can be noticed during
  // render — the documented way to adjust state from props, and the one that
  // does not need a ref.
  const [lastValue, setLastValue] = useState(value)
  if (lastValue !== value) {
    setLastValue(value)
    setPending(null)
    if (!dragging) setLocalValue(value)
  }
  const shown = dragging ? localValue : (pending ?? value)
  // A draft string while the field is focused, so intermediate states like "-",
  // "3." and "-0.0" survive a keystroke instead of being formatted away.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (v: number) => {
    setDragging(false)
    setLocalValue(v)
    setPending(v)
    ;(onCommit ?? onChange)(v)
  }

  return (
    // reze-studio's row, which is the density this panel is trying to reach:
    // gap-1.5 rather than gap-2, 10px type, and a mono readout. A pose row is
    // read as a COLUMN of numbers — six of them, changing together — and mono
    // at 10px is what makes that column scan. The left dock's rows are single
    // named values you read one at a time, which is why theirs are looser.
    // mt, not mb: the space belongs BETWEEN rows, not after every one. A
    // trailing margin on the last row is added to the next group's own pt, so
    // the gap above Translation came out 6px wider than the gap above Rotation
    // — one spacing value, applied consistently, still producing two.
    <div className={cn("mt-1.5 flex items-center gap-1.5 first:mt-0", disabled && "pointer-events-none opacity-40")}>
      {/* The left dock's row label exactly — text-xs, normal weight — with the
          axis hue as the only difference. It has been both too heavy (11px
          semibold, where the weight and the colour together made three letters
          the loudest ink in the row) and too quiet (10px). Body size at normal
          weight is what "Ground opacity" and "Camera distance" are, and an
          axis is the same kind of thing: the name of the value beside it.
          w-8 rather than their w-16 — these are letters, not words, and the
          widest is "Dist". */}
      <span className="w-8 shrink-0 truncate text-xs" style={{ color }}>
        {axis}
      </span>
      <Slider
        // The left dock's slider, character for character — same thumb, same
        // track, same hover ring. The ring came back with it: it is the only
        // hover affordance the control has, and dropping it was an accident of
        // shrinking the thumb rather than a decision.
        className="min-w-0 flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
        // Parked at the end of the track while the value is past it, so a typed
        // number the track cannot reach does not get reported back as an edit.
        value={[clamp(shown, min, max)]}
        min={min}
        max={max}
        step={step}
        accent={color}
        origin={clamp(origin, min, max)}
        disabled={disabled}
        aria-label={`${axis} axis`}
        onValueChange={([v]) => {
          setDragging(true)
          const next = clamp(v ?? min, min, max)
          setLocalValue(next)
          onChange(next)
        }}
        onValueCommit={([v]) => {
          const next = clamp(v ?? min, min, max)
          setLocalValue(next)
          commit(next)
        }}
      />
      <Input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        // The left dock's VALUE_BOX: borderless until it is being typed into,
        // which is what keeps a column of numbers from reading as a column of
        // input fields.
        // A field, the way studio draws it: mono, 10px, right-aligned, on a
        // faint ground that says it can be typed into. `dark:bg-*` is stated
        // explicitly because the Input primitive paints `dark:bg-input/30` —
        // a base-layer `bg-*` cannot cancel a dark-layer one, so both survive
        // the merge and the dark one wins.
        className="h-5 w-13 shrink-0 rounded-chip border-line bg-white/[0.04] px-1 py-0 text-right font-mono text-[10px] tabular-nums shadow-none focus-visible:border-blue-400/50 focus-visible:ring-0 md:text-[10px] dark:bg-white/[0.04] dark:focus-visible:bg-white/[0.07]"
        style={{ color }}
        value={draft ?? (Number.isFinite(shown) ? shown.toFixed(decimals) : "")}
        onFocus={(e) => {
          setDraft(Number.isFinite(shown) ? shown.toFixed(decimals) : "")
          e.currentTarget.select()
        }}
        onChange={(e) => {
          const s = e.target.value
          setDraft(s)
          // Comma decimals accepted: a European keyboard types one and the
          // number it means is unambiguous here.
          const x = parseFloat(s.replace(/,/g, "."))
          if (Number.isFinite(x)) {
            setDragging(true)
            const next = clamp(x, inputMin, inputMax)
            setLocalValue(next)
            onChange(next)
          }
        }}
        onBlur={() => {
          setDraft(null)
          if (dragging) commit(localValue)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
})
