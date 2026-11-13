// The timed parts of a scene, in one place.
//
// A scene document is mostly a description of how things LOOK, and a little of
// it is a description of WHEN: the stretches each model is on stage for, the
// strips each effect plays in (at what level, on whom), and what each prop hangs
// from as the scene runs. Those used to be read off the document by whoever
// needed them — the preview tick built its own map of lanes, the export was
// handed another, the effect sync converted strips inline and the prop setters
// converted parent keys inline — four readings of one idea, each free to drift.
//
// This module is the reading. `timelineOf` turns document-shaped state into a
// `SceneTimeline`, pure and in FRAMES at 30fps; the rest is the two crossings
// to the engine, and there are exactly two because the engine owns two kinds of
// time:
//
//   pushTimeline        the DECLARATIVE parts — effect strips, influence and
//                       subjects, and prop parent tracks. The engine evaluates
//                       these itself on its own transport, so playback, a
//                       scrub, a warm-up pass and the offline export cannot
//                       disagree about them and none has to remember to tick
//                       them. Pushed when they change, never per frame.
//   applyTimelineFrame  the per-frame part — who is on stage. Evaluated here,
//                       on the frame the caller is drawing, because the
//                       engine's own dissolve scheduler only ever addresses
//                       cast subject 0 and a lane needs a named model.
//
// Seconds appear only inside those two, which is the boundary the rest of the
// app already keeps: documents and lanes count frames, the engine counts time.
//
// What is NOT here: the motion clip each model wears and the one audio track.
// Those are media the engine plays, not schedules the document authors, and they
// stay with their loaders.

import { windowToEngine, type EffectWindow } from "@/lib/effect-schedule"
import { FPS } from "@/lib/clip"
import type { DialKey } from "@/lib/effects"
import type { SceneParentKey } from "@/lib/scene"
import type { EffectParamKey, ModelParentKey, EffectWindow as EngineWindow } from "reze-engine"
import { parentKeysToEngine, parentTrackOf, type PropTrackSource } from "./parents"
import { visibilityAt, type VisibilityWindow } from "./visibility"
import { applyLampFrame } from "./lights"
import { applyStageTintFrame } from "./stage-tint"
import { applyUniformFrame } from "./uniforms"
import { applyPlaneFrame } from "./planes"
import type { SceneStageTransform } from "@/lib/scene"

export * from "./visibility"
export * from "./parents"
export * from "./lights"
export * from "./uniforms"
export * from "./planes"

/** One applied effect's timing, in list order — the order the engine installs
 *  them in, which is what an index into `effects` addresses. */
export type EffectTrack = {
  /** The level it reaches inside its strips, 0..1. */
  influence: number
  /** Its strips in frames, or null to play throughout. */
  window: EffectWindow[] | null
  /** Who it is on, by model id, or null for everyone. */
  models: string[] | null
  /** Its keyed dials, in frames, or null when none is keyed. */
  keys: Record<string, DialKey[]> | null
}

/** Everything in a scene that changes with the frame and is not a clip. */
export type SceneTimeline = {
  /**
   * Who is on stage when, by model id — cast, props and stage parts alike.
   *
   * Only SCHEDULED models are here. No lane means on stage throughout, and a
   * model left out is a model the frame loop never touches, which is what keeps
   * a scene that schedules nobody free of the whole feature.
   */
  visibility: Record<string, VisibilityWindow[]>
  /**
   * The parts of a model that come and go on their own — its materials' lanes,
   * by model id: the stockings until the chorus, a jacket from the bridge. Only
   * models with at least one such lane are here; the rest are worn throughout.
   */
  parts: Record<string, { materials: string[]; windows: VisibilityWindow[] }[]>
  /** Every applied effect's strip, influence and subjects, in list order. */
  effects: EffectTrack[]
  /** Every prop's parent track by id: its start hold at frame 0, then each
   *  switch. See parentTrackOf. */
  parents: Record<string, SceneParentKey[]>
  /** The keyed cards by model id: each one's placement and its keys. A card
   *  with no keys stands where it was put and is not here. */
  planes: Record<string, { transform: SceneStageTransform; keys: Record<string, DialKey[]> }>
}

/** What a timeline is read from. Every part is optional so a caller that owns
 *  one part — the effect sync owns the effect list, a prop setter owns one
 *  prop — builds the timeline of that part through the same function, and a
 *  push of it touches nothing else. */
export type TimelineSource = {
  models?: readonly {
    id: string
    visibility?: VisibilityWindow[]
    /** Its materials' own lanes, by material name. */
    materialVisibility?: Readonly<Record<string, VisibilityWindow[]>>
  }[]
  props?: readonly (PropTrackSource & { id: string })[]
  effects?: readonly { influence?: number; window?: EffectWindow[]; models?: string[]; keys?: Record<string, DialKey[]> }[]
  /** The cards: on stage by their lanes, placed by their keys. */
  planes?: readonly { id: string; transform: SceneStageTransform; visibility?: VisibilityWindow[]; keys?: Record<string, DialKey[]> }[]
}

/** The scene's timed parts, read off its state. Pure. */
export function timelineOf({ models = [], props = [], effects = [], planes = [] }: TimelineSource): SceneTimeline {
  const visibility: Record<string, VisibilityWindow[]> = {}
  for (const m of models) if (m.visibility?.length) visibility[m.id] = m.visibility
  // A card is a model to the engine, so its lane is one more model's.
  for (const p of planes) if (p.visibility?.length) visibility[p.id] = p.visibility
  const keyedPlanes: SceneTimeline["planes"] = {}
  for (const p of planes) {
    const keys = Object.fromEntries(Object.entries(p.keys ?? {}).filter(([, ks]) => ks.length > 0))
    if (Object.keys(keys).length) keyedPlanes[p.id] = { transform: p.transform, keys }
  }
  const parts: SceneTimeline["parts"] = {}
  for (const m of models) {
    const laned = Object.entries(m.materialVisibility ?? {}).filter(([, w]) => w.length > 0)
    if (laned.length) parts[m.id] = laned.map(([name, windows]) => ({ materials: [name], windows }))
  }
  const parents: Record<string, SceneParentKey[]> = {}
  for (const p of props) parents[p.id] = parentTrackOf(p)
  return {
    visibility,
    parts,
    effects: effects.map((e) => ({ influence: e.influence ?? 1, window: e.window ?? null, models: e.models ?? null, keys: e.keys ?? null })),
    parents,
    planes: keyedPlanes,
  }
}

/** Which dials were keyed on which instance at the last push, per engine — so
 *  a dial whose keys were all removed is handed back rather than left playing
 *  its old track. */
const pushedDials = new WeakMap<object, Map<number, Set<string>>>()

/** As much of the engine as the declarative push needs. */
type TimelineEngine = {
  setEffectInfluence(index: number, influence: number): void
  setEffectSchedule(index: number, windows: readonly EngineWindow[] | null): void
  setEffectSubjects(index: number, models: readonly string[] | null): void
  setEffectParamTrack(index: number, name: string, keys: readonly EffectParamKey[] | null): boolean
  setModelParentKeys(name: string, keys: readonly ModelParentKey[] | null): boolean
}

/**
 * The declarative parts onto the engine: every effect's timing and target, and
 * every prop's parent track. Idempotent — each is a write of a value the engine
 * keeps — so pushing again is harmless and pushing late is a correction.
 *
 * `effectIndex` maps list entry → engine instance. An entry that failed to
 * compile installs nothing, and every entry after it then sits one lower in the
 * engine than in the document; addressing instance i as entry i put one
 * effect's strips onto its neighbour for as long as the broken one stayed in
 * the scene. Null means the list is installed whole and in order.
 *
 * The same effect applied twice gets two strips rather than one shared between
 * them: an instance is a copy, and its timing belongs to that copy. So does the
 * cast it plays to, which is the whole point of aiming one copy at one dancer.
 *
 * A prop's track owns its position and rotation while it is set; its scale is
 * the transform's, and stays with whoever places it.
 */
/** A dial key as the engine reads it: seconds, and the curve in 0..1. */
export const keyToEngine = (key: DialKey): EffectParamKey => ({
  time: key.frame / FPS,
  value: key.value,
  ...(key.ease ? { ease: key.ease } : {}),
  ...(key.curve ? { curve: key.curve.map((n) => n / 127) as [number, number, number, number] } : {}),
})

export function pushTimeline(
  engine: TimelineEngine,
  timeline: SceneTimeline,
  effectIndex: readonly (number | null)[] | null = null,
): void {
  const prior = pushedDials.get(engine) ?? new Map<number, Set<string>>()
  const next = new Map<number, Set<string>>()
  timeline.effects.forEach((e, i) => {
    const k = effectIndex ? effectIndex[i] : i
    if (k == null) return
    // A lane emptied of clips is SILENT — kept, so a clip can be pasted back
    // into it — where no lane at all plays throughout. The engine reads an
    // empty schedule as none, so the silence goes as the level.
    engine.setEffectInfluence(k, e.window && e.window.length === 0 ? 0 : e.influence)
    // No clips plays from frame 0 throughout — what its lane draws — on the
    // transport like every other: unscheduled, the engine would run it on its
    // own clock from whenever it was installed.
    engine.setEffectSchedule(k, windowToEngine(e.window) ?? [{ start: 0 }])
    engine.setEffectSubjects(k, e.models)
    // Its keyed dials, frames crossing as seconds like the strips. A dial keyed
    // last push and not now is handed back to its plain value.
    const keyed = Object.entries(e.keys ?? {}).filter(([, ks]) => ks.length > 0)
    const names = new Set(keyed.map(([n]) => n))
    for (const n of prior.get(k) ?? []) if (!names.has(n)) engine.setEffectParamTrack(k, n, null)
    for (const [n, ks] of keyed) engine.setEffectParamTrack(k, n, ks.map(keyToEngine))
    next.set(k, names)
  })
  pushedDials.set(engine, next)
  for (const id in timeline.parents) engine.setModelParentKeys(id, parentKeysToEngine(timeline.parents[id]))
}

/** As much of the engine as the frame needs: who is loaded, and the dissolve dial. */
type FrameEngine = Parameters<typeof applyPlaneFrame>[0] & {
  getModel(id: string): { visible: boolean; setVisible(on: boolean): void } | null | undefined
  setModelDissolve(id: string, value: number): boolean
  setMaterialDissolve(id: string, values: Readonly<Record<string, number>> | null): boolean
}

/**
 * The timeline at one frame — who is on stage, how much of them, where the
 * keyed lamps stand and what the props' keyed material values are.
 *
 * The one crossing between the lanes and what is drawn, called from the
 * preview tick and from the export loop, both in CLIP frames: a lane is
 * authored against the 30fps VMD clock, so a 60fps render reads it at that
 * clock or every swap lands twice as early.
 *
 * Both writes are cheap and both are guarded against repeating themselves:
 * `setVisible` flips a flag the cull pass reads, and `setModelDissolve` returns
 * early when the value has not moved, so a scene of hard cuts pays a
 * comparison per scheduled model per frame and nothing else.
 *
 * Driving the dissolve from HERE rather than from the engine's own scheduler is
 * what makes it addressable: the engine's `#dissolve` effects only ever take
 * apart cast subject 0, while a costume swap needs a named model. The two do
 * not collide — `evaluateDissolves` resets only the models it drove itself.
 */
export function applyTimelineFrame(engine: FrameEngine, timeline: SceneTimeline, frame: number): void {
  // The lamps a game animated, at this frame (lights.ts). Nothing when none is
  // keyed or the frame has not moved.
  applyLampFrame(engine, frame)
  // A game stage's scene tint, as its show plays it (stage-tint.ts).
  applyStageTintFrame(engine, frame)
  // The game props' keyed material values, at this frame (uniforms.ts).
  // Nothing when no look keys any or the frame has not moved.
  applyUniformFrame(engine, frame)
  // The keyed cards, where their keys put them at this frame.
  applyPlaneFrame(engine, timeline.planes, frame)
  const lanes = timeline.visibility
  for (const id in lanes) {
    const model = engine.getModel(id)
    if (!model) continue
    const state = visibilityAt(lanes[id], frame)
    if (model.visible !== state.visible) model.setVisible(state.visible)
    engine.setModelDissolve(id, state.dissolve)
  }
  // The parts: each laned material, as much of it as its lane says is there —
  // off a stretch is gone, a ramp is the burn.
  for (const id in timeline.parts) {
    if (!engine.getModel(id)) continue
    const values: Record<string, number> = {}
    for (const part of timeline.parts[id]) {
      const state = visibilityAt(part.windows, frame)
      const v = state.visible ? state.dissolve : 0
      for (const name of part.materials) values[name] = Math.min(values[name] ?? 1, v)
    }
    engine.setMaterialDissolve(id, values)
  }
}

/**
 * A model's material lanes at frame 0, before it is first shown — seedLane's
 * reason: stockings that come ON at frame 0 must not show whole for the one
 * frame before the first tick.
 */
export function seedMaterialLanes(
  engine: Pick<FrameEngine, "setMaterialDissolve">,
  id: string,
  lanes: Readonly<Record<string, VisibilityWindow[]>> | undefined,
): void {
  if (!lanes) return
  const values: Record<string, number> = {}
  for (const [name, windows] of Object.entries(lanes)) {
    if (!windows.length) continue
    const state = visibilityAt(windows, 0)
    values[name] = state.visible ? state.dissolve : 0
  }
  if (Object.keys(values).length) engine.setMaterialDissolve(id, values)
}

/** As much of the engine as a lane's own bookkeeping needs. */
type LaneEngine = FrameEngine & { setModelPhysicsWhileHidden(id: string, on: boolean): boolean }

/**
 * A model arriving with a lane, before it is first shown.
 *
 * A scheduled model keeps simulating its cloth while it is off stage, so the
 * frame it appears on is a frame its skirt is already moving on — set before
 * the reveal, because the hiding starts at load. Its dissolve is seeded at
 * frame 0 for the same reason the reveal asks `visibleAt` instead of simply
 * showing her: a lane that dissolves her IN at frame 0 wants nothing of her on
 * screen yet, and a model revealed whole for the one frame before the first
 * tick is exactly the pop the feature exists to avoid.
 */
export function seedLane(engine: LaneEngine, id: string, windows: readonly VisibilityWindow[] | undefined): void {
  if (!windows?.length) return
  engine.setModelPhysicsWhileHidden(id, true)
  engine.setModelDissolve(id, visibilityAt(windows, 0).dissolve)
}

/**
 * A model's lane edited — the engine state that belongs to having one at all.
 *
 * Carrying a lane turns on cloth simulation while hidden: that is the whole
 * reason a costume swap reads as a cut rather than as a glitch, since a dress
 * simulated from rest at the moment it is revealed snaps into place in front
 * of the audience. A model whose lane is emptied goes back to costing nothing
 * while invisible — and back to WHOLE and SHOWN, because "on stage throughout"
 * is not something a model can be half dissolved or hidden for. The frame loop
 * stops visiting a model the moment its lane is gone, so whatever it last
 * wrote would otherwise stand: deleting the last clip with the playhead outside
 * it left the model hidden for good.
 */
export function laneChanged(engine: LaneEngine, id: string, windows: readonly VisibilityWindow[]): void {
  engine.setModelPhysicsWhileHidden(id, windows.length > 0)
  if (windows.length > 0) return
  engine.setModelDissolve(id, 1)
  const model = engine.getModel(id)
  if (model && !model.visible) model.setVisible(true)
}
