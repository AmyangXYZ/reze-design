"use client"

// The dials an effect exposes, as the scene has them set.
//
// WHY THIS EXISTS: retuning a built-in used to mean forking it. Change the fall
// speed of Rain and you had a second Rain in your drafts, named "Rain (edited)",
// pinned by value rather than by id — so the scene stopped tracking the effect it
// came from, and the library filled with near-duplicates of the same shader.
//
// An effect now declares what is adjustable, in its own source:
//
//   #param float FALL 24 0 60
//   #param color TINT #d0e6ff
//   #param vec3 WIND 0.1 0 0.05
//
// The engine reads those lines to build the uniform the shader samples, and
// hands the declarations back from the install. This renders exactly what came
// back — never a second parse of the same directives, which would be a control
// free to disagree with the shader it is pointed at.

import { useMemo } from "react"
import type { EffectParamDecl, EffectParamValue } from "reze-engine"
import { ColorRow, SliderRow } from "@/components/scene/scene-sidebar"

/** `#param color` writes `#rrggbb`; the engine wants the linear-ish 0..1 triple
 *  it declared. sRGB→linear is the engine's own conversion at install, so the
 *  round trip here is plain byte scaling and nothing else. */
const hexToVec = (hex: string): EffectParamValue => {
  const n = parseInt(hex.slice(1), 16)
  return { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 }
}

const vecToHex = (v: EffectParamValue): string => {
  if (typeof v === "number") return "#000000"
  const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)
  return `#${((b(v.x) << 16) | (b(v.y) << 8) | b(v.z)).toString(16).padStart(6, "0")}`
}

/** A float with no author-given range still needs a track to drag along. Zero to
 *  twice the default covers a dial someone chose a middle value for, and a
 *  default of zero has no scale to infer, so it gets a unit one. */
const impliedMax = (v: number) => (v === 0 ? 1 : Math.abs(v) * 2)

export function EffectParams({
  decls,
  values,
  onChange,
}: {
  decls: EffectParamDecl[]
  /** Only what this scene moved. Anything absent shows the shader's own default,
   *  which is what lets a retuned built-in reach scenes that never touched it. */
  values: Record<string, EffectParamValue> | undefined
  onChange: (name: string, value: EffectParamValue | undefined) => void
}) {
  const rows = useMemo(
    () =>
      decls.map((d) => {
        const set = values?.[d.name]
        return { d, set }
      }),
    [decls, values],
  )
  if (rows.length === 0) return null

  return (
    <>
      {rows.map(({ d, set }) => {
        if (d.kind === "color") {
          const fallback = typeof d.value === "string" ? d.value : "#ffffff"
          return (
            <ColorRow
              key={d.name}
              label={d.name}
              value={set === undefined ? fallback : vecToHex(set)}
              onChange={(hex) => onChange(d.name, hexToVec(hex))}
              dense
              labelClass="w-[4.75rem]"
            />
          )
        }

        if (d.kind === "vec3") {
          const base = Array.isArray(d.value) ? d.value : [0, 0, 0]
          const v = set === undefined || typeof set === "number" ? { x: base[0], y: base[1], z: base[2] } : set
          // Three sliders rather than a vector widget: these are wind, an offset,
          // a scale per axis — quantities you nudge one axis of, not a direction
          // you aim. A gizmo for something with no position in the scene would be
          // a control for a thing that is not there.
          return (["x", "y", "z"] as const).map((axis, i) => (
            <SliderRow
              key={`${d.name}.${axis}`}
              label={`${d.name}.${axis}`}
              value={v[axis]}
              min={-impliedMax(base[i])}
              max={impliedMax(base[i])}
              step={impliedMax(base[i]) / 100}
              onChange={(n) => onChange(d.name, { ...v, [axis]: n })}
              fmt={(n) => n.toFixed(2)}
              dense
              labelClass="w-[4.75rem]"
            />
          ))
        }

        const base = typeof d.value === "number" ? d.value : 0
        const min = d.min ?? Math.min(0, base)
        const max = d.max ?? impliedMax(base)
        return (
          <SliderRow
            key={d.name}
            label={d.name}
            value={typeof set === "number" ? set : base}
            min={min}
            max={max}
            // A hundred steps across whatever range the author gave, so a dial
            // that runs 0..1 and one that runs 0..60 both drag at the same feel.
            step={(max - min) / 100 || 0.01}
            onChange={(n) => onChange(d.name, n)}
            fmt={(n) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2))}
            dense
            labelClass="w-[4.75rem]"
          />
        )
      })}
    </>
  )
}
