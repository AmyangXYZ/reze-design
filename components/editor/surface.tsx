"use client"

// The one chrome surface, in four placements.
//
// Every panel, dialog and popover in the editor is the same skin — zinc-950
// ground, a visible white/10 hairline, shadow-float, 10px radius. What differs
// is where it sits and whether it takes the screen. Writing that skin per
// component is how five surfaces end up with four different border opacities,
// so it lives here once and placement is a prop.
//
// The rule that decides placement, and the only one a reader needs:
//
//   SCRIM      = the canvas is not part of this task   (publish, export setup)
//   NO SCRIM   = watch the canvas while you work       (materials, editors,
//                                                       libraries)
//
// Corner radii follow the approved scale: 10 for the surface, 6 for anything
// inside it, 4 for chips. Smaller reads as more professional; 12+ does not.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The docks' own recipe — bg-surface behind a backdrop-blur. The blur's cost
 * over a live canvas is real and was measured; the decision to keep it anyway
 * is recorded on --color-surface in globals.css.
 */
const SKIN = "border border-line-strong bg-surface shadow-float backdrop-blur-xs"

export type SurfacePlacement =
  /** Centred over a scrim. A decision to commit or abandon. */
  | "center"
  /** Pinned to the right edge, canvas live. What you are editing right now. */
  | "side"
  /** Free-floating window, position owned by the caller (see useStoredRect). */
  | "float"
  /** Bottom-centred strip. Transport, and jobs that are running. */
  | "sheet"

const PLACEMENT: Record<SurfacePlacement, string> = {
  center: "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-surface",
  // Insets rather than full height: the surface floats over the canvas, it does
  // not become a wall beside it.
  //
  // 16rem is the right COLUMN — the same width the left dock states and the same
  // width the top-right pill cluster states, all three anchored to the same
  // insets so their edges coincide without anyone measuring anyone. It was 19rem
  // here while both callers passed 18, which is a default that only ever
  // described a panel nobody built.
  //
  // Four sites state this number and two more are derived from it (the working
  // area and the open timeline's cap, both in app/page.tsx). They are coupled by
  // arithmetic, not by a token, so changing one means changing all six.
  // text-xs is the dock's BASE, not a per-element choice: most text in a panel
  // carries no size class at all and was inheriting the document's, which at
  // this width is a different typographic scale from the one the panel was
  // designed at. Set here so the exceptions are the things that state a size —
  // the wordmark and the chips — rather than the rule being restated on every
  // span. Primitives that carry their own size (Button, Input) still win, and
  // are overridden per instance.
  side: "absolute top-3 right-3 bottom-3 w-[16rem] rounded-surface flex flex-col text-xs",
  float: "absolute rounded-surface flex flex-col",
  sheet: "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-surface",
}

export function Surface({
  placement = "center",
  className,
  children,
  ...rest
}: {
  placement?: SurfacePlacement
  className?: string
  children: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(SKIN, PLACEMENT[placement], className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * The dim behind a centred surface.
 *
 * Only ever paired with `center`. If you are reaching for a scrim on a side or
 * float surface, the task wants the canvas and the placement is wrong.
 */
export function Scrim({ onClose }: { onClose?: () => void }) {
  return <div className="absolute inset-0 z-20 bg-scrim" onClick={onClose} />
}

/**
 * A titled block inside a surface, with an optional action on the heading's own
 * line. The action belongs to everything below it, so it sits with the heading
 * rather than trailing the last control — and it is always rendered, going inert
 * instead of vanishing, so the row never changes height as values move.
 */
export function SurfaceSection({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("mt-4 first:mt-0", className)}>
      <div className="mb-2 flex h-5 items-center justify-between">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}
