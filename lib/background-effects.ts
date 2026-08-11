// Curated WGSL background effects — the seed of the Backgrounds library.
//
// Shader source lives inside the JSON payload rather than beside it as .wgsl
// files: nobody hand-edits these (they're authored in the app's editor or with
// an AI), and one shape for every library kind beats one convenient one.

import effects from "@/content/effects.json"
import { asBuiltins, type EffectItem } from "@/lib/library"

/** What a scene stores when an effect is applied */
export type AppliedBackgroundEffect = {
  id: string
  name: string
  wgsl: string
}

export const applyDefaults = (def: EffectItem): AppliedBackgroundEffect => ({
  id: def.id,
  name: def.name,
  wgsl: def.payload.wgsl,
})

/** A built-in effect as an applied snapshot, by name — how scene documents refer to it. */
export function builtinEffect(name: string): AppliedBackgroundEffect {
  const def = BACKGROUND_EFFECTS.find((e) => e.name === name)
  if (!def) throw new Error(`unknown background effect: ${name}`)
  return applyDefaults(def)
}

/** The "New effect" starter: a terse contract reference and a replace-me body.
 *  Code, not content — it seeds the editor rather than appearing in the library. */
export const NEW_EFFECT_TEMPLATE = `// An effect is one file with one or both of these functions. WHICH ONE YOU
// WRITE IS WHERE IT LANDS — there is no layer setting anywhere. Delete the one
// you don't want; alpha is how much each covers what is behind it.

// Behind the model, over the background color/image.
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  // For circles/shapes that must not stretch with the canvas, correct by the
  // live aspect ratio — never hardcode one:
  //   let aspect = bgResolution().x / bgResolution().y;
  //   let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  // Drifting glow — replace me.
  let n = noise2(uv * 3.0 + vec2f(time * 0.15, 0.0));
  return vec4f(0.35, 0.55, 1.0, 0.22 * n);
}

// In front of everything — rain, snow, petals, fog. \`depth\` is how many metres
// away whatever the scene drew at this pixel is (the far plane where it drew
// nothing), so particles are not stuck in front: compare a particle's own
// distance against it and the model takes the pixel instead. Fog needs no
// comparison at all — its alpha simply IS a function of distance, which is all
// the haze below is.
fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f {
  let haze = 1.0 - exp(-depth * 0.004);
  return vec4f(0.62, 0.68, 0.78, haze * 0.35);
}

// ── Reading the scene ──
//
// An effect is not limited to the pixel. It can ask where the CAST is, which is
// what separates a decoration from something that reacts:
//
//   rzSubjectCount()          how many characters, up to four
//   rzSubject(i)              { root, center, bounds, valid } — root is the
//                             FLOOR under them, center the hips, bounds a
//                             generous sphere to cull against
//   rzProject(p)              a world point as the camera sees it: xy the uv it
//                             lands on, z its distance along the view axis.
//                             Compare that z against \`depth\` for occlusion —
//                             and measure in 2D instead of marching in 3D
//   rzWorldPos(ray, depth)    this pixel's depth turned into a PLACE
//
// And it can ask for BONES, by name, at the top of the file:
//
//   // @anchor 頭
//   // @anchor 左手首 trail
//
// giving rzAnchor(subject, slot) = { pos, vel, fwd, valid } — slots in
// declaration order. Check \`valid\`: a rig that spells the bone differently
// reports false, and the alternative is drawing at the world origin.
//
// \`trail\` also keeps that bone's recent PATH: rzTrailCount(subject, slot) and
// rzTrail(subject, slot, i) = xyz where it was, w how many seconds ago. That is
// what a ribbon is made of — one position and one velocity give a straight
// segment that jitters, because a velocity is a difference between two frames.
//
// Loop to the count functions, never to a fixed number: the limits are minimums
// and can grow, which stays true only while nobody hardcodes them.
//
// The built-in Halo, Hand Ribbon and Footprints are worked examples, each
// commented with the mistake it is built to avoid.

// ── Toolbox (WGSL resolves in any order — helpers can live below main) ──

// Pseudo-random vec2 in 0..1 from any 2D point.
fn hash2(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

// Smooth value noise in 0..1 — clouds, aurora, water.
fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i).x, hash2(i + vec2f(1.0, 0.0)).x, u.x),
             mix(hash2(i + vec2f(0.0, 1.0)).x, hash2(i + vec2f(1.0, 1.0)).x, u.x), u.y);
}
`

export const BACKGROUND_EFFECTS = asBuiltins<EffectItem>(effects as Omit<EffectItem, "owner">[])
