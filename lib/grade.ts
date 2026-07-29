// Color grading — the LOOK layer, and the clearest example of this app's posture

import presets from "@/content/grades.json"
import { asBuiltins, type GradeItem } from "@/lib/library"

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** A tonal range as [hue°, saturation, lightness?]. */
export type Range = readonly [number, number] | readonly [number, number, number]

/** The grade itself — what a library entry stores and the editor edits. */
export type GradeSpec = {
  shadows: Range
  midtones: Range
  highlights: Range
  contrast: number
  saturation: number
}

/** What the SCENE stores: which grade, and how strong */
export type GradeSettings = {
  preset: string
  intensities: Record<string, number>
  /** `from` is the built-in this snapshot descends from — without it, editing a
   *  preset severs the link to it and "back to preset" has nothing to revert to. */
  custom?: { name: string; spec: GradeSpec; from?: string | null } | null
}

export const CUSTOM_ID = "custom"

// Presets live in content/grades.json — data, not code, in the same envelope a
// contributed grade will arrive in once the library is server-backed.
// Tune them by SIMULATING the engine's CDL over sample pixels and fitting to a
// reference frame; eyeballing hue/sat numbers has never once landed.
// Judge DETAIL on a grey ramp (a shaded white dress is one): sum the per-step
// channel change. A preset that reads "flat" is one whose ramp bunches. Colour
// belongs in `contrast` + `saturation`; pushing it through midtone/highlight
// saturation instead drives slope and power apart until channels pin at 0/255,
// which is what actually destroys shading.
// JSON widens the range tuples to number[], so re-narrow on the way in — one
// cast at the boundary keeps every consumer strongly typed.
export const GRADE_PRESETS = asBuiltins<GradeItem>(presets as unknown as Omit<GradeItem, "owner">[])

export const NEUTRAL_SPEC: GradeSpec = GRADE_PRESETS[0].payload.spec
export const DEFAULT_GRADE: GradeSettings = { preset: "neutral", intensities: {}, custom: null }

/** Editor starting point — visibly a grade rather than a no-op, so a new author sees */
export const NEW_GRADE_SPEC: GradeSpec = {
  shadows: [210, 0.18],
  midtones: [0, 0],
  highlights: [35, 0.18],
  contrast: 1.05,
  saturation: 1.05,
}

// ── Split toning ──
const WARM_HUE = 35
const COOL_HUE = 210
const SPLIT_MAX_SAT = 0.5

export function applySplit(spec: GradeSpec, v: number): GradeSpec {
  const keepL = (r: Range) => r[2] ?? 0.5
  if (Math.abs(v) < 0.005) {
    return { ...spec, shadows: [0, 0, keepL(spec.shadows)], highlights: [0, 0, keepL(spec.highlights)] }
  }
  const sat = Math.abs(v) * SPLIT_MAX_SAT
  const warmHighlights = v > 0
  return {
    ...spec,
    highlights: [warmHighlights ? WARM_HUE : COOL_HUE, sat, keepL(spec.highlights)],
    shadows: [warmHighlights ? COOL_HUE : WARM_HUE, sat, keepL(spec.shadows)],
  }
}

export function readSplit(spec: GradeSpec): number {
  const warmth = (hue: number) => Math.cos(((hue - WARM_HUE) * Math.PI) / 180)
  const [sh, ss] = spec.shadows
  const [hh, hs] = spec.highlights
  return Math.max(-1, Math.min(1, (warmth(hh) * hs - warmth(sh) * ss) / (2 * SPLIT_MAX_SAT)))
}

/** The spec the settings currently point at (built-in, or the snapshot). */
export function specOf(g: GradeSettings): GradeSpec {
  if (g.preset === CUSTOM_ID) return g.custom?.spec ?? NEUTRAL_SPEC
  return (GRADE_PRESETS.find((p) => p.id === g.preset) ?? GRADE_PRESETS[0]).payload.spec
}

/** Strength for the ACTIVE grade. */
export function intensityOf(g: GradeSettings): number {
  return Math.max(0, Math.min(1, g.intensities[g.preset] ?? 1))
}

/** Resolve a spec + strength into the engine's ASC CDL inputs. */
export function resolveSpec(
  spec: GradeSpec,
  t: number,
): { shadows: string; midtones: string; highlights: string; contrast: number; saturation: number } {
  const k = Math.max(0, Math.min(1, t))
  const range = ([hue, sat, lightness = 0.5]: Range) => hslToHex(hue, sat * k, 0.5 + (lightness - 0.5) * k)
  return {
    shadows: range(spec.shadows),
    midtones: range(spec.midtones),
    highlights: range(spec.highlights),
    contrast: Math.max(0, 1 + (spec.contrast - 1) * k),
    saturation: Math.max(0, 1 + (spec.saturation - 1) * k),
  }
}

export function resolveGrade(g: GradeSettings) {
  return resolveSpec(specOf(g), intensityOf(g))
}
