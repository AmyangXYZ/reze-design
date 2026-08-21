"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  accent,
  origin,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Paint the fill and the thumb this colour instead of the primary. For axis
   *  rows, where the hue IS the axis and a row of identical blue sliders would
   *  say nothing about which one is X. */
  accent?: string
  /** Value the fill grows FROM, when that is not the track's start. A bone's
   *  rotation is signed, so a bar that always grows from the left implies a
   *  magnitude when what the number means is a direction from zero. */
  origin?: number
}) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        )}
      >
        {origin == null ? (
          <SliderPrimitive.Range
            data-slot="slider-range"
            className={cn(
              "absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
            )}
            style={accent ? { backgroundColor: accent } : undefined}
          />
        ) : (
          // Radix's own Range always spans from the track's start, so an
          // origin-anchored fill has to be drawn rather than styled. Plain
          // percentages of the track: the thumb is still Radix's, so the two
          // cannot disagree about where the value is.
          <div
            data-slot="slider-range"
            className="absolute h-full"
            style={{
              backgroundColor: accent ?? "var(--color-primary)",
              left: `${((Math.min(_values[0] ?? origin, origin) - min) / (max - min)) * 100}%`,
              width: `${(Math.abs((_values[0] ?? origin) - origin) / (max - min)) * 100}%`,
            }}
          />
        )}
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="block size-4 shrink-0 rounded-full border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
