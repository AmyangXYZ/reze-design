// Scene settings: the appearance-colors + world/sun/bloom TYPE and its sRGB↔linear

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

// The app's curated first-open look is NOT here

// The engine's real neutral defaults
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

// Color presets now live in one shared picker (components/color-picker.tsx), sourced

// Settings used to persist standalone under this key, in a flat `colors` bag that spanned
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

/** Sections AND their fields are both optional here */
export type PartialSceneSettings = { [K in keyof SceneSettings]?: Partial<SceneSettings[K]> }

/** Drop keys whose value is undefined, so spreading can't punch a hole in the defaults */
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
