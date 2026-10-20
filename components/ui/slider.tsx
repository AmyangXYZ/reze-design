"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCover } from "@/components/ui/cover"

type SliderVariant = "default" | "hairline"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  accent,
  origin,
  track,
  variant: variantProp,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** `hairline`: a 1px ink rule and a slim ink tick, for rows set straight on
   *  the canvas rather than inside a panel. The default on the cover. Its
   *  sizes are marked important so a row's own track or thumb size cannot
   *  thicken it. */
  variant?: SliderVariant
  /** Paint the fill and the thumb this colour instead of the primary. For axis
   *  rows, where the hue IS the axis and a row of identical blue sliders would
   *  say nothing about which one is X. */
  accent?: string
  /** Value the fill grows FROM, when that is not the track's start. A bone's
   *  rotation is signed, so a bar that always grows from the left implies a
   *  magnitude when what the number means is a direction from zero. */
  origin?: number
  /** A CSS background for the track itself, with no fill drawn over it. For a
   *  colour channel, where the track IS the scale — the colours the thumb
   *  would give at every point — and a fill would hide half of it. */
  track?: string
}) {
  const cover = useCover()
  const variant = variantProp ?? (cover ? "hairline" : "default")
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
          "relative grow overflow-hidden rounded-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
          variant === "hairline"
            ? "bg-line-strong data-[orientation=horizontal]:h-px! data-[orientation=vertical]:w-px!"
            : "bg-muted data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
        )}
        style={track ? { background: track } : undefined}
      >
        {track ? null : origin == null ? (
          <SliderPrimitive.Range
            data-slot="slider-range"
            className={cn(
              "absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
              variant === "hairline" ? "bg-foreground" : "bg-primary"
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
              backgroundColor: accent ?? (variant === "hairline" ? "var(--color-foreground)" : "var(--color-primary)"),
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
          // The THUMB is the element with role="slider", so its name has to
          // arrive here — on the Root it names a plain span and no reader ever
          // hears it. Radix takes an enclosing <Label> as the other route; a
          // slider whose label is a bare <span>, which is every one of ours,
          // has only this.
          aria-label={props["aria-label"]}
          className={cn(
            "block shrink-0 rounded-full focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50",
            variant === "hairline"
              // A 2×12 tick that holds its size and takes no ring while held
              // (rows add one for the default thumb), with a 16px hit area
              // around it so the slim mark is still easy to catch.
              ? "relative h-3! w-0.5! bg-foreground shadow-none! ring-0! hover:ring-0! before:absolute before:-inset-x-[7px] before:-inset-y-[3px] before:content-[''] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              : "size-4 border border-primary bg-white shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4"
          )}
          style={accent ? { backgroundColor: accent, borderColor: accent } : undefined}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
