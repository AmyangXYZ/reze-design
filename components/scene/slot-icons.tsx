// Style-slot icons. Custom SVGs drawn in lucide's language (24-grid, stroke-2,
// round caps) where lucide has no good fit: hair as flowing strands, cloth as
// fabric swatches (smooth wave vs. rough cross-hatch), a sock for stockings,
// stacked ingots for metal. The dashed circle stays the fallback mark for the
// default slot.

import type { ComponentType } from "react"
import type { MaterialPreset } from "reze-engine"
import { CircleDashed, CircleDot, Smile, User } from "lucide-react"

type IconProps = { className?: string }

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const

export function HairIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M6 3q2 4.5 0 9t0 9" />
      <path d="M12 3q2 4.5 0 9t0 9" />
      <path d="M18 3q2 4.5 0 9t0 9" />
    </svg>
  )
}

export function SmoothClothIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M6.5 14c3-5 8 3 11-2" />
    </svg>
  )
}

export function RoughClothIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M5 13l8-8" />
      <path d="M7 19L19 7" />
      <path d="M13 19l6-6" />
    </svg>
  )
}

export function StockingIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={className}>
      <path d="M8.5 3h7v8l3 2a4.3 4.3 0 1 1-6 6l-4-4V3Z" />
      <path d="M8.5 7h7" />
    </svg>
  )
}

export function MetalIcon({ className }: IconProps) {
  // A thick coin — top face plus cylinder body, like a milled piece of metal.
  return (
    <svg {...svgProps} className={className}>
      <ellipse cx="12" cy="8.5" rx="8" ry="3.5" />
      <path d="M4 8.5v6.5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V8.5" />
    </svg>
  )
}

/** Blender-style material sphere: circle with checkered quadrants. */
export function MaterialSphereIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12V3.5A8.5 8.5 0 0 1 20.5 12Z" fill="currentColor" stroke="none" />
      <path d="M12 12v8.5A8.5 8.5 0 0 1 3.5 12Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export const SLOT_ICONS: Partial<Record<MaterialPreset, ComponentType<IconProps>>> = {
  hair: HairIcon,
  body: User,
  face: Smile,
  // Iris-style ring, distinct from the Eye used for the visibility toggle.
  eye: CircleDot,
  cloth_smooth: SmoothClothIcon,
  cloth_rough: RoughClothIcon,
  stockings: StockingIcon,
  metal: MetalIcon,
  default: CircleDashed,
}
