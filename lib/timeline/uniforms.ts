// A prop's material values on the clock.
//
// A game prop's look (lib/unity-native.ts) dresses its materials in the game's
// shaders with the values the material held. Some of those values the game
// animates over a take — Aether Gazer's timeline material curves fade a pour
// stream's colour and raise its dissolve as the shaker sloshes — and ag-rip
// writes them beside the static ones as sparse keys on the clip clock (a look
// material's `uniforms`). Those are sampled HERE, at the frame the caller is
// drawing, by the same crossing that decides who is on stage
// (applyTimelineFrame), so playback, a scrub and the offline export show the
// same slosh on the same frame.
//
// The engine holds the values; it does not keep their time. A look with no
// keyed material registers nothing, and then nothing here runs.

/** One keyed value: a number or a vector, as a look's `values` hold it. */
export type UniformValue = number | number[]
/** A keyed value's keys, [clip frame, value], in frame order. */
export type UniformKey = [number, UniformValue]
/** Per material name (the model's), per uniform name, its keys. */
export type MaterialUniformTracks = Record<string, Record<string, UniformKey[]>>

/** A value at `frame`: linear between the keys around it, held before the
 *  first and after the last; two keys on one frame are a step, the later
 *  winning. Keys in frame order, at least one. */
export function uniformAt(keys: readonly UniformKey[], frame: number): UniformValue {
  const first = keys[0]
  if (keys.length === 1 || frame < first[0]) return first[1]
  const last = keys[keys.length - 1]
  if (frame >= last[0]) return last[1]
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid][0] <= frame) lo = mid
    else hi = mid
  }
  const [fa, a] = keys[lo]
  const [fb, b] = keys[hi]
  if (fb <= fa) return b
  const k = (frame - fa) / (fb - fa)
  if (typeof a === "number") return a + ((b as number) - a) * k
  return a.map((v, i) => v + ((b as number[])[i] - v) * k)
}

/** Every keyed value of one material at `frame`. */
export function materialUniformsAt(tracks: Record<string, UniformKey[]>, frame: number): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {}
  for (const name in tracks) if (tracks[name].length) out[name] = uniformAt(tracks[name], frame)
  return out
}

/** As much of the engine as the keyed values need. */
type UniformsEngine = {
  setModelNativeUniforms(name: string, material: string, values: Record<string, number | ArrayLike<number>>): boolean
}

type UniformState = { models: Map<string, MaterialUniformTracks>; frame: number }
const states = new WeakMap<object, UniformState>()

function apply(engine: UniformsEngine, id: string, tracks: MaterialUniformTracks, frame: number): void {
  for (const material in tracks) engine.setModelNativeUniforms(id, material, materialUniformsAt(tracks[material], frame))
}

/**
 * A dressed model's keyed material values, registered so applyUniformFrame
 * resamples them as the clock moves — or taken off with null (a look removed).
 * The model is set to the frame last drawn at once: a prop loaded while the
 * clock stands still is right before the clock next moves.
 */
export function setUniformTracks(engine: UniformsEngine, id: string, tracks: MaterialUniformTracks | null): void {
  let s = states.get(engine)
  if (!tracks || !Object.keys(tracks).length) {
    s?.models.delete(id)
    return
  }
  if (!s) states.set(engine, (s = { models: new Map(), frame: 0 }))
  s.models.set(id, tracks)
  apply(engine, id, tracks, s.frame)
}

/** Every registered model let go: the scene is cleared. */
export function clearUniformTracks(engine: object): void {
  states.delete(engine)
}

/**
 * The keyed material values at `frame` (clip frames). A scene with none, or
 * a frame the values are already at, costs a lookup and a comparison; the
 * engine uploads only the values that moved.
 */
export function applyUniformFrame(engine: object, frame: number): void {
  const s = states.get(engine)
  if (!s || s.frame === frame) return
  s.frame = frame
  for (const [id, tracks] of s.models) apply(engine as UniformsEngine, id, tracks, frame)
}
