// The scene's objects: overlays (pictures and videos over the frame) and
// planes (pictures and videos standing in the 3D scene). Where each sits, its
// keyed placement, when it is up, and an overlay's layer.
//
// The agent speaks seconds; keys and clips are stored in frames at 30fps. Each
// change goes through the setter the dock and the timeline use, so it plays,
// exports, saves and undoes like a hand edit. The agent cannot add or remove
// an object: the files are the user's to upload.

import type { DialKey } from "@/lib/effects"
import type { VisibilityWindow } from "@/lib/timeline"
import { FPS } from "@/lib/clip"
import { OVERLAY_FIELDS, overlayFieldsAt, type OverlayField } from "@/lib/overlays"
import { PLANE_FIELDS, planeFields, planeFieldsAt, type PlaneField } from "@/lib/planes"
import type { SceneTool, SceneToolHandles } from "@/lib/ai/scene-tools"

const toFrame = (s: number) => Math.max(0, Math.round(s * FPS))
const toSec = (f: number) => Math.round((f / FPS) * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const OVERLAY_RANGE: Record<OverlayField, [number, number]> = {
  x: [-1, 2],
  y: [-1, 2],
  size: [0.005, 3],
  rotation: [-180, 180],
  opacity: [0, 1],
}
const PLANE_RANGE: Record<PlaneField, [number, number]> = {
  scale: [0.001, 100],
  px: [-500, 500],
  py: [-500, 500],
  pz: [-500, 500],
  rx: [-180, 180],
  ry: [-180, 180],
  rz: [-180, 180],
}

const keysOut = (keys: Record<string, DialKey[]> | undefined) =>
  keys && Object.keys(keys).length
    ? Object.fromEntries(Object.entries(keys).map(([f, ks]) => [f, ks.map((k) => [toSec(k.frame), typeof k.value === "number" ? r3(k.value) : k.value])]))
    : undefined

const clipsOut = (ws: VisibilityWindow[] | undefined) =>
  ws?.length
    ? ws.map((w) => ({
        start: toSec(w.start),
        ...(w.end !== undefined ? { end: toSec(w.end) } : {}),
        ...(w.blendIn ? { fadeIn: toSec(w.blendIn) } : {}),
        ...(w.blendOut ? { fadeOut: toSec(w.blendOut) } : {}),
      }))
    : "always"

function clipsIn(clips: unknown): VisibilityWindow[] | null {
  if (!Array.isArray(clips)) return null
  const out: VisibilityWindow[] = []
  for (const c of clips as Record<string, unknown>[]) {
    const start = num(c?.start)
    if (start === undefined) continue
    const end = num(c.end)
    const w: VisibilityWindow = { start: toFrame(start) }
    if (end !== undefined && end > start) w.end = toFrame(end)
    const fi = num(c.fadeIn)
    const fo = num(c.fadeOut)
    if (fi) w.blendIn = toFrame(fi)
    if (fo && w.end !== undefined) w.blendOut = toFrame(fo)
    out.push(w)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** `{ field: [[seconds, value], …] }` over the keys there are: a field given
 *  replaces its keys, [] takes it off keys. */
function keysIn(
  arg: unknown,
  base: Record<string, DialKey[]> | undefined,
  fields: readonly string[],
  range: Record<string, [number, number]>,
  errors: string[],
): Record<string, DialKey[]> | undefined {
  const out = { ...(base ?? {}) }
  for (const [f, list] of Object.entries(arg as Record<string, unknown>)) {
    if (!fields.includes(f)) {
      errors.push(`no field "${f}" to key — fields are ${fields.join(", ")}`)
      continue
    }
    if (!Array.isArray(list)) {
      errors.push(`keys.${f} must be [[seconds, value], …]`)
      continue
    }
    const ks: DialKey[] = []
    for (const k of list) {
      if (!Array.isArray(k) || num(k[0]) === undefined || num(k[1]) === undefined) {
        errors.push(`keys.${f}: each key is [seconds, value]`)
        continue
      }
      const frame = toFrame(k[0] as number)
      const [lo, hi] = range[f]
      ks.push({ frame, value: clamp(k[1] as number, lo, hi) })
    }
    // One key per frame, the last given winning.
    const byFrame = new Map(ks.map((k) => [k.frame, k]))
    const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame)
    if (sorted.length) out[f] = sorted
    else delete out[f]
  }
  return Object.keys(out).length ? out : undefined
}

/** An object by id or name: overlays first, then planes. */
function findObject(h: SceneToolHandles, ref: unknown) {
  const r = String(ref ?? "")
  const low = r.toLowerCase()
  const o = h.overlays.find((x) => x.id === r) ?? h.overlays.find((x) => x.name.toLowerCase() === low)
  if (o) return { kind: "overlay" as const, o }
  const p = h.planes.find((x) => x.id === r) ?? h.planes.find((x) => x.name.toLowerCase() === low)
  if (p) return { kind: "plane" as const, p }
  return null
}

export const OBJECT_TOOLS: SceneTool[] = [
  {
    name: "get_objects",
    description:
      "The scene's objects. Overlays are pictures or videos laid over the finished frame (logos, stickers, captions, frames), listed bottom layer first: x/y are the centre as a share of the frame (0..1, y from the top), size is the height as a share of the frame's height (over 1 is bigger than the frame), rotation is degrees clockwise, opacity 0..1, layer 1 is the bottom. Planes are pictures or videos standing in the 3D scene: px/py/pz world position (a character is about 18 tall; y up), rx/ry/rz degrees, scale on the plane's own width × height. Each lists its keyed fields as { field: [[seconds, value], …] } and its clips (when it is visible).",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: {
        overlays: h.overlays.map((o, i) => ({
          id: o.id,
          name: o.name,
          kind: o.kind,
          layer: i + 1,
          ...Object.fromEntries(OVERLAY_FIELDS.map((f) => [f, r3(o[f])])),
          aspect: r3(o.aspect),
          ...(keysOut(o.keys) ? { keys: keysOut(o.keys) } : {}),
          clips: clipsOut(o.visibility),
        })),
        planes: h.planes.map((p) => ({
          id: p.id,
          name: p.name,
          width: r3(p.width),
          height: r3(p.height),
          ...Object.fromEntries(Object.entries(planeFields(p.transform)).map(([f, v]) => [f, r3(v)])),
          ...(keysOut(p.keys) ? { keys: keysOut(p.keys) } : {}),
          clips: clipsOut(p.visibility),
        })),
        ...(h.overlays.length + h.planes.length === 0 ? { note: "No objects. The user adds them in the Objects row (Add media); you cannot upload files." } : {}),
      },
    }),
  },
  {
    name: "update_object",
    description:
      "Change an overlay or a plane, by id or name. `set` moves fields (overlay: x, y, size, rotation, opacity; plane: px, py, pz, rx, ry, rz, scale): a field that has keys gets a key at the current time instead, as the editor's dials do. `keys` animates: { field: [[seconds, value], …] } replaces that field's keys, linear between them; [] stops animating it (it holds its set value). `clips` sets when it is visible (seconds, optional fadeIn/fadeOut), [] for always. `layer` restacks an overlay: 1 is the bottom, the count is the top.",
    parameters: {
      type: "object",
      properties: {
        object: { type: "string" },
        set: { type: "object", description: "Field → value." },
        keys: { type: "object", description: "Field → [[seconds, value], …]." },
        clips: {
          type: "array",
          items: {
            type: "object",
            properties: { start: { type: "number" }, end: { type: "number" }, fadeIn: { type: "number" }, fadeOut: { type: "number" } },
            required: ["start"],
          },
        },
        layer: { type: "number" },
      },
      required: ["object"],
    },
    run: async (args, h) => {
      const hit = findObject(h, args.object)
      if (!hit) return { data: { error: `no object "${args.object}" — get_objects lists them` } }
      const errors: string[] = []
      const frame = toFrame(h.time())
      const set = args.set && typeof args.set === "object" ? (args.set as Record<string, unknown>) : {}
      const clips = args.clips === undefined ? undefined : clipsIn(args.clips)
      if (args.clips !== undefined && clips === null) errors.push("clips must be a list")

      if (hit.kind === "overlay") {
        let o = hit.o
        const patch: Partial<Record<OverlayField, number>> = {}
        for (const [f, v] of Object.entries(set)) {
          if (!(OVERLAY_FIELDS as readonly string[]).includes(f)) errors.push(`no overlay field "${f}" — fields are ${OVERLAY_FIELDS.join(", ")}`)
          else if (num(v) === undefined) errors.push(`set.${f} must be a number`)
          else patch[f as OverlayField] = clamp(v as number, ...OVERLAY_RANGE[f as OverlayField])
        }
        let update: Parameters<SceneToolHandles["updateOverlay"]>[1] = {}
        if (args.keys && typeof args.keys === "object") {
          const keys = keysIn(args.keys, o.keys, OVERLAY_FIELDS, OVERLAY_RANGE, errors)
          update.keys = keys
          o = { ...o, keys }
        }
        if (Object.keys(patch).length) update = { ...update, ...overlayFieldsAt(o, patch, frame) }
        if (clips) update.visibility = clips.length ? clips : undefined
        if (Object.keys(update).length) h.updateOverlay(o.id, update)
        const layer = num(args.layer)
        if (layer !== undefined) h.reorderOverlay(o.id, Math.round(layer) - 1)
        return { data: { name: o.name, changed: [...Object.keys(update), ...(layer !== undefined ? ["layer"] : [])], ...(errors.length ? { errors } : {}) } }
      }

      let p = hit.p
      if (args.layer !== undefined) errors.push("layer is an overlay's; a plane stands in the scene")
      const patch: Partial<Record<PlaneField, number>> = {}
      for (const [f, v] of Object.entries(set)) {
        if (!(PLANE_FIELDS as readonly string[]).includes(f)) errors.push(`no plane field "${f}" — fields are ${PLANE_FIELDS.join(", ")}`)
        else if (num(v) === undefined) errors.push(`set.${f} must be a number`)
        else patch[f as PlaneField] = clamp(v as number, ...PLANE_RANGE[f as PlaneField])
      }
      let update: Parameters<SceneToolHandles["updatePlane"]>[1] = {}
      if (args.keys && typeof args.keys === "object") {
        const keys = keysIn(args.keys, p.keys, PLANE_FIELDS, PLANE_RANGE, errors)
        update.keys = keys
        p = { ...p, keys }
      }
      if (Object.keys(patch).length) update = { ...update, ...planeFieldsAt(p, patch, frame) }
      if (clips) update.visibility = clips.length ? clips : undefined
      if (Object.keys(update).length) h.updatePlane(p.id, update)
      return { data: { name: p.name, changed: Object.keys(update), ...(errors.length ? { errors } : {}) } }
    },
  },
]
