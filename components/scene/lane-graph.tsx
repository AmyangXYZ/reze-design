"use client"

import { memo, useMemo } from "react"

// One column per value, stretched to whatever width the lane happens to be.
//
// SVG with a non-uniform viewBox rather than a canvas, which is what reze-studio
// uses: a canvas would need its own resize observer, a device-pixel-ratio pass
// and a redraw on every layout change, and all three exist to solve a problem
// `preserveAspectRatio="none"` solves by declaration. The lane is a fixed height
// and the data never changes, so there is nothing here worth a raster.
//
// Drawn as ONE path. A rect per column is 160 to 320 elements per lane and three
// lanes of it is a thousand nodes for a strip that is 28 pixels tall.

/** Bars from a common baseline — a motion's keyframe density. */
function barsPath(values: number[]): string {
  let d = ""
  for (let i = 0; i < values.length; i++) {
    // A floor, so a column with a keyframe in it is never invisible: the
    // question the strip answers is "is anything happening here", and a value
    // rounded to nothing answers it wrongly.
    const h = values[i] > 0 ? Math.max(0.06, values[i]) : 0
    if (h > 0) d += `M${i} 1V${1 - h}`
  }
  return d
}

/** Bars around the centre line — music, the way every editor draws it. */
function mirroredPath(values: number[]): string {
  let d = ""
  for (let i = 0; i < values.length; i++) {
    const h = values[i] > 0 ? Math.max(0.04, values[i]) : 0
    if (h > 0) d += `M${i} ${0.5 - h / 2}V${0.5 + h / 2}`
  }
  return d
}

/**
 * Memoized on the VALUES, which never change once measured.
 *
 * Both matter for the fold. The values arrive as the same array identity every
 * time — they come from a cache, not a fresh computation — so memo lets opening
 * and closing the timeline skip this subtree entirely instead of reconciling a
 * path with several hundred segments twice per toggle. And useMemo keeps the `d`
 * string itself from being rebuilt for a redraw that would produce the same
 * characters. The graph is a picture of data that is finished; the fold moving
 * over it is not news.
 */
export const LaneGraph = memo(function LaneGraph({
  values,
  mirrored = false,
}: {
  values: number[]
  mirrored?: boolean
}) {
  const d = useMemo(() => (mirrored ? mirroredPath(values) : barsPath(values)), [values, mirrored])
  if (!values.length) return null
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${values.length} 1`}
      preserveAspectRatio="none"
    >
      <path
        d={d}
        stroke="currentColor"
        // In viewBox units, where one unit is one column: just under a full
        // column leaves the hairline of gap that makes a strip read as bars
        // rather than as a filled shape.
        strokeWidth={0.8}
        vectorEffect="none"
        fill="none"
      />
    </svg>
  )
})
