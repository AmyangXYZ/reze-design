// Color grading — the LOOK layer, and the clearest example of this app's
// posture: the engine exposes full ASC CDL (per-range colors, contrast,
// saturation) and we deliberately don't. What the user gets is the iOS Photos
// model — pick a look, dial its strength, then adjust — because that's the shape
// that works for someone who isn't a colorist:
//
//   preset + intensity  →  the look          (a curated point in CDL space)
//   contrast, saturation →  your adjustment  (applied on top, 1 = untouched)
//
// Presets carry their own contrast/saturation, scaled by intensity; the two
// sliders are a separate additive layer, exactly like Photos' Filters strip and
// Adjust panel compose. Everything resolves to plain CDL here, so the engine
// never knows presets exist and a power surface could still drive it directly.

/** Mid-gray: zero saturation at 50% lightness, the CDL no-op for every range. */
export const NEUTRAL_HEX = "#808080"

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

/** What the user edits. The per-range colors are DERIVED (see resolveGrade), so
 *  a saved scene stores the intent ("Cinematic at 60%") rather than nine
 *  opaque numbers — which also means a preset can be retuned later and existing
 *  scenes inherit the improvement. */
export type GradeSettings = {
  /** GRADE_PRESETS id. */
  preset: string
  /** 0–1, how much of the preset to apply. Meaningless for "neutral". */
  intensity: number
  /** User adjustment on top of the preset. 1 = no change. */
  contrast: number
  /** User adjustment on top of the preset. 1 = no change. */
  saturation: number
}

/** A tonal range as [hue°, saturation, lightness?]. Lightness defaults to 0.5
 *  (tint only); going BELOW it is what lets a preset actually darken, since the
 *  engine derives CDL from each colour's distance from mid-grey:
 *    shadows   < 0.5 → negative offset → crushed blacks
 *    midtones  < 0.5 → power > 1       → darker mids (the biggest lever)
 *    highlights< 0.5 → slope < 1       → dimmed brights
 *  Above 0.5 does the reverse, which is how a lifted-blacks film look would be
 *  expressed. Hue/sat/lightness rather than hex so intensity scales all three. */
type Range = readonly [number, number] | readonly [number, number, number]

type GradePreset = {
  id: string
  shadows: Range
  midtones: Range
  highlights: Range
  contrast: number
  saturation: number
}

const NEUTRAL: Range = [0, 0]
// Warm light with cool shade is how daylight actually behaves — which is why
// that pairing recurs below and reads as "cinematic" rather than as an effect.
// Hues are per-preset rather than shared constants: the exact cyan a film-stock
// emulation wants (~188°) isn't the one a blockbuster split wants (~196°).

// Kept deliberately short: a preset only earns a slot if the Contrast and
// Saturation sliders sitting right below it can't already reproduce it. That
// ruled out "vivid" (just raise both), "faded" (pastel with saturation down)
// and "noir" (ink with contrast down) — each was a click users can reach anyway.
//
// Several of these chase the signature looks of well-known anime studios. They
// are named for the LOOK, never the studio: a grade can't deliver a studio's
// linework, compositing or effects, so a studio name would promise something
// this can't honor (the same trap as photographic lighting-preset names) — and
// a look isn't anyone's property, but a studio's name is.
export const GRADE_PRESETS: GradePreset[] = [
  { id: "neutral", shadows: NEUTRAL, midtones: NEUTRAL, highlights: NEUTRAL, contrast: 1, saturation: 1 },
  // Film emulation: LIFTED cool blacks (shadow lightness 0.58 — darks go
  // #303a49 against neutral's #292933) plus sub-1 contrast and heavy
  // desaturation. The lift is the load-bearing part: an earlier version leaned
  // on saturation alone, and because desaturation disproportionately hits
  // ALREADY-saturated things, it recoloured the ground and grid while leaving
  // near-neutral skin and white fabric almost untouched. Lifting the blacks
  // reaches the model's own shadowed areas — hair, fabric folds — which is where
  // a film look has to land.
  //
  // Three siblings (cinematic / luminous / pastel) were cut rather than kept:
  // protecting skin from the grade left them differing only in contrast and
  // lightness, which measured 1-8% off neutral and read as no-ops on a model. A
  // preset that looks like Neutral is worse than no preset.
  { id: "filmic", shadows: [208, 0.24, 0.58], midtones: [205, 0.12], highlights: [30, 0.1], contrast: 0.92, saturation: 0.62 },
  // Golden hour, built the way `sakura` is — a coherent warm family at visible
  // saturations. Skin deliberately goes golden (#ffd984): that IS the look, not
  // a side effect. The skin-protected warm presets that tried to avoid it are
  // exactly the ones that measured indistinguishable from Neutral.
  { id: "golden", shadows: [30, 0.14], midtones: [38, 0.1], highlights: [45, 0.2], contrast: 0.98, saturation: 1.1 },
  { id: "sakura", shadows: [305, 0.12], midtones: [345, 0.09], highlights: [352, 0.18], contrast: 0.96, saturation: 1.08 },
  // Moonlight is CONTRAST, not darkness — the correction that took three tries.
  // Uniformly dimming everything (an earlier pass) reads as "night sky with no
  // moon": flat, dim, blue. What actually sells it is a deep blue-teal mass with
  // the HIGHLIGHTS LEFT BRIGHT, so speculars still sparkle against it.
  //
  // Tuned against reference frames rather than by feel, simulating the engine's
  // CDL chain over sample pixels: skin ~#7c9fb8, mid-water ~#133c64, speculars
  // still bright at ~#74baf0, mean luma -38%. The heavy contrast (1.32)
  // does the separating; slope is only slightly under 1, because dimming
  // highlights any further is what killed the sparkle before.
  //
  // The grade supplies the blue and the separation — it cannot supply LIGHTING.
  // For the full effect, pair it with a lower sun/world strength; no global
  // grade can turn a brightly-lit subject into a dimly-lit one without
  // flattening everything else with it.
  { id: "moonlit", shadows: [218, 0.34, 0.44], midtones: [206, 0.32, 0.28], highlights: [195, 0.2, 0.4], contrast: 1.32, saturation: 0.74 },
  // This palette is described as "inky dark base + high-saturation cyan and
  // magenta neon", so: crushed cyan shadows, magenta through mids and
  // highlights, brutal contrast, saturation well past cinematic, and genuinely
  // darkened (~-31% luma). Earlier passes sat near full brightness and so just
  // read as a purple night.
  //
  // NO YELLOW — twice tried, twice wrong. Yellow is this palette's UI/brand
  // colour, not its world grade, and the highlight control is CDL *slope*, a
  // multiplier over the whole frame: amber there tints everything and blows skin
  // out to #ffff57. Screen neon is localised light in the ART; a global grade can
  // only supply the cold, crushed, saturated base it sits on.
  { id: "cyberpunk", shadows: [184, 0.36, 0.41], midtones: [312, 0.15, 0.39], highlights: [328, 0.3, 0.47], contrast: 1.42, saturation: 1.5 },
  // Manga page: pure monochrome, contrast hard enough to read as ink. A real
  // manga look also wants posterization + screentone, which ASC CDL can't
  // express — that would be a separate step in the composite shader.
  { id: "ink", shadows: NEUTRAL, midtones: NEUTRAL, highlights: NEUTRAL, contrast: 1.55, saturation: 0 },
]

export const DEFAULT_GRADE: GradeSettings = { preset: "neutral", intensity: 1, contrast: 1, saturation: 1 }

/** Resolve the edited settings into the engine's ASC CDL inputs. */
export function resolveGrade(g: GradeSettings): {
  shadows: string
  midtones: string
  highlights: string
  contrast: number
  saturation: number
} {
  const p = GRADE_PRESETS.find((x) => x.id === g.preset) ?? GRADE_PRESETS[0]
  const t = Math.max(0, Math.min(1, g.intensity))
  // Intensity scales saturation AND the lightness offset, so t=0 is always
  // exactly neutral grey regardless of what the preset asked for.
  const range = ([hue, sat, lightness = 0.5]: Range) => hslToHex(hue, sat * t, 0.5 + (lightness - 0.5) * t)
  return {
    shadows: range(p.shadows),
    midtones: range(p.midtones),
    highlights: range(p.highlights),
    contrast: Math.max(0, 1 + (p.contrast - 1) * t + (g.contrast - 1)),
    saturation: Math.max(0, 1 + (p.saturation - 1) * t + (g.saturation - 1)),
  }
}
