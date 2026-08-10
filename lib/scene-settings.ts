// Scene settings: the appearance-colors + world/sun/bloom TYPE and its sRGB↔linear

import { Vec3 } from "reze-engine"
import type { GradeSettings } from "@/lib/grade"

export type SceneSettings = {
  world: { color: string; strength: number }
  /** Sun direction as azimuth/elevation degrees — friendlier than a raw vector. */
  sun: { color: string; strength: number; azimuth: number; elevation: number }
  bloom: {
    enabled: boolean
    threshold: number
    knee: number
    radius: number
    intensity: number
    color: string
  }
  /** Camera depth of field. Focus is ALWAYS automatic — the engine tracks the
   *  character's own depth span every frame, which is both the right answer and
   *  one nobody can dial in by hand while a dance moves. That leaves the switch
   *  and one dial, how much blur, so there is no focus mode to store. */
  dof: { enabled: boolean; aperture: number }
  /** The inverted-hull outline pass, scene-wide. A preference most scenes never
   *  touch — no dock row, reachable from the palette — but it changes how the
   *  scene LOOKS, so it travels with the document like any other look setting. */
  outline: { enabled: boolean }
  background: { color: string }
  /**
   * How the rendered image is mapped to the display, before the grade.
   *
   * Not a light: the sun's strength changes the scene, this changes how the
   * result is shown. It belongs beside the grade because the grade runs
   * immediately after it, and because the two are always tuned together — a
   * different transform lands at a different brightness, so exposure follows it.
   *
   * The transform is a LOOK decision, not a preference. Filmic rolls highlights
   * off and desaturates as it does; Standard passes the colours the graph
   * computed straight through, which is what anime and NPR work expects and what
   * both Wuthering Waves reference projects render under. A preset authored
   * against one and viewed under the other is a different look.
   */
  view: { transform: "standard" | "filmic" | "agx"; exposure: number }
  /** Post-tonemap color grade. */
  grade: GradeSettings
  ground: {
    color: string
    /** Side length of the (square) ground plane in world units — the model is ~18 units tall. */
    size: number
    /** Whole-ground opacity 0–1 (1 = solid; shadow persists — shadow catcher). */
    opacity: number
    /** Ground receives the model's shadow. */
    shadow: boolean
    /** Grid LINE color. */
    grid: string
    /** Show the ground grid lines. */
    gridEnabled: boolean
  }
  /** How the air behaves — what moves cloth and hair, not how anything looks.
   *  Lives in the document so a scene shared or exported keeps its motion. */
  physics: {
    /** Downward pull. The engine's default is 98 at MMD scale, where a
     *  character stands about 18 units tall. Lower floats, higher weighs down. */
    gravity: number
    /** Wind strength in gravity's units — 0 is still air. Also sets how much it
     *  varies: a breeze is nearly steady, a gale swings hard. True of air, and
     *  one dial fewer than exposing both. */
    wind: number
    /** Compass bearing the wind blows toward, degrees. Matches the sun's
     *  azimuth convention rather than a raw vector. */
    windAzimuth: number
    /** Tilt off horizontal, degrees. Positive lifts. */
    windElevation: number
    /** How many times a second the wind swings, in Hz. */
    windFrequency: number
  }
}

/** Same story as DEFAULT_PHYSICS, one section over: both blocks arrived with the
 *  0.4.0 chrome, so every document written before it is read through these. Off
 *  is the honest default for both — a scene that never asked for blur or outlines
 *  must come back looking exactly as it did. */
export const DEFAULT_DOF: SceneSettings["dof"] = { enabled: false, aperture: 1 }
export const DEFAULT_OUTLINE: SceneSettings["outline"] = { enabled: false }

/**
 * What a document without a view block gets: the engine's own defaults, which
 * are the Aether Gazer reference's Filmic at exposure 0.6.
 *
 * Every scene written before this setting existed was authored looking at that,
 * so it is the only value that brings one back unchanged — a scene must not
 * re-grade itself because the control it never touched became visible.
 */
export const DEFAULT_VIEW: SceneSettings["view"] = { transform: "filmic", exposure: 0.6 }

/** What a document without a physics block gets. Documents published before
 *  the section existed are read through this rather than migrated — the same
 *  way pre-angle documents take stock orbit angles. */
export const DEFAULT_PHYSICS: SceneSettings["physics"] = {
  gravity: 98,
  wind: 0,
  windAzimuth: 90,
  windElevation: 0,
  windFrequency: 0.2,
}

/** Frequency range, in Hz. Shared so the slider, the stored value and the
 *  variation derived from them cannot drift apart. */
export const WIND_MAX = 60
export const WIND_FREQ_MIN = 0.05
export const WIND_FREQ_MAX = 3

/**
 * Slider position (0–1) ↔ frequency in Hz, exponentially.
 *
 * Linearly, a 0.05–3 Hz range spends nine tenths of its travel above 0.3 Hz —
 * and almost nobody works up there, because slow swells are what read as wind
 * on cloth. Geometric spacing puts the midpoint near 0.39 Hz, so half the
 * slider covers the slow end where the choices actually are.
 */
export function windFreqFromSlider(pos: number): number {
  const t = Math.min(1, Math.max(0, pos))
  return WIND_FREQ_MIN * Math.pow(WIND_FREQ_MAX / WIND_FREQ_MIN, t)
}

export function windSliderFromFreq(hz: number): number {
  const f = Math.min(WIND_FREQ_MAX, Math.max(WIND_FREQ_MIN, hz))
  return Math.log(f / WIND_FREQ_MIN) / Math.log(WIND_FREQ_MAX / WIND_FREQ_MIN)
}

/**
 * How much the wind varies, given its strength and frequency.
 *
 * Strength sets the ceiling — still air is steady, a gale swings hard — and
 * frequency then fades it out, so the top of that slider is flat, constant wind
 * rather than a fast flutter.
 *
 * The fade tracks slider POSITION, not raw Hz, so it tapers evenly across the
 * travel instead of collapsing in the last sliver of an exponential scale. And
 * it is not a UI trick: turbulent energy really does fall off as frequency
 * rises, so slow swells are deep and fast ones shallow. One slider becomes a
 * character dial — long surges at the bottom, finer ripples through the middle,
 * steady air at the top.
 */
export function windVariation(wind: number, frequencyHz: number): number {
  const byStrength = Math.min(1, Math.max(0, wind / WIND_MAX))
  return byStrength * (1 - windSliderFromFreq(frequencyHz))
}

/** Azimuth/elevation (degrees) → the direction wind TRAVELS. Azimuth matches
 *  the sun's convention so one mental model covers both. */
export function windDirection(azimuth: number, elevation: number): Vec3 {
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  return new Vec3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
}

/** sRGB hex → display-space Vec3 (0–1 per channel, NO linearization) */
export function hexToSrgbVec3(hex: string): Vec3 {
  const n = parseInt(hex.replace("#", ""), 16)
  return new Vec3(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255)
}

/** sRGB hex → linear-light Vec3 (what the engine's Blender-style colors expect). */
export function hexToLinearVec3(hex: string): Vec3 {
  const n = parseInt(hex.replace("#", ""), 16)
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return new Vec3(toLinear(((n >> 16) & 0xff) / 255), toLinear(((n >> 8) & 0xff) / 255), toLinear((n & 0xff) / 255))
}

export function linearVec3ToHex(v: { x: number; y: number; z: number }): string {
  const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  const byte = (c: number) =>
    Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${byte(v.x)}${byte(v.y)}${byte(v.z)}`
}

/** Azimuth/elevation (degrees) → the engine's sun direction (travel FROM sun TO scene). */
export function azElToDirection(azimuth: number, elevation: number): Vec3 {
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  return new Vec3(-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az))
}


// Color presets now live in one shared picker (components/color-picker.tsx), sourced
