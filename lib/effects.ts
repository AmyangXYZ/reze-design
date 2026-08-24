// Curated WGSL effects — the built-in shelf of the effects library.
//
// The TYPE names dropped "Background" with the library; the FIELD names did
// not. `SceneState.backgroundEffects` is read out of exported scene files and
// out of localStorage, and `SceneDoc.settings.background.effects` is inside
// every published scene — both are stored shapes, and both are still literally
// where the effects are layered.
//
// Shader source lives inside the JSON payload rather than beside it as .wgsl
// files: nobody hand-edits these (they're authored in the app's editor or with
// an AI), and one shape for every library kind beats one convenient one.

import effects from "@/content/effects.json"
import { asBuiltins, type EffectItem } from "@/lib/library"

/** What a scene stores when an effect is applied */
export type AppliedEffect = {
  /** WHICH LIBRARY ENTRY this is — shared by every copy of it in the scene.
   *  What a tick in the picker and a pin in the document are about. */
  id: string
  name: string
  wgsl: string
  /** WHICH COPY this is, minted per instance and never persisted.
   *
   *  The two were one field, and the same effect applied twice then collided on
   *  it: React saw duplicate keys, and removing either row filtered BOTH out of
   *  the list, because the filter could only ask "which effect" when it needed
   *  to ask "which of them". Optional because a list arriving from a document
   *  has none yet — the setter stamps them on the way into state. */
  uid?: string
}

export const applyDefaults = (def: EffectItem): AppliedEffect => ({
  id: def.id,
  name: def.name,
  wgsl: def.payload.wgsl,
})

/** A built-in effect as an applied snapshot, by name — how scene documents refer to it. */
export function builtinEffect(name: string): AppliedEffect {
  const def = EFFECTS.find((e) => e.name === name)
  if (!def) throw new Error(`unknown background effect: ${name}`)
  return applyDefaults(def)
}

/** The "New effect" starter: a terse contract reference and a replace-me body.
 *  Code, not content — it seeds the editor rather than appearing in the library. */
export const NEW_EFFECT_TEMPLATE = `// An effect is ONE WGSL file, and WHICH FUNCTIONS YOU DEFINE decides both what
// it is and where it lands. There is no layer setting anywhere in the app.
//
//   fn background(ray, uv, time)                   behind the model, over the
//                                                  backdrop colour or image
//   fn foreground(ray, uv, time, depth)            over the finished frame
//   fn particleInit / particleStep / particleShade a GPU particle pool
//   fn trailWidth / trailShade                     ribbons along bones you ask for
//
// Define background AND foreground and they are one effect: a storm is a dark
// sky and the rain in front of it, in one file. Particles and trails each stand
// alone — an effect declares field mounts (background/foreground) or particles,
// not both, so sparks that need their own sky are two effects today.
//
// Delete whichever of the two below you do not want.

// ── Behind the model ──
fn background(ray: vec3f, uv: vec2f, time: f32) -> vec4f {
  // Anything that must not stretch with the canvas is measured in a SQUARE
  // space, corrected by the live aspect — never a hardcoded one.
  let aspect = rzResolution().x / rzResolution().y;
  let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  // Drifting glow — replace me.
  let n = noise2(p * 3.0 + vec2f(time * 0.15, 0.0));
  return vec4f(0.35, 0.55, 1.0, 0.22 * n);
}

// ── Over the finished frame ──
//
// depth is how many metres away whatever the scene drew at this pixel is, and
// the far plane where it drew nothing. So a foreground is NOT stuck in front:
// compare something's own distance against it and the model takes the pixel
// instead. Fog needs no comparison at all — its alpha simply IS a function of
// distance, which is all the haze below is.
fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f {
  let haze = 1.0 - exp(-depth * 0.004);
  return vec4f(0.62, 0.68, 0.78, haze * 0.35);
}

// ── What you return ──
//
// sRGB colour with STRAIGHT alpha, and the alpha is the interesting half: it is
// your mask over everything behind you. 0 lets it through untouched, 1 replaces
// it. Sparse effects — rain, sparks, prints — sit near 0 and rise where a mark
// lands. A painted sky returns 1 everywhere.

// ── Declaring what you need ──
//
// Comments at the top of the file, each on its own line:
//
//   // @anchor 頭              a bone, by name -> rzAnchor(subject, 0)
//   // @anchor 左手首 trail    ...and keep its recent PATH -> rzTrail(...)
//   // @particles 4096         pool size, if you write the particle mounts
//   // @blend additive         particles add light instead of covering (fire)
//   // @bloom                  particles reach the bloom pyramid
//   // @fullres                field mounts run at full resolution
//
// @anchor slots are DECLARATION ORDER: the first is slot 0. Any bone the model
// has works, and .valid is false on a rig that spells it differently — check
// it, or your hand effect draws at the world origin on half the library.
//
// @fullres costs four times the pixels and buys sub-pixel detail. Hairlines,
// thin rings and scanlines need it. Anything soft — smoke, glow, billowing
// noise — does not: an upsample carries that for free, which is the point of
// the default.
//
// The trap: what decides this is not how soft the effect LOOKS, it is whether
// its ALPHA has a hard edge anywhere. A foreground that compares against \`depth\`
// has one along every silhouette in the scene, however soft the rest of it is,
// and at half resolution that edge arrives as stair-steps up the character.

// ── Reading the scene ──
//
// An effect is not limited to its own pixel. This is what separates a
// decoration from something that reacts to the performance.
//
//   rzResolution()            canvas size in pixels
//   rzCameraPos()             where the camera is
//   rzCameraRight/Up/Forward()  its axes, in world space
//   rzSubjectCount()          how many characters, up to four
//   rzSubject(i)              { root, center, bounds, valid }
//                             root is the FLOOR under them, center the hips,
//                             bounds a GENEROUS cull sphere — generous enough
//                             to cover a raised arm, so do not size anything
//                             off it that should match the body
//   rzAnchor(subject, slot)   { pos, vel, fwd, valid } for a bone you declared
//   rzTrailCount(subject, slot)   how many path samples that bone has yet
//   rzTrail(subject, slot, i)     xyz where it was, w how many seconds ago.
//                                 i = 0 is NOW and runs backwards in time
//   rzWorldPos(ray, depth)    this pixel's depth turned into a PLACE
//   rzProject(p)              a world point as the camera sees it: xy the uv it
//                             lands on, z its distance along the view axis
//
// rzProject is the one to learn. Marching a curve in 3D costs a distance
// evaluation per sample per pixel; projecting its points once and measuring in
// 2D costs a subtraction. Its z is directly comparable to depth, so occlusion
// is a single test — draw where your z is nearer than the scene's — and it is
// negative behind the camera, which is worth rejecting before using the uv.
//
// Loop to the count functions, never to a constant. Four characters, eight
// anchors, 128 trail samples are MINIMUMS and are free to grow, which stays
// true only while nobody hardcodes them.

// ── Reacting to the music ──
//
//   rzAudioLevel()            loudness now, 0..1
//   rzAudioOnset()            how hard the bass is RISING — the kick detector
//   rzAudioBandCount()        how many spectrum bands there are
//   rzAudioBand(i)            band i now, 0..1
//   rzAudioLevelAt(offset)    the same, SECONDS away: negative is the past,
//   rzAudioOnsetAt(offset)    positive is the future. A bar that leans into a
//   rzAudioBandAt(i, offset)  beat before it lands reads the future
//   rzAudioTime()             where the song is, in seconds
//   rzAudioPlaying()          1 while it is playing, 0 while paused
//
// The analysis is computed ONCE for the whole song, not sampled live, so the
// editor, the viewer and an exported video all read identical numbers for
// identical frames. Everything is zero when the scene has no music.

// ── Making it fast ──
//
// This runs behind a full character render, every frame, at up to 4K, and an
// export multiplies it by thousands of frames.
//
// CULL FIRST, and cull HIERARCHICALLY. If your effect belongs to a character,
// reject the pixels nowhere near her before setting up anything per-mark: most
// of any frame is empty, and the cheapest reject is one circle around her.
// DERIVE the radius from what you actually draw rather than guessing — a
// guessed one clips your own effect, and near the top of a circle the boundary
// is flat to within a pixel, so it does not even look like a circle when it
// fails. It looks like someone drew a straight line across your work.
//
// Bound every glow. A 1/r falloff never reaches zero and so gives you no radius
// to cull with; a bounded falloff does, and nobody can tell them apart.
//
// Keep loops fixed and small, and hoist anything shared out of them. Setting
// the effect to None for one export tells you how much of the frame time is
// yours.

// ── Rules ──
//
// Self-contained: no textures, no external bindings, no state between frames.
// Drive ALL motion from time — it is the only clock, and it is what makes an
// exported video reproducible. fwidth and friends are legal only in uniform
// control flow, so keep them out of code following a data-dependent branch.
// WGSL resolves in any order, so helpers may live below the functions that use
// them.
//
// The library ships worked examples of every mount, each commented with the
// mistake it is built to avoid. Reading them is the fastest way in.

// ── Toolbox ──

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

export const EFFECTS = asBuiltins<EffectItem>(effects as Omit<EffectItem, "owner">[])
