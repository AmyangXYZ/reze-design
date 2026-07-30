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


// Color presets now live in one shared picker (components/color-picker.tsx), sourced
