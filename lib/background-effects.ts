// Curated WGSL background effects — the seed of the Backgrounds library.

export type BackgroundEffectDef = {
  id: string
  name: string
  author: string
  description: string
  /** Library rail grouping ("Sky", "Nature", "Abstract"…). */
  category: string
  tags: string[]
  wgsl: string
}

/** What a scene stores when an effect is applied */
export type AppliedBackgroundEffect = {
  id: string
  name: string
  wgsl: string
}

export const applyDefaults = (def: BackgroundEffectDef): AppliedBackgroundEffect => ({
  id: def.id,
  name: def.name,
  wgsl: def.wgsl,
})

/** A built-in effect as an applied snapshot */
export function builtinEffect(id: string): AppliedBackgroundEffect {
  const def = BACKGROUND_EFFECTS.find((e) => e.id === id)
  if (!def) throw new Error(`unknown background effect: ${id}`)
  return applyDefaults(def)
}

/** The "New effect" starter: a terse contract reference, a replace-me body up top, and a small */

import meta from "@/content/effects.json"
import shiningStars from "@/content/effects/shining-stars.wgsl"
import fujiWatercolor from "@/content/effects/fuji-watercolor.wgsl"
import quietRain from "@/content/effects/quiet-rain.wgsl"
import rezeNeon from "@/content/effects/reze-neon.wgsl"
import orbitingHearts from "@/content/effects/orbiting-hearts.wgsl"
import newEffectTemplate from "@/content/effects/_new-effect.wgsl"

// Shaders live beside their metadata in content/effects — authored as real .wgsl
// files rather than template literals, and the same shape a contributed effect
// will take once the library is server-backed.
const SOURCES: Record<string, string> = {
  "shining-stars": shiningStars,
  "fuji-watercolor": fujiWatercolor,
  "quiet-rain": quietRain,
  "reze-neon": rezeNeon,
  "orbiting-hearts": orbitingHearts,
}

export const NEW_EFFECT_TEMPLATE = newEffectTemplate

export const BACKGROUND_EFFECTS: BackgroundEffectDef[] = meta.map((m) => ({ ...m, wgsl: SOURCES[m.id] }))
