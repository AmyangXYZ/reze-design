// Scene settings: the appearance-colors + world/sun/bloom TYPE and its sRGB↔linear
// conversions. Values live elsewhere — the demo's look is `state.settings` in
// lib/default-scene.ts, and the whole block travels inside the scene document
// (lib/scene.ts), which is also what persists.
//
// What stays here is ENGINE_DEFAULT_SCENE_SETTINGS: the engine's own neutral
// defaults, DERIVED from its exported constants so they never drift from it.
// That's a different thing from our default scene — it's what "Reset" restores.
//
// Color semantics: `background.color` is the page CSS backdrop (the engine
// composites with premultiplied alpha, so the DOM shows through the ground
// fade); everything else converts sRGB hex → linear for the engine.
//
// ONE KEY PER PANEL SECTION. The Scene panel renders World / Sun / Bloom /
// Background / Ground, and each is exactly one key here, so a section's edits are
// one `patch(section, …)` and hydrateScene's per-section merge lines up with what
// the user actually sees. (These used to share one `colors` bag spanning three
// sections, which matched neither the UI nor the merge.)

import { DEFAULT_BLOOM_OPTIONS, Vec3 } from "reze-engine"
import { DEFAULT_GRADE, type GradeSettings } from "@/lib/grade"

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
  background: { color: string }
  /** Post-tonemap color grade. Stored as INTENT (preset + strength + your two
   *  adjustments); lib/grade.ts resolves it to the engine's ASC CDL inputs. */
  grade: GradeSettings
  ground: {
    color: string
    /** Side length of the (square) ground plane in world units — the model is
     *  ~18 units tall. Drives the plane extent AND the radial fade with it. */
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
}

/** sRGB hex → display-space Vec3 (0–1 per channel, NO linearization) — for the
 *  engine's background color, which is composited post-tonemap and must match
 *  the CSS color of the same hex exactly. */
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

// The app's curated first-open look is NOT here — it's `state.settings` in
// lib/default-scene.ts, which owns every default the demo scene ships with. This
// module is the SceneSettings type and its conversions; the values that happen to
// be our defaults belong with the rest of the default scene.

// The engine's real neutral defaults — what "Reset to defaults" restores (an
// escape hatch when a model doesn't suit the curated purple first-open look).
// DEFAULT_ENGINE_OPTIONS isn't exported from the package index, so world/sun are
// mirrored from engine.js; bloom comes from the exported DEFAULT_BLOOM_OPTIONS.
const ENGINE_WORLD = { color: new Vec3(0.4014, 0.4944, 0.647), strength: 0.3 }
const ENGINE_SUN_DIR = new Vec3(-0.0873, -0.3844, 0.919)
export const ENGINE_DEFAULT_SCENE_SETTINGS: SceneSettings = {
  background: { color: "#0d1116" },
  grade: DEFAULT_GRADE,
  ground: {
    color: "#494d57",
    size: 160,
    opacity: 1,
    shadow: true,
    grid: "#ededed",
    gridEnabled: true,
  },
  world: {
    color: linearVec3ToHex(ENGINE_WORLD.color),
    strength: ENGINE_WORLD.strength,
  },
  sun: {
    color: "#ffffff",
    strength: 2.0,
    azimuth: (Math.round((Math.atan2(-ENGINE_SUN_DIR.x, -ENGINE_SUN_DIR.z) * 180) / Math.PI) + 360) % 360,
    elevation: Math.round((Math.asin(-ENGINE_SUN_DIR.y) * 180) / Math.PI),
  },
  bloom: {
    enabled: DEFAULT_BLOOM_OPTIONS.enabled,
    threshold: DEFAULT_BLOOM_OPTIONS.threshold,
    knee: DEFAULT_BLOOM_OPTIONS.knee,
    radius: DEFAULT_BLOOM_OPTIONS.radius,
    intensity: DEFAULT_BLOOM_OPTIONS.intensity,
    color: linearVec3ToHex(DEFAULT_BLOOM_OPTIONS.color),
  },
}

// Color presets now live in one shared picker (components/color-picker.tsx),
// sourced from the Tailwind palette — every color setting draws from that list.

// Settings used to persist standalone under this key, in a flat `colors` bag that
// spanned what are now the Background and Ground sections. They travel inside the
// scene document's `state` now (lib/scene.ts) — this reader stays only to migrate
// a pre-format session, so an existing user's saved look survives the upgrade.
const LEGACY_STORAGE_KEY = "reze-design.scene"

type LegacySceneSettings = {
  colors?: Partial<{
    background: string
    ground: string
    grid: string
    groundOpacity: number
    groundShadow: boolean
    gridEnabled: boolean
  }>
} & Partial<Pick<SceneSettings, "world" | "sun" | "bloom">>

/** Sections AND their fields are both optional here: an old blob may predate a
 *  setting entirely. hydrateScene merges this over the scene's own defaults, so
 *  every gap fills in — undefined values must simply never be written. */
export type PartialSceneSettings = { [K in keyof SceneSettings]?: Partial<SceneSettings[K]> }

/** Drop keys whose value is undefined, so spreading can't punch a hole in the
 *  defaults it merges over ({...{a:1}, ...{a: undefined}} is {a: undefined}). */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

export function loadLegacySceneSettings(): PartialSceneSettings | null {
  if (typeof window === "undefined") return null
  let old: LegacySceneSettings
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    old = JSON.parse(raw) as LegacySceneSettings
  } catch {
    return null
  }
  // The old flat `colors` bag fans out into today's Background and Ground sections.
  const c = old.colors ?? {}
  return defined({
    world: old.world,
    sun: old.sun,
    bloom: old.bloom,
    background: defined({ color: c.background }),
    ground: defined({
      color: c.ground,
      opacity: c.groundOpacity,
      shadow: c.groundShadow,
      grid: c.grid,
      gridEnabled: c.gridEnabled,
    }),
  })
}
