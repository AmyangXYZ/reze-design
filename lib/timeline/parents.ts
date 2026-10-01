// What a prop hangs from, over the scene — MMD's 外部親 on the timeline.
//
// A prop's row holds its START: `attach` and the transform are the hold it is
// in before anything is keyed. The timeline's Parent band keys the switches
// after it, each at a frame. Read together they are one track, and this file is
// the one place that reads them together — the band that draws the holds, the
// throw planner that solves a catch against them and the engine that plays them
// all ask `parentTrackOf`, so none of the three can see a hold the others miss.
//
// FRAMES here, as everywhere in the document. Seconds appear in
// `parentKeysToEngine` and nowhere else.

import { Quat, Vec3, type ModelParentKey } from "reze-engine"
import { FPS } from "@/lib/clip"
import type { SceneAttach, SceneParentKey } from "@/lib/scene"

/** As much of a prop as its track is made of. PropInfo is one; so is anything
 *  shaped like the document's row. */
export type PropTrackSource = {
  attach: SceneAttach | null
  transform: { position: [number, number, number]; rotation: [number, number, number] }
  parentKeys: SceneParentKey[]
}

/**
 * Every hold on a prop's track, in order: the start its row sets, at frame 0,
 * then each key the timeline placed after it.
 *
 * A key AT frame 0 is dropped rather than played. Frame 0 is the start hold's,
 * and the row is what edits it; the setter never writes such a key, so only a
 * hand-edited document has one, and two holds at one frame would be a hold the
 * band draws and the engine resolves by sort order.
 */
export function parentTrackOf(p: PropTrackSource): SceneParentKey[] {
  const start: SceneParentKey = {
    frame: 0,
    model: p.attach?.model ?? null,
    ...(p.attach ? { bone: p.attach.bone } : {}),
    position: p.transform.position,
    rotation: p.transform.rotation,
  }
  return [start, ...p.parentKeys.filter((k) => k.frame > 0)]
}

/** Degrees per axis → the engine's quaternion, in MMD's own euler order.
 *  Shared by the loader, the sliders and the parent track so none of them can
 *  disagree about what a number in the document means. */
export function castRotationToEngine(rotation: [number, number, number]): Quat {
  const rad = (d: number) => (d * Math.PI) / 180
  return Quat.fromEuler(rad(rotation[0]), rad(rotation[1]), rad(rotation[2]))
}

/** A track in the engine's terms — frames to seconds, degrees to a quaternion
 *  through the same converter the sliders use. */
export function parentKeysToEngine(track: readonly SceneParentKey[]): ModelParentKey[] {
  return track.map((k) => ({
    time: k.frame / FPS,
    parent: k.model,
    ...(k.bone ? { bone: k.bone } : {}),
    position: new Vec3(k.position[0], k.position[1], k.position[2]),
    rotation: castRotationToEngine(k.rotation),
    ...(k.tween ? { tween: true } : {}),
  }))
}
