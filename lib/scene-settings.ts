// Scene settings: appearance colors + world/sun/bloom lighting, persisted to
// localStorage. Defaults are DERIVED from the engine's exported constants, so a
// fresh session looks exactly like the engine's own defaults and never drifts.
//
// Color semantics: `colors.background` is the page CSS backdrop (the engine
// composites with premultiplied alpha, so the DOM shows through the ground
// fade); everything else converts sRGB hex → linear for the engine.

import { DEFAULT_BLOOM_OPTIONS, Vec3 } from "reze-engine"

// The engine's world/sun defaults (DEFAULT_ENGINE_OPTIONS is not exported from
// the package index — mirror of engine.js; ask reze-engine to export it).
const ENGINE_WORLD_DEFAULT = { color: new Vec3(0.4014, 0.4944, 0.647), strength: 0.3 }
const ENGINE_SUN_DEFAULT = { color: new Vec3(1.0, 1.0, 1.0), strength: 2.0, direction: new Vec3(-0.0873, -0.3844, 0.919) }

export type SceneColors = {
  background: string
  ground: string
  grid: string
}

export type SceneSettings = {
  colors: SceneColors
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

const defaultSunDir = ENGINE_SUN_DEFAULT.direction
export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  colors: {
    background: "#0d1116",
    ground: "#494d57",
    grid: "#ededed",
  },
  world: {
    color: linearVec3ToHex(ENGINE_WORLD_DEFAULT.color),
    strength: ENGINE_WORLD_DEFAULT.strength,
  },
  sun: {
    color: linearVec3ToHex(ENGINE_SUN_DEFAULT.color),
    strength: ENGINE_SUN_DEFAULT.strength,
    azimuth: Math.round((Math.atan2(-defaultSunDir.x, -defaultSunDir.z) * 180) / Math.PI + 360) % 360,
    elevation: Math.round((Math.asin(-defaultSunDir.y) * 180) / Math.PI),
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

const STORAGE_KEY = "reze-design.scene-settings.v1"
const LEGACY_COLORS_KEY = "reze-design.scene-colors.v1"

export function loadSceneSettings(): SceneSettings {
  if (typeof window === "undefined") return DEFAULT_SCENE_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<SceneSettings>
      return {
        colors: { ...DEFAULT_SCENE_SETTINGS.colors, ...stored.colors },
        world: { ...DEFAULT_SCENE_SETTINGS.world, ...stored.world },
        sun: { ...DEFAULT_SCENE_SETTINGS.sun, ...stored.sun },
        bloom: { ...DEFAULT_SCENE_SETTINGS.bloom, ...stored.bloom },
      }
    }
    // Migrate the earlier colors-only key.
    const legacy = window.localStorage.getItem(LEGACY_COLORS_KEY)
    if (legacy) {
      return {
        ...DEFAULT_SCENE_SETTINGS,
        colors: { ...DEFAULT_SCENE_SETTINGS.colors, ...(JSON.parse(legacy) as Partial<SceneColors>) },
      }
    }
    return DEFAULT_SCENE_SETTINGS
  } catch {
    return DEFAULT_SCENE_SETTINGS
  }
}

export function saveSceneSettings(settings: SceneSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // storage full/blocked — customization just won't persist
  }
}
