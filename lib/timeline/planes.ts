// The planes' keyed placement: where each card stands at a frame, and the
// write of it onto the engine, for the preview tick and the export alike.

import { Vec3, type ModelTransform } from "reze-engine"
import { dialAt, type DialKey } from "@/lib/effects"
import type { SceneStageTransform } from "@/lib/scene"
import { castRotationToEngine } from "./parents"

/** The fields a card keys, in the order its dials and curve tabs list them. */
export const PLANE_FIELDS = ["scale", "px", "py", "pz", "rx", "ry", "rz"] as const
export type PlaneField = (typeof PLANE_FIELDS)[number]

/** A transform as its fields, one number each. */
export function planeFields(t: SceneStageTransform): Record<PlaneField, number> {
  return {
    scale: t.scale,
    px: t.position[0],
    py: t.position[1],
    pz: t.position[2],
    rx: t.rotation[0],
    ry: t.rotation[1],
    rz: t.rotation[2],
  }
}

/** Fields back into a transform, over the one they came from. */
export function withPlaneFields(t: SceneStageTransform, f: Partial<Record<PlaneField, number>>): SceneStageTransform {
  return {
    scale: f.scale ?? t.scale,
    position: [f.px ?? t.position[0], f.py ?? t.position[1], f.pz ?? t.position[2]],
    rotation: [f.rx ?? t.rotation[0], f.ry ?? t.rotation[1], f.rz ?? t.rotation[2]],
  }
}

/** A card's transform at a frame (30fps clip frames): each keyed field through
 *  its keys, the rest as placed. */
export function planeTransformAt(
  p: { transform: SceneStageTransform; keys?: Record<string, DialKey[]> },
  frame: number,
): SceneStageTransform {
  if (!p.keys) return p.transform
  const at: Partial<Record<PlaneField, number>> = {}
  for (const f of PLANE_FIELDS) {
    const ks = p.keys[f]
    if (!ks?.length) continue
    const v = dialAt(ks, frame)
    if (typeof v === "number") at[f] = v
  }
  return withPlaneFields(p.transform, at)
}

/** What each keyed card was last set to, per engine, so a still frame writes nothing. */
const shown = new WeakMap<object, Map<string, string>>()

type PlaneEngine = { setModelTransform(id: string, t: Partial<ModelTransform>): void }

/** Every keyed card where its keys put it at this frame. */
export function applyPlaneFrame(
  engine: PlaneEngine,
  planes: Record<string, { transform: SceneStageTransform; keys: Record<string, DialKey[]> }>,
  frame: number,
): void {
  let last = shown.get(engine)
  if (!last) shown.set(engine, (last = new Map()))
  for (const id in planes) {
    const t = planeTransformAt(planes[id], frame)
    const stamp = `${t.scale},${t.position.join(",")},${t.rotation.join(",")}`
    if (last.get(id) === stamp) continue
    last.set(id, stamp)
    engine.setModelTransform(id, {
      position: new Vec3(t.position[0], t.position[1], t.position[2]),
      rotation: castRotationToEngine(t.rotation),
      scale: t.scale,
    })
  }
}

/** A card's keys changed or went: the next frame writes it again. */
export function forgetPlaneFrame(engine: object, id: string): void {
  shown.get(engine)?.delete(id)
}
