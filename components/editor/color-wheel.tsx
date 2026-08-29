"use client"

// Color-grading wheel — the instrument every grading tool uses (Resolve's Lift/Gamma/Gain

import { useCallback, useRef } from "react"
import { HexField } from "@/components/color-picker"
import { hexToHsl, hslToHex, type Range } from "@/lib/grade"

// Muted ring: the wheel is a map, not a subject.
const RING = [0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 45% 50%)`).join(", ")
const WHEEL_BG = [
  "radial-gradient(circle closest-side, rgba(128,128,128,1) 0%, rgba(128,128,128,0) 100%)",
  `conic-gradient(from 90deg, ${RING})`,
].join(", ")

// Lightness travels a rail rather than the full 0..1: the ends are crush and blowout,
// where a range stops grading and starts flattening. A typed hex lands on the rail too.
const L_MIN = 0.24
const L_MAX = 0.76

// Hue 0 at 3 o'clock increasing clockwise, matching `from 90deg` above
const toXY = (h: number, r: number) => ({
  x: 0.5 + Math.cos((h * Math.PI) / 180) * r * 0.5,
  y: 0.5 + Math.sin((h * Math.PI) / 180) * r * 0.5,
})

export function ColorWheel({
  label,
  value,
  resolved,
  onChange,
  size = 96,
}: {
  label: string
  value: Range
  /** The CDL color this range resolves */
  resolved?: string
  onChange: (next: Range) => void
  size?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hue, sat, lightness = 0.5] = value
  const pos = toXY(hue, Math.min(1, sat))
  const swatch = hslToHex(hue, sat, lightness)
  const neutral = sat < 0.005 && Math.abs(lightness - 0.5) < 0.005

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const dx = clientX - (r.left + r.width / 2)
      const dy = clientY - (r.top + r.height / 2)
      const dist = Math.min(1, Math.hypot(dx, dy) / (r.width / 2))
      // Dead zone keeps "drag back to neutral" reliably reachable.
      if (dist < 0.06) {
        onChange([0, 0, lightness])
        return
      }
      const h = (((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360
      onChange([h, dist, lightness])
    },
    [onChange, lightness],
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
      <div className="flex w-full items-baseline justify-between gap-1 px-0.5">
        <span className="truncate text-[11px] font-medium text-zinc-200">{label}</span>
        {/* Numbers alongside the instrument */}
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
          {neutral ? "—" : `${Math.round(hue)}° ${Math.round(sat * 100)}%`}
        </span>
      </div>

      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(sat * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        // Full brightness always: dimming made sense in the dock, where three wheels competed
        className="relative shrink-0 cursor-crosshair touch-none rounded-full ring-1 ring-white/10"
        style={{ width: size, height: size, background: WHEEL_BG }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pick(e.clientX, e.clientY)
        }}
        // Resolve's convention: double-click a wheel to reset it.
        onDoubleClick={() => onChange([0, 0, 0.5])}
      >
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, backgroundColor: swatch }}
        />
      </div>

      {/* Lightness rail — horizontal, because a vertical one beside the wheel fought the column */}
      <input
        type="range"
        aria-label={`${label} lightness`}
        min={L_MIN}
        max={L_MAX}
        step={0.01}
        value={lightness}
        onChange={(e) => onChange([hue, sat, Number(e.target.value)])}
        className="h-1 w-full max-w-32 cursor-pointer appearance-none rounded-full bg-gradient-to-r from-zinc-900 via-zinc-500 to-zinc-200 accent-blue-400"
      />

      {resolved && (
        // A proper swatch CELL, the same shape as the colour picker's — and the hex under
        // it is the field, so a colour from a reference frame or a palette goes in directly.
        <div className="flex flex-col items-center gap-1">
          <div className="h-6 w-16 rounded-md ring-1 ring-white/10" style={{ backgroundColor: resolved }} />
          <HexField
            value={resolved}
            onChange={(hex) => {
              const hsl = hexToHsl(hex)
              if (hsl) onChange([hsl[0], hsl[1], Math.min(L_MAX, Math.max(L_MIN, hsl[2]))])
            }}
            className="h-5 w-16 px-1 text-center text-[10px]"
          />
        </div>
      )}
    </div>
  )
}
