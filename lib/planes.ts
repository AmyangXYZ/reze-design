// A card's placement as dials: for the dock's panel and the timeline's curves,
// as an overlay's fields are (lib/overlays).

import type { EffectParamDecl } from "reze-engine"
import type { DialKey } from "@/lib/effects"
import type { SceneStageTransform } from "@/lib/scene"
import { PLANE_FIELDS, planeFields, withPlaneFields, type PlaneField } from "@/lib/timeline/planes"

export { PLANE_FIELDS, planeFields, type PlaneField }

const RANGE: Record<PlaneField, [number, number]> = {
  scale: [0.05, 10],
  px: [-50, 50],
  py: [-50, 50],
  pz: [-50, 50],
  rx: [-180, 180],
  ry: [-180, 180],
  rz: [-180, 180],
}

/** A card's fields as dials: the plain value is each one's default, so an
 *  unkeyed field shows where the card stands. */
export function planeDecls(t: SceneStageTransform, label: Record<PlaneField, string>): EffectParamDecl[] {
  const v = planeFields(t)
  return PLANE_FIELDS.map((f) => ({ name: f, kind: "float", value: v[f], min: RANGE[f][0], max: RANGE[f][1], label: label[f] }))
}

/** Every keyed field keyed afresh, one per name. */
export function withKeys(keys: Record<string, DialKey[]> | undefined, field: string, next: DialKey[] | undefined) {
  const out = { ...(keys ?? {}) }
  if (next?.length) out[field] = next
  else delete out[field]
  return Object.keys(out).length ? out : undefined
}

/** A key at `frame` with `value`, over any already there. */
export function keyAt(old: DialKey[] | undefined, frame: number, value: number): DialKey[] {
  const kept = old?.find((k) => k.frame === frame)
  return [...(old ?? []).filter((k) => k.frame !== frame), { ...(kept ?? {}), frame, value }].sort((a, b) => a.frame - b.frame)
}

/**
 * Fields set at a frame, as an update: a keyed field gets a key there, the
 * rest go into the plain transform — what moving a dial does.
 */
export function planeFieldsAt(
  p: { transform: SceneStageTransform; keys?: Record<string, DialKey[]> },
  patch: Partial<Record<PlaneField, number>>,
  frame: number,
): { transform?: SceneStageTransform; keys?: Record<string, DialKey[]> } {
  const plain: Partial<Record<PlaneField, number>> = {}
  let keys = p.keys
  for (const [f, v] of Object.entries(patch) as [PlaneField, number][]) {
    if (keys?.[f]?.length) keys = withKeys(keys, f, keyAt(keys[f], frame, v))
    else plain[f] = v
  }
  return {
    ...(Object.keys(plain).length ? { transform: withPlaneFields(p.transform, plain) } : {}),
    ...(keys !== p.keys ? { keys } : {}),
  }
}

/** Every field keyed at `frame` with the value it shows there: recording the
 *  card's state as it stands. */
export function recordAll(
  keys: Record<string, DialKey[]> | undefined,
  values: Record<string, number>,
  frame: number,
): Record<string, DialKey[]> {
  const out = { ...(keys ?? {}) }
  for (const [f, v] of Object.entries(values)) out[f] = keyAt(out[f], frame, v)
  return out
}
