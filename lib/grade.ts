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

/**
 * What the SCENE stores: which grade, and how strong.
 *
 * Built-ins travel by NAME — we curate them, so a retune reaches every scene
 * using it. Anything else (a community grade, a local draft) travels by VALUE in
 * `spec`: your published scene must not change because someone else edited their
 * preset, and it must survive them renaming or deleting it. Same
 * reference-or-snapshot rule graphs and effects already follow.
 */
export type GradeSettings = {
  /** Display label. The reference only when it names a built-in. */
  preset: string
  intensity: number
  /** The value itself, for a grade with no published version to pin. */
  spec?: GradeSpec
  /** A pin to the published grade this came from. Rendering prefers `spec` when
   *  present; this is what records provenance and usage. */
  from?: { id: string; version: number }
}

// Presets live in content/grades.json — data, not code, in the same envelope a
// contributed grade will arrive in once the library is server-backed. File order
// is the display order: Neutral first as the scene default, the rest by name.
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

/** The spec a scene's grade settings resolve to: its snapshot when it carries one,
 *  otherwise the named entry. */
export function specOf(g: GradeSettings, drafts: GradeItem[] = []): GradeSpec {
  return g.spec ?? gradeSpec(g.preset, drafts)
}

/** Resolve a grade name against the built-ins and the given drafts. Unresolvable
 *  names (a draft deleted, a scene from elsewhere) read as Neutral — visibly
 *  ungraded rather than wrongly graded. */
export function gradeSpec(name: string, drafts: GradeItem[] = []): GradeSpec {
  return (
    (GRADE_PRESETS.find((p) => p.name === name) ?? drafts.find((d) => d.name === name))?.payload.spec ?? NEUTRAL_SPEC
  )
}

// ── Per-preset intensity memory ────────────────────────────────────────────────
// A UX nicety, not scene content: switching back to a preset restores the
// strength you last used it at. Lives in localStorage, never in the document.

const INTENSITY_KEY = "reze-design.gradeIntensity.1"

function intensityMap(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    return (JSON.parse(window.localStorage.getItem(INTENSITY_KEY) ?? "{}") as Record<string, number>) ?? {}
  } catch {
    return {}
  }
}

export function recallIntensity(preset: string): number {
  const v = intensityMap()[preset]
  return typeof v === "number" ? Math.max(0, Math.min(1, v)) : 1
}

export function rememberIntensity(preset: string, v: number): void {
  try {
    window.localStorage.setItem(INTENSITY_KEY, JSON.stringify({ ...intensityMap(), [preset]: v }))
  } catch {
    // Storage blocked — switching presets just starts at full strength.
  }
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

