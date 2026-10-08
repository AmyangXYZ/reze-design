// When things happen: the music to time them by, and the scene's lanes —
// effects, lamps and who is on stage.
//
// The agent speaks seconds; the document stores frames at 30fps (lib/clip FPS),
// and every conversion is here. Each change goes through the same setter the
// timeline's own lanes use, so it plays, exports, saves and undoes like a hand
// edit.

import { builtinName } from "@/lib/builtin-text"
import type { EffectParamValue } from "reze-engine"
import { parseDirectives } from "reze-engine"
import type { AppliedEffect } from "@/lib/effects"
import type { EffectWindow } from "@/lib/effect-schedule"
import type { SceneLight, SceneLightTrack } from "@/lib/scene"
import type { VisibilityWindow } from "@/lib/timeline"
import { FPS } from "@/lib/clip"
import { primeAudioAnalysis } from "@/lib/audio-analysis"
import { summarizeMusic } from "@/lib/ai/music"
import type { SceneTool, SceneToolHandles } from "@/lib/ai/scene-tools"

const toFrame = (s: number) => Math.max(0, Math.round(s * FPS))
const toSec = (f: number) => Math.round((f / FPS) * 100) / 100
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A clip in the agent's seconds: when it starts, ends, and fades. */
type ClipArg = { start?: unknown; end?: unknown; fadeIn?: unknown; fadeOut?: unknown }

const CLIP_SCHEMA = {
  type: "object",
  properties: {
    start: { type: "number", description: "Seconds." },
    end: { type: "number", description: "Seconds; omit to run to the end of the scene." },
    fadeIn: { type: "number", description: "Seconds to ramp up; 0 is a hard cut." },
    fadeOut: { type: "number", description: "Seconds to ramp down before end." },
  },
  required: ["start"],
}

function windowsIn(clips: unknown): EffectWindow[] | null {
  if (!Array.isArray(clips)) return null
  const out: EffectWindow[] = []
  for (const c of clips as ClipArg[]) {
    const start = num(c?.start)
    if (start === undefined) continue
    const end = num(c.end)
    const w: EffectWindow = { start: toFrame(start) }
    if (end !== undefined && end > start) w.end = toFrame(end)
    const fi = num(c.fadeIn)
    const fo = num(c.fadeOut)
    if (fi) w.blendIn = toFrame(fi)
    if (fo && w.end !== undefined) w.blendOut = toFrame(fo)
    out.push(w)
  }
  return out.sort((a, b) => a.start - b.start)
}

const windowsOut = (ws: readonly (EffectWindow | VisibilityWindow)[] | undefined) =>
  (ws ?? []).map((w) => ({
    start: toSec(w.start),
    ...(w.end !== undefined ? { end: toSec(w.end) } : {}),
    ...(w.blendIn ? { fadeIn: toSec(w.blendIn) } : {}),
    ...(w.blendOut ? { fadeOut: toSec(w.blendOut) } : {}),
  }))

/** An applied effect by uid, else by name (the first copy). */
function findEffect(h: SceneToolHandles, ref: unknown): AppliedEffect | undefined {
  const r = String(ref ?? "")
  return h.effects.find((e) => e.uid === r) ?? h.effects.find((e) => e.name.toLowerCase() === r.toLowerCase())
}

/** Dials from the agent: numbers clamped to the author's range, colours from hex. */
function paramsIn(wgsl: string, args: unknown): { params: Record<string, EffectParamValue>; errors: string[] } {
  const params: Record<string, EffectParamValue> = {}
  const errors: string[] = []
  if (!args || typeof args !== "object") return { params, errors }
  const decls = parseDirectives(wgsl).directives.params
  for (const [name, value] of Object.entries(args as Record<string, unknown>)) {
    const d = decls.find((x) => x.name === name)
    if (!d) {
      errors.push(`no dial "${name}" — dials are ${decls.map((x) => x.name).join(", ") || "none"}`)
      continue
    }
    if (d.kind === "float") {
      const v = num(value)
      if (v === undefined) errors.push(`${name} must be a number`)
      else params[name] = clamp(v, d.min ?? -Infinity, d.max ?? Infinity)
    } else if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
      const n = parseInt(value.slice(1), 16)
      params[name] = { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 }
    } else if (Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === "number")) {
      params[name] = { x: value[0], y: value[1], z: value[2] }
    } else errors.push(`${name} must be ${d.kind === "color" ? "a #rrggbb colour" : "[x, y, z]"}`)
  }
  return { params, errors }
}

function charactersIn(h: SceneToolHandles, arg: unknown): string[] | undefined {
  if (!Array.isArray(arg) || arg.length === 0) return undefined
  const ids = (arg as unknown[])
    .map((a) => h.cast.find((c) => c.id === a || c.name.toLowerCase() === String(a).toLowerCase())?.id)
    .filter((x): x is string => Boolean(x))
  return ids.length ? ids : undefined
}

/** A lamp by id, else by name. */
const findLamp = (h: SceneToolHandles, ref: unknown) => {
  const r = String(ref ?? "")
  return h.lamps.find((l) => l.id === r) ?? h.lamps.find((l) => l.name.toLowerCase() === r.toLowerCase())
}

const vec3 = (v: unknown, lo: number, hi: number): [number, number, number] | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (v.map((x) => clamp(x as number, lo, hi)) as [number, number, number])
    : undefined

const LAMP_FIELDS = {
  name: { type: "string" },
  position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z], -100–100; the character is about 18 tall, standing at the origin." },
  color: { type: "string", description: "#rrggbb" },
  intensity: { type: "number", description: "0–1000; 20 is a warm bulb ten units out." },
  radius: { type: "number", description: "1–200, how far it reaches." },
  aim: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "A point to aim at — makes it a spotlight." },
  angle: { type: "number", description: "Spot cone, degrees 5–150." },
  on: { type: "boolean" },
}

/** Keyframes in the agent's seconds: [[seconds, value], …] per channel. */
function trackIn(arg: unknown): SceneLightTrack | undefined {
  if (!arg || typeof arg !== "object") return undefined
  const a = arg as Record<string, unknown>
  const track: SceneLightTrack = {}
  const keys = <T>(v: unknown, ok: (k: unknown[]) => T | null): T[] | undefined => {
    if (!Array.isArray(v)) return undefined
    const out = (v as unknown[]).map((k) => (Array.isArray(k) ? ok(k) : null)).filter((x): x is T => x !== null)
    return out.length ? out : undefined
  }
  track.intensity = keys(a.intensity, (k) => (typeof k[0] === "number" && typeof k[1] === "number" ? ([toFrame(k[0]), clamp(k[1], 0, 1000)] as [number, number]) : null))
  track.radius = keys(a.radius, (k) => (typeof k[0] === "number" && typeof k[1] === "number" ? ([toFrame(k[0]), clamp(k[1], 1, 200)] as [number, number]) : null))
  track.color = keys(a.color, (k) => (typeof k[0] === "number" && typeof k[1] === "string" && /^#[0-9a-f]{6}$/i.test(k[1]) ? ([toFrame(k[0]), k[1]] as [number, string]) : null))
  track.position = keys(a.position, (k) =>
    typeof k[0] === "number" && Array.isArray(k[1]) && k[1].length === 3
      ? ([toFrame(k[0]), ...(k[1] as number[]).map((x) => clamp(x, -100, 100))] as [number, number, number, number])
      : null,
  )
  for (const key of Object.keys(track) as (keyof SceneLightTrack)[]) {
    if (!track[key]) delete track[key]
    else (track[key] as [number, ...unknown[]][]).sort((x, y) => x[0] - y[0])
  }
  return Object.keys(track).length ? track : undefined
}

function lampOut(l: SceneLight) {
  return {
    id: l.id,
    name: l.name,
    position: l.position,
    color: l.color,
    intensity: l.intensity,
    radius: l.radius,
    ...(l.aim ? { aim: l.aim, angle: l.angle } : {}),
    on: l.on !== false,
    ...(l.stage ? { fromStage: true } : {}),
    ...(l.track ? { keyed: Object.keys(l.track) } : {}),
  }
}

export const TIMELINE_TOOLS: SceneTool[] = [
  {
    name: "get_music",
    description:
      "The song's timing: duration, tempo, every beat and downbeat, the hardest hits, and loudness sections (quiet/medium/loud — the loud ones are usually choruses). Read before placing anything in time. Detected downbeats can be off by a beat, so anchor big moments to the hits and section changes rather than to bar counts.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => {
      if (!h.musicUrl) return { data: { error: "the scene has no music" } }
      const analysis = await primeAudioAnalysis(h.musicUrl)
      if (!analysis) return { data: { error: "the music could not be analysed" } }
      return { data: summarizeMusic(analysis) }
    },
  },
  {
    name: "list_effects",
    description:
      "Effects that can be added: name, what it does, its dials (with ranges), and its natural length in seconds for one-shot effects (absent = ambient, runs as long as it is on).",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: h.effectLibrary.map((e) => {
        const d = parseDirectives(e.wgsl).directives
        const zh = builtinName("effect", e, "zh")
        return {
          name: e.name,
          // The name a Chinese-speaking user sees and types; pass `name`.
          ...(zh !== e.name ? { zh } : {}),
          about: e.description,
          ...(d.duration > 0 ? { seconds: Math.round(d.duration * 100) / 100 } : {}),
          dials: d.params.map((p) => ({
            name: p.name,
            kind: p.kind,
            default: p.value,
            ...(p.min !== undefined ? { min: p.min, max: p.max } : {}),
          })),
        }
      }),
    }),
  },
  {
    name: "get_effects",
    description: "The effects in the scene now: id, name, level, dials set, the clips it plays in (seconds), and which characters it is on.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: h.effects.map((e) => ({
        id: e.uid,
        name: e.name,
        influence: e.influence ?? 1,
        dials: e.params ?? {},
        clips: e.window?.length ? windowsOut(e.window) : "always",
        characters: e.models?.map((id) => h.cast.find((c) => c.id === id)?.name ?? id) ?? "all",
      })),
    }),
  },
  {
    name: "add_effect",
    description:
      "Add an effect by name from list_effects. Optionally when it plays (clips, in seconds), how strongly (influence 0–1), its dials, and which characters it is on. Several copies of one effect are fine — each is its own.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        clips: { type: "array", items: CLIP_SCHEMA, description: "When it plays; omit for the whole scene." },
        influence: { type: "number" },
        dials: { type: "object", description: "Dial name → value (number, #rrggbb, or [x,y,z])." },
        characters: { type: "array", items: { type: "string" }, description: "Names; omit for everyone." },
      },
      required: ["name"],
    },
    run: async (args, h) => {
      const def = h.effectLibrary.find((e) => e.name.toLowerCase() === String(args.name ?? "").toLowerCase())
      if (!def) return { data: { error: `no effect named "${args.name}" — see list_effects` } }
      const { params, errors } = paramsIn(def.wgsl, args.dials)
      const window = windowsIn(args.clips)
      const effect: AppliedEffect = {
        id: def.id,
        name: def.name,
        wgsl: def.wgsl,
        ...(window?.length ? { window } : {}),
        ...(num(args.influence) !== undefined ? { influence: clamp(num(args.influence)!, 0, 1) } : {}),
        ...(Object.keys(params).length ? { params } : {}),
        ...(charactersIn(h, args.characters) ? { models: charactersIn(h, args.characters) } : {}),
      }
      const uid = h.addEffect(effect)
      return { data: { id: uid, name: def.name, ...(errors.length ? { errors } : {}) } }
    },
  },
  {
    name: "update_effect",
    description: "Change an effect in the scene, by its id (or name): clips (replaces them all), influence, dials, characters.",
    parameters: {
      type: "object",
      properties: {
        effect: { type: "string", description: "Id from get_effects, or name." },
        clips: { type: "array", items: CLIP_SCHEMA, description: "Replaces its clips; [] plays it throughout." },
        influence: { type: "number" },
        dials: { type: "object" },
        characters: { type: "array", items: { type: "string" }, description: "[] for everyone." },
      },
      required: ["effect"],
    },
    run: async (args, h) => {
      const e = findEffect(h, args.effect)
      if (!e?.uid) return { data: { error: `no effect "${args.effect}" in the scene` } }
      const part: Partial<AppliedEffect> = {}
      const errors: string[] = []
      if (Array.isArray(args.clips)) part.window = windowsIn(args.clips) ?? []
      if (num(args.influence) !== undefined) part.influence = clamp(num(args.influence)!, 0, 1)
      if (args.dials) {
        const r = paramsIn(e.wgsl, args.dials)
        part.params = { ...(e.params ?? {}), ...r.params }
        errors.push(...r.errors)
      }
      if (Array.isArray(args.characters)) part.models = charactersIn(h, args.characters)
      h.patchEffect(e.uid, part)
      return { data: { id: e.uid, ...(errors.length ? { errors } : {}) } }
    },
  },
  {
    name: "remove_effect",
    description: "Take an effect out of the scene, by id (or name).",
    parameters: { type: "object", properties: { effect: { type: "string" } }, required: ["effect"] },
    run: async (args, h) => {
      const e = findEffect(h, args.effect)
      if (!e?.uid) return { data: { error: `no effect "${args.effect}" in the scene` } }
      h.removeEffect(e.uid)
      return { data: { removed: e.name } }
    },
  },
  {
    name: "get_lamps",
    description: "The scene's lamps (point and spot lights besides the sun): position, colour, intensity, reach, and which channels are keyed over time.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({ data: h.lamps.map(lampOut) }),
  },
  {
    name: "add_lamp",
    description:
      "Add a lamp. Lamps light by distance and cast no shadow — the sun is the only shadow. Use for coloured rim and accent light, practical lights on a set, or a light that pulses through the timeline via `keys`.",
    parameters: {
      type: "object",
      properties: {
        ...LAMP_FIELDS,
        keys: {
          type: "object",
          description:
            "Optional animation: { intensity: [[seconds, value], …], color: [[seconds, \"#rrggbb\"], …], radius: […], position: [[seconds, [x,y,z]], …] }. Linear between keys.",
        },
      },
    },
    run: async (args, h) => {
      const position = vec3(args.position, -100, 100) ?? h.cameraTarget
      const lamp: SceneLight = {
        id: h.newLampId(),
        name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : `Lamp ${h.lamps.length + 1}`,
        position,
        color: typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color) ? args.color : "#ffd9a0",
        intensity: clamp(num(args.intensity) ?? 20, 0, 1000),
        radius: clamp(num(args.radius) ?? 20, 1, 200),
      }
      const aim = vec3(args.aim, -100, 100)
      if (aim) {
        lamp.aim = aim
        lamp.angle = clamp(num(args.angle) ?? 40, 5, 150)
      }
      if (args.on === false) lamp.on = false
      const track = trackIn(args.keys)
      if (track) lamp.track = track
      h.setLamps((list) => [...list, lamp])
      return { data: lampOut(lamp) }
    },
  },
  {
    name: "update_lamp",
    description: "Change a lamp by id or name. `keys` replaces its animation; keys: {} makes it static again.",
    parameters: {
      type: "object",
      properties: { lamp: { type: "string" }, ...LAMP_FIELDS, keys: { type: "object" } },
      required: ["lamp"],
    },
    run: async (args, h) => {
      const l = findLamp(h, args.lamp)
      if (!l) return { data: { error: `no lamp "${args.lamp}"` } }
      const next: SceneLight = { ...l }
      if (typeof args.name === "string" && args.name.trim()) next.name = args.name.trim()
      const position = vec3(args.position, -100, 100)
      if (position) next.position = position
      if (typeof args.color === "string" && /^#[0-9a-f]{6}$/i.test(args.color)) next.color = args.color
      if (num(args.intensity) !== undefined) next.intensity = clamp(num(args.intensity)!, 0, 1000)
      if (num(args.radius) !== undefined) next.radius = clamp(num(args.radius)!, 1, 200)
      const aim = vec3(args.aim, -100, 100)
      if (aim) next.aim = aim
      if (num(args.angle) !== undefined) next.angle = clamp(num(args.angle)!, 5, 150)
      if (typeof args.on === "boolean") next.on = args.on
      if (args.keys !== undefined) {
        const track = trackIn(args.keys)
        if (track) next.track = track
        else delete next.track
      }
      // A hand on a stage's lamp makes it the scene's own.
      delete next.stage
      h.setLamps((list) => list.map((x) => (x.id === l.id ? next : x)))
      return { data: lampOut(next) }
    },
  },
  {
    name: "remove_lamp",
    description: "Delete a lamp by id or name.",
    parameters: { type: "object", properties: { lamp: { type: "string" } }, required: ["lamp"] },
    run: async (args, h) => {
      const l = findLamp(h, args.lamp)
      if (!l) return { data: { error: `no lamp "${args.lamp}"` } }
      h.setLamps((list) => list.filter((x) => x.id !== l.id))
      return { data: { removed: l.name } }
    },
  },
  {
    name: "get_visibility",
    description: "Who is on stage when: each character and prop, with the clips (seconds) it is visible in. No clips = on stage the whole time.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: h.lanes.map((m) => ({ id: m.id, name: m.name, kind: m.kind, clips: m.visibility.length ? windowsOut(m.visibility) : "always" })),
    }),
  },
  {
    name: "set_visibility",
    description:
      "Set when a character or prop is on stage, by name or id — replaces its clips. fadeIn/fadeOut dissolve it in and out instead of a hard cut. clips: [] puts it back on stage the whole time.",
    parameters: {
      type: "object",
      properties: { model: { type: "string" }, clips: { type: "array", items: CLIP_SCHEMA } },
      required: ["model", "clips"],
    },
    run: async (args, h) => {
      const r = String(args.model ?? "")
      const m = h.lanes.find((x) => x.id === r) ?? h.lanes.find((x) => x.name.toLowerCase() === r.toLowerCase())
      if (!m) return { data: { error: `no character or prop "${args.model}" — see get_visibility` } }
      const windows = (windowsIn(args.clips) ?? []) as VisibilityWindow[]
      h.setVisibility(m.id, windows)
      return { data: { name: m.name, clips: windows.length ? windowsOut(windows) : "always" } }
    },
  },
]
