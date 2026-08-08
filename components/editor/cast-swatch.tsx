"use client"

// A model's identity mark in the cast list.
//
// Not a flat colour chip. A single averaged colour reads as a placeholder no
// matter how correct it is — the eye reads flat fill as "nothing here yet". Four
// cheap layers make it read as an object instead: a diagonal gradient between
// two stops, a soft highlight from the top-left, an inset hairline, and a faint
// sheen. None of it is decoration for its own sake; together they are what makes
// a 24px square look considered rather than reserved.
//
// The model's dominant costume hue picks one of a fixed set (lib/cast-palette);
// the gradient itself is always bright-to-deep within that one family. A model
// with no colour of its own gets the neutral.

import { castPalette, type CastPaletteId } from "@/lib/cast-palette"
import { cn } from "@/lib/utils"



export function CastSwatch({
  /** One of the fixed set. The caller resolves the model's hue to it. */
  palette,
  className,
}: {
  palette: CastPaletteId
  className?: string
}) {
  const { from, to } = castPalette(palette)
  return (
    <span
      className={cn("relative size-6 shrink-0 overflow-hidden rounded-interior", className)}
      // The deep stop lands at 72%, not 100%: past that the square is solid
      // colour. Running the ramp to the far corner left the whole swatch in
      // transition, which reads as pale whatever the two ends are.
      style={{ backgroundImage: `linear-gradient(145deg, ${from} 0%, ${to} 72%)` }}
      aria-hidden
    >
      {/* Light from the top-left, as everything else in the chrome is lit. A
          tight, bright core rather than a broad wash — a wash just lightens the
          colour, while a small hot spot reads as a surface catching light. */}
      <span
        className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(70% 60% at 26% 16%, rgb(255 255 255 / 0.22), transparent 70%)" }}
      />
      {/* A sheen across the upper half — what keeps it from reading as a sticker. */}
      <span
        className="absolute inset-x-0 top-0 h-1/2"
        style={{ backgroundImage: "linear-gradient(180deg, rgb(255 255 255 / 0.12), transparent)" }}
      />
      {/* Inset hairline rather than a border, so the gradient runs to the very
          edge instead of being framed by it. */}
      <span className="absolute inset-0 rounded-interior ring-1 ring-white/20 ring-inset" />
    </span>
  )
}
