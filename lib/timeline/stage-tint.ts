// A game stage's scene tint on the clock.
//
// Aether Gazer ends its stage shaders on one multiply, SimSceneTint, the
// colour a stage's lit surfaces and glows are scaled by before the fog. A
// stage with a show of its own moves it with the music — X206_band's director
// fades five volumes in and out, and the room swings from 0.12 to 0.81 every
// loop. The stage converter bakes the loop's MEAN into each tinted material's
// colour (so a stage drawn still is the room on average) and carries the loop
// beside it (`tint` in the stage's rig, tools/stages/unity_to_glb.py
// scene_tint_track). Played HERE: each tinted material's ambient, which
// its Stage PBR look multiplies its whole result by (gltf-stage stagePbrGraph),
// is set to tint(t) / mean at the frame the caller draws, by the same crossing
// as the lamps (applyTimelineFrame), so playback, a scrub and the export
// pulse alike.
//
// The show loops on its own, from the clip's frame 0, as the game's director
// wraps. A stage with no moving tint registers nothing, and nothing runs.

/** A show's scene tint over one loop: [frame, r, g, b] keys, linear between. */
export type StageTint = {
  mean: [number, number, number]
  fps: number
  /** The loop's length in its frames. */
  frames: number
  keys: [number, number, number, number][]
}

/** As much of the engine as the tint needs. */
type TintEngine = {
  setMaterialUniforms(model: string, material: string, patch: { ambient?: readonly [number, number, number] }): boolean
}

type Stage = { tint: StageTint; materials: string[] }
type TintState = { stages: Map<string, Stage>; frame: number }
const states = new WeakMap<object, TintState>()

/** The tint at `frame` of the loop: linear between the keys around it. */
export function tintAt(t: StageTint, frame: number): [number, number, number] {
  const k = t.keys
  const f = ((frame % t.frames) + t.frames) % t.frames
  if (f <= k[0][0]) return [k[0][1], k[0][2], k[0][3]]
  const last = k[k.length - 1]
  if (f >= last[0]) return [last[1], last[2], last[3]]
  let lo = 0
  let hi = k.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (k[mid][0] <= f) lo = mid
    else hi = mid
  }
  const a = k[lo]
  const b = k[hi]
  const s = b[0] > a[0] ? (f - a[0]) / (b[0] - a[0]) : 1
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s]
}

function apply(engine: TintEngine, id: string, stage: Stage, clipFrame: number): void {
  // clip frames are 30 a second; the loop counts its own
  const tint = tintAt(stage.tint, (clipFrame * stage.tint.fps) / 30)
  const k = tint.map((c, i) => c / Math.max(stage.tint.mean[i], 1e-5)) as [number, number, number]
  for (const name of stage.materials) engine.setMaterialUniforms(id, name, { ambient: k })
}

/**
 * A stage's tint, registered so applyStageTintFrame plays it — or taken off
 * with null. `materials` are its tinted materials, by name. Set to the frame
 * last drawn at once.
 */
export function setStageTint(engine: TintEngine, id: string, tint: StageTint | null, materials: string[]): void {
  let s = states.get(engine)
  if (!tint || !materials.length) {
    s?.stages.delete(id)
    return
  }
  if (!s) states.set(engine, (s = { stages: new Map(), frame: 0 }))
  const stage = { tint, materials }
  s.stages.set(id, stage)
  apply(engine, id, stage, s.frame)
}

/** Every registered stage's tint at `frame` (clip frames). */
export function applyStageTintFrame(engine: object, frame: number): void {
  const s = states.get(engine)
  if (!s || s.frame === frame) return
  s.frame = frame
  for (const [id, stage] of s.stages) apply(engine as TintEngine, id, stage, frame)
}

/** A rig's `tint`, when it is sound. */
export function stageTintFrom(raw: unknown): StageTint | null {
  const t = raw as Partial<StageTint> | null
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v)
  if (!t || !Array.isArray(t.mean) || t.mean.length !== 3 || !t.mean.every(fin) || !fin(t.fps) || !fin(t.frames) || (t.frames as number) < 1)
    return null
  const keys = (Array.isArray(t.keys) ? t.keys : []).filter((k) => Array.isArray(k) && k.length === 4 && k.every(fin))
  if (!keys.length) return null
  return { mean: t.mean as StageTint["mean"], fps: t.fps as number, frames: t.frames as number, keys: keys.sort((a, b) => a[0] - b[0]) }
}
