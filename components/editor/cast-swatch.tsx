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
      className={cn("relative size-5 shrink-0 overflow-hidden rounded-interior", className)}
      // The deep stop lands at 72%, not 100%: past that the square is solid
      // colour. Running the ramp to the far corner left the whole swatch in
      // transition, which reads as pale whatever the two ends are.
      style={{ backgroundImage: `linear-gradient(145deg, ${from} 0%, ${to} 72%)` }}
      aria-hidden
    >
      {/* One soft light from above, and nothing that DEPICTS shininess. A hard
          gloss stop, a specular dot and a shaded floor were tried together and
          read as a Flash-era glass button — three skeuomorphic cues stacked.
          What reads considered is the opposite: a broad low wash you only miss
          when it is gone. */}
      <span
        className="absolute inset-0"
        style={{ backgroundImage: "radial-gradient(90% 70% at 30% 0%, rgb(255 255 255 / 0.16), transparent 68%)" }}
      />
      {/* Inset hairline rather than a border, so the gradient runs to the very
          edge instead of being framed by it. The single brighter pixel along
          the top edge is the one machined detail — an edge catching light,
          which is as far as the shine goes. */}
      <span className="absolute inset-0 rounded-interior shadow-[inset_0_1px_0_rgb(255_255_255/0.28)] ring-1 ring-white/15 ring-inset" />
    </span>
  )
}
