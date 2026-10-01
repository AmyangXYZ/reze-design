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
import type { SceneParentKey } from "@/lib/scene"
import type { ModelParentKey, EffectWindow as EngineWindow } from "reze-engine"
import { parentKeysToEngine, parentTrackOf, type PropTrackSource } from "./parents"
import { visibilityAt, type VisibilityWindow } from "./visibility"

export * from "./visibility"
export * from "./parents"

/** One applied effect's timing, in list order — the order the engine installs
 *  them in, which is what an index into `effects` addresses. */
export type EffectTrack = {
  /** The level it reaches inside its strips, 0..1. */
  influence: number
  /** Its strips in frames, or null to play throughout. */
  window: EffectWindow[] | null
  /** Who it is on, by model id, or null for everyone. */
  models: string[] | null
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
  /** Every applied effect's strip, influence and subjects, in list order. */
  effects: EffectTrack[]
  /** Every prop's parent track by id: its start hold at frame 0, then each
   *  switch. See parentTrackOf. */
  parents: Record<string, SceneParentKey[]>
}

/** What a timeline is read from. Every part is optional so a caller that owns
 *  one part — the effect sync owns the effect list, a prop setter owns one
 *  prop — builds the timeline of that part through the same function, and a
 *  push of it touches nothing else. */
export type TimelineSource = {
  models?: readonly { id: string; visibility?: VisibilityWindow[] }[]
  props?: readonly (PropTrackSource & { id: string })[]
  effects?: readonly { influence?: number; window?: EffectWindow[]; models?: string[] }[]
}

/** The scene's timed parts, read off its state. Pure. */
export function timelineOf({ models = [], props = [], effects = [] }: TimelineSource): SceneTimeline {
  const visibility: Record<string, VisibilityWindow[]> = {}
  for (const m of models) if (m.visibility?.length) visibility[m.id] = m.visibility
  const parents: Record<string, SceneParentKey[]> = {}
  for (const p of props) parents[p.id] = parentTrackOf(p)
  return {
    visibility,
    effects: effects.map((e) => ({ influence: e.influence ?? 1, window: e.window ?? null, models: e.models ?? null })),
    parents,
  }
}

/** As much of the engine as the declarative push needs. */
type TimelineEngine = {
  setEffectInfluence(index: number, influence: number): void
  setEffectSchedule(index: number, windows: readonly EngineWindow[] | null): void
  setEffectSubjects(index: number, models: readonly string[] | null): void
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
export function pushTimeline(
  engine: TimelineEngine,
  timeline: SceneTimeline,
  effectIndex: readonly (number | null)[] | null = null,
): void {
  timeline.effects.forEach((e, i) => {
    const k = effectIndex ? effectIndex[i] : i
    if (k == null) return
    engine.setEffectInfluence(k, e.influence)
    engine.setEffectSchedule(k, windowToEngine(e.window))
    engine.setEffectSubjects(k, e.models)
  })
  for (const id in timeline.parents) engine.setModelParentKeys(id, parentKeysToEngine(timeline.parents[id]))
}

/** As much of the engine as the frame needs: who is loaded, and the dissolve dial. */
type FrameEngine = {
  getModel(id: string): { visible: boolean; setVisible(on: boolean): void } | null | undefined
  setModelDissolve(id: string, value: number): boolean
}

/**
 * The timeline at one frame — who is on stage, and how much of them.
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
  const lanes = timeline.visibility
  for (const id in lanes) {
    const model = engine.getModel(id)
    if (!model) continue
    const state = visibilityAt(lanes[id], frame)
    if (model.visible !== state.visible) model.setVisible(state.visible)
    engine.setModelDissolve(id, state.dissolve)
  }
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
