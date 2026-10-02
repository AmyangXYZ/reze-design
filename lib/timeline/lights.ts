// A scene's lamps on the clock.
//
// Most lamps stand still, and for them nothing here runs: the scene sync hands
// the engine its list once, when the list changes. A lamp a game animated —
// Aether Gazer's character rigs are swept around her with the shot — carries a
// `track` (SceneLightTrack), and that lamp is sampled HERE, at the frame the
// caller is drawing, by the same crossing that decides who is on stage
// (applyTimelineFrame). So playback, a scrub and the offline export light her
// from the same place on the same frame.
//
// The engine holds the lamps; it does not keep their time. The scene sync owns
// the parts of the list that are not lamps — the stage's daylight — so it
// registers the whole rig here (setLampRig) and this module resamples it.

import type { SceneLight, SceneLightTrack } from "@/lib/scene"

/** One channel's value at `frame`: linear between the keys around it, held
 *  before the first and after the last. Keys in frame order. */
function sample<V extends number[]>(keys: [number, ...V][], frame: number): V {
  const first = keys[0]
  const rest = (k: [number, ...V]) => k.slice(1) as V
  if (keys.length === 1 || frame <= first[0]) return rest(first)
  const last = keys[keys.length - 1]
  if (frame >= last[0]) return rest(last)
  let lo = 0
  let hi = keys.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid][0] <= frame) lo = mid
    else hi = mid
  }
  const a = keys[lo]
  const b = keys[hi]
  const span = b[0] - a[0]
  // Two keys on one frame are a step; the later wins.
  if (span <= 0) return rest(b)
  const k = (frame - a[0]) / span
  return rest(a).map((v, i) => v + ((b[i + 1] as number) - v) * k) as V
}

/** "#rrggbb" ⇄ its three bytes, so a colour key interpolates as numbers and
 *  comes back as the hex every other colour in the document is. */
const bytes = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const hex = (c: number[]) => "#" + c.map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, "0")).join("")

/** Whether any channel of this track has a key. */
export function isKeyed(track: SceneLightTrack | undefined): track is SceneLightTrack {
  return !!track && !!(track.position?.length || track.radius?.length || track.intensity?.length || track.color?.length)
}

/** A lamp at a clip frame: each keyed channel in place of its plain field. A
 *  lamp without a track is returned as it is. */
export function lampAt(l: SceneLight, frame: number): SceneLight {
  const t = l.track
  if (!isKeyed(t)) return l
  return {
    ...l,
    ...(t.position?.length ? { position: sample(t.position, frame) } : {}),
    ...(t.radius?.length ? { radius: sample(t.radius, frame)[0] } : {}),
    ...(t.intensity?.length ? { intensity: sample(t.intensity, frame)[0] } : {}),
    ...(t.color?.length ? { color: hex(sample(t.color.map(([f, c]) => [f, ...bytes(c)] as [number, number, number, number]), frame)) } : {}),
  }
}

/**
 * Everything setLights takes, as the scene sync composes it: `fixed` (the
 * stage's daylight, already in the engine's form) and the lamps, which `toEngine`
 * turns into the engine's form once sampled.
 */
export type LampRig<E> = {
  fixed: E[]
  lamps: SceneLight[]
  toEngine: (l: SceneLight) => E
}

type RigState = { rig: LampRig<unknown>; keyed: boolean; frame: number }
const rigs = new WeakMap<object, RigState>()

/**
 * The scene sync's lamps onto the engine, sampled at the frame last drawn, and
 * remembered so that applyLampFrame can resample the keyed ones as the clock
 * moves. Called whenever the list changes.
 */
export function setLampRig<E>(engine: { setLights(lights: E[]): void; captureReflectionProbe(): void }, rig: LampRig<E>): void {
  const prev = rigs.get(engine)
  const frame = prev?.frame ?? 0
  const keyed = rig.lamps.some((l) => isKeyed(l.track))
  rigs.set(engine, { rig: rig as LampRig<unknown>, keyed, frame })
  engine.setLights([...rig.fixed, ...rig.lamps.map((l) => rig.toEngine(keyed ? lampAt(l, frame) : l))])
  // The stage's reflection probe holds the lamps as they stand: an edit to
  // the list re-captures it. Playback (applyLampFrame) does not — a probe is
  // baked against the scene, not re-rendered for every keyed frame.
  engine.captureReflectionProbe()
}

/**
 * The keyed lamps at `frame` (clip frames). A scene with none, or a frame the
 * lamps are already at, costs a lookup and a comparison.
 */
export function applyLampFrame(engine: object, frame: number): void {
  const s = rigs.get(engine)
  if (!s || s.frame === frame) return
  s.frame = frame
  if (!s.keyed) return
  const { fixed, lamps, toEngine } = s.rig
  ;(engine as { setLights(lights: unknown[]): void }).setLights([...fixed, ...lamps.map((l) => toEngine(lampAt(l, frame)))])
}
