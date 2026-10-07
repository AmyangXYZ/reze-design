// Shots by name: "a close-up from three-quarters" → an exact orbit camera.
//
// The agent chooses what a shot means; this computes where the camera goes,
// from where the character's bones actually are. The same rule as colour: the
// model makes the choice, code does the geometry.
//
// Orbit convention (lib/scene.ts): alpha π faces the character from the front,
// beta is measured from straight above — π/2 is eye level, less looks down,
// more looks up.

import type { CaptureView } from "@/lib/video-export"

export type Shot = "closeup" | "medium" | "full" | "wide"
export type Angle = "front" | "three-quarter-left" | "three-quarter-right" | "side-left" | "side-right" | "back" | "high" | "low"

export const SHOTS: readonly Shot[] = ["closeup", "medium", "full", "wide"]
export const ANGLES: readonly Angle[] = ["front", "three-quarter-left", "three-quarter-right", "side-left", "side-right", "back", "high", "low"]

/** World-space points on the character, from its bones. */
export type Figure = {
  /** Top of the head — above the 頭 bone, which sits at the skull's base. */
  head: [number, number, number]
  /** Chest height (上半身 / 上半身2). */
  chest: [number, number, number]
  /** Hips (センター). */
  hips: [number, number, number]
  /** Lowest foot. */
  feet: [number, number, number]
}

/** MMD's bone names for each point, first match wins. */
export const FIGURE_BONES = {
  head: ["頭"],
  chest: ["上半身2", "上半身"],
  hips: ["センター", "下半身"],
  feet: ["左足首", "右足首", "左つま先", "右つま先"],
} as const

/** How much of the figure each shot fits in frame, as [top, bottom] points and
 *  a margin — a close-up is the head and shoulders, a wide shot leaves room. */
function span(fig: Figure, shot: Shot): { top: number; bottom: number; center: [number, number, number]; margin: number } {
  const headTop = fig.head[1] + 1.4
  const x = fig.chest[0]
  const z = fig.chest[2]
  switch (shot) {
    case "closeup": {
      const bottom = fig.chest[1] - 0.5
      return { top: headTop, bottom, center: [x, (headTop + bottom) / 2, z], margin: 1.25 }
    }
    case "medium": {
      const bottom = fig.hips[1] - 1
      return { top: headTop, bottom, center: [x, (headTop + bottom) / 2, z], margin: 1.2 }
    }
    case "full": {
      const bottom = fig.feet[1]
      return { top: headTop, bottom, center: [x, (headTop + bottom) / 2, z], margin: 1.15 }
    }
    case "wide": {
      const bottom = fig.feet[1]
      return { top: headTop, bottom, center: [x, (headTop + bottom) / 2, z], margin: 2.4 }
    }
  }
}

const ALPHA: Record<Angle, number> = {
  front: Math.PI,
  "three-quarter-left": Math.PI - Math.PI / 4,
  "three-quarter-right": Math.PI + Math.PI / 4,
  "side-left": Math.PI / 2,
  "side-right": (3 * Math.PI) / 2,
  back: 0,
  high: Math.PI,
  low: Math.PI,
}

const BETA: Record<Angle, number> = {
  front: Math.PI / 2.3,
  "three-quarter-left": Math.PI / 2.3,
  "three-quarter-right": Math.PI / 2.3,
  "side-left": Math.PI / 2.2,
  "side-right": Math.PI / 2.2,
  back: Math.PI / 2.3,
  high: Math.PI / 3.6,
  low: Math.PI / 1.75,
}

/**
 * The camera that frames `shot` of the figure from `angle`, at `fov` radians.
 * Distance is what fits the shot's span (plus its margin) in the vertical field
 * of view; `aspect` matters only when the frame is narrower than it is tall.
 */
export function frameShot(fig: Figure, shot: Shot, angle: Angle, fov: number, aspect = 16 / 9): CaptureView {
  const { top, bottom, center, margin } = span(fig, shot)
  const height = Math.max(1, (top - bottom) * margin)
  // A portrait frame is limited by its width: fit the span there instead.
  const fitHeight = aspect < 1 ? height / aspect : height
  const distance = fitHeight / 2 / Math.tan(fov / 2)
  return { alpha: ALPHA[angle], beta: BETA[angle], distance: Math.round(distance * 100) / 100, target: center, fov }
}
