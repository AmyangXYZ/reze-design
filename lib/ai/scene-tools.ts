// The agent's hands on the scene: read it, change it, look at it.
//
// Plain functions over handles the editor supplies — no model, no provider, no
// React. Each tool is a name, what it does in words the model reads, a JSON
// schema for its arguments, and `run`. The editor builds the handles from its
// own state every render (hooks/use-scene-tools); the agent loop turns these
// into whatever its provider calls a tool.
//
// Every change goes through the same paths a person's does — the settings
// patcher, the camera applier — so it syncs to the engine, autosaves, and lands
// in undo exactly like a hand edit.

import type { Engine, StyleGroup } from "reze-engine"
import type { AppliedEffect } from "@/lib/effects"
import type { BackdropMedia } from "@/lib/backdrop"
import type { SceneCamera, SceneLight } from "@/lib/scene"
import type { VisibilityWindow } from "@/lib/timeline"
import type { LookPack } from "@/lib/materials"
import { LOOK_TOOLS } from "@/lib/ai/look-tools"
import { TIMELINE_TOOLS } from "@/lib/ai/timeline-tools"
import type { SceneSettings } from "@/lib/scene-settings"
import type { CaptureView } from "@/lib/video-export"
import { recentLogs } from "@/lib/crash-log"
import { checkSettingsPatch, readableSettings } from "@/lib/ai/settings-schema"
import type { FrameMetrics } from "@/lib/ai/image-metrics"
import type { ShaderGraph } from "reze-engine"
import { SEEING_TOOLS, captureMeasured, frameData, imagesOf } from "@/lib/ai/seeing-tools"
import { AUTHOR_TOOLS } from "@/lib/ai/author-tools"
import { afterRender } from "@/lib/ai/after-render"
import { ANGLES, FIGURE_BONES, SHOTS, frameShot, type Angle, type Figure, type Shot } from "@/lib/ai/framing"

export type SceneToolHandles = {
  /** Read when a tool runs — the engine and its canvas live in refs. */
  engine: () => Engine | null
  canvas: () => HTMLCanvasElement | null
  settings: SceneSettings
  /** The editor's settings patcher — one section, merged. */
  patchSettings: (section: keyof SceneSettings, part: Record<string, unknown>) => void
  camera: SceneCamera
  /** The editor's camera applier: writes the document's camera and the engine's. */
  setCamera: (next: SceneCamera) => void
  /** Characters (not stages), in scene order. */
  cast: { id: string; name: string }[]
  stageCount: number
  groups: Record<string, StyleGroup[]>
  hidden: Record<string, string[]>
  effects: AppliedEffect[]
  /** Effects that can be added: built-ins, community, your drafts. */
  effectLibrary: { id: string; name: string; description: string; wgsl: string }[]
  /** Append a copy; returns its uid. */
  addEffect: (effect: AppliedEffect) => string
  patchEffect: (uid: string, part: Partial<AppliedEffect>) => void
  removeEffect: (uid: string) => void
  lamps: SceneLight[]
  setLamps: (update: (list: SceneLight[]) => SceneLight[]) => void
  newLampId: () => string
  /** Where a lamp with no position goes: the orbit centre, where you are looking. */
  cameraTarget: [number, number, number]
  /** Characters and props with their visibility clips (frames). */
  lanes: { id: string; name: string; kind: "character" | "prop"; visibility: VisibilityWindow[] }[]
  setVisibility: (id: string, windows: VisibilityWindow[]) => void
  /** Shaders a group can wear: built-ins and community, with what they are for. */
  shaderLibrary: { name: string; about: string }[]
  /** Put a library shader on a group; returns an error to report, or null. */
  assignShader: (modelId: string, groupId: string, shader: string) => string | null
  /** Replace a group's shader graph (its values tuned) and wait for it to
   *  compile; resolves to an error to report, or null. */
  setGroupGraph: (modelId: string, groupId: string, graph: ShaderGraph) => Promise<string | null>
  applyLookPack: (pack: LookPack) => void
  musicUrl: string | null
  /** Scene time in seconds, and its length. */
  time: () => number
  duration: number
  /** Move the whole scene to `seconds`, settling physics. */
  seek: (seconds: number) => void
  backdrop: BackdropMedia | null
  backgroundColor: string
  /** The aspect the scene is framed at (export width / height). */
  aspect: number
  /** The built-in default scene's look, camera, effects and lamps — what
   *  "back to default" means. Its cast, motion and music are not here: those
   *  are the user's content, not the look. */
  defaults: { settings: SceneSettings; camera: SceneCamera; effects: AppliedEffect[]; lamps: SceneLight[] }
  /** Replace the whole effect list (uids minted where missing). */
  replaceEffects: (effects: AppliedEffect[]) => void
  /** Compile a new or rewritten effect against the whole scene, as the effect
   *  editor's ⌘Enter does. On success it is saved as a draft and worn —
   *  in place of `replace` (a scene effect's id or name) when given. On
   *  failure the scene is put back and the diagnostics come home. */
  authorEffect: (
    name: string,
    wgsl: string,
    replace?: string,
  ) => Promise<{ ok: boolean; diagnostics: string[]; name?: string; uid?: string; params?: { name: string; kind: string; value: unknown; min?: number; max?: number }[]; duration?: number }>
  /** A library shader's whole graph, by name — drafts, community, built-ins. */
  graphSource: (name: string) => ShaderGraph | null
  /** Save a graph as a draft: a draft of that name is updated, any other name
   *  gets a fresh one. Returns the name it was saved under. */
  saveGraphDraft: (name: string, graph: ShaderGraph) => string
}

/** The settings sections that make up the look — what reset_to_default puts
 *  back. Not audio (the user's mix) and not the stage's own claims. */
const LOOK_SECTIONS = ["world", "sun", "fill", "bloom", "dof", "outline", "background", "view", "grain", "grade", "ground", "eyes"] as const
const RESET_PARTS = ["look", "camera", "effects", "lamps"] as const

export type ToolImage = { dataUrl: string; label: string; metrics: FrameMetrics }

/** What a tool returns: data for the model to read, and images for it to see. */
export type ToolResult = { data: unknown; images?: ToolImage[] }

export type SceneTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, handles: SceneToolHandles) => Promise<ToolResult>
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** The camera as the agent reads and writes it: angles in degrees, which is how
 *  people and models both think about a shot. */
function cameraOut(c: SceneCamera) {
  return {
    yaw: r2((c.alpha * 180) / Math.PI),
    pitch: r2((c.beta * 180) / Math.PI),
    distance: r2(c.distance),
    fov: r2(((c.fov ?? Math.PI / 4) * 180) / Math.PI),
    target: c.target.map(r2),
    roll: r2(((c.roll ?? 0) * 180) / Math.PI),
    followsBone: Boolean(c.follow),
  }
}

const CAMERA_PARAMS = {
  yaw: { type: "number", description: "Degrees around the character; 180 is from the front, 0 from behind." },
  pitch: { type: "number", description: "Degrees from straight above; 90 is eye level, under 90 looks down, over 90 looks up." },
  distance: { type: "number", description: "From the target, world units; the character is about 18 tall." },
  fov: { type: "number", description: "Vertical field of view, degrees (10–90). Narrow is telephoto, flat and flattering." },
  target: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Point looked at, [x, y, z] — or, while the camera follows a bone (followsBone), the offset from that bone." },
  roll: { type: "number", description: "Tilt in degrees, positive clockwise; 0 is level." },
}

const deg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? (v * Math.PI) / 180 : undefined)

/** A camera from the agent's degrees, over the one it replaces. */
function cameraIn(args: Record<string, unknown>, base: SceneCamera): SceneCamera {
  const next: SceneCamera = { ...base }
  const yaw = deg(args.yaw)
  const pitch = deg(args.pitch)
  const fov = deg(args.fov)
  const roll = deg(args.roll)
  if (yaw !== undefined) next.alpha = yaw
  if (pitch !== undefined) next.beta = Math.min(Math.PI - 0.05, Math.max(0.05, pitch))
  if (typeof args.distance === "number" && Number.isFinite(args.distance)) next.distance = Math.min(500, Math.max(2, args.distance))
  if (fov !== undefined) next.fov = Math.min((90 * Math.PI) / 180, Math.max((10 * Math.PI) / 180, fov))
  if (roll !== undefined) next.roll = roll
  if (Array.isArray(args.target) && args.target.length === 3 && args.target.every((n) => typeof n === "number")) {
    next.target = args.target as [number, number, number]
  }
  return next
}

/** Where a character's head, chest, hips and feet are now, in world space. */
export function figureOf(engine: Engine, id: string): Figure | null {
  const model = engine.getModel(id)
  if (!model) return null
  const at = model.position
  const world = (names: readonly string[]): [number, number, number] | null => {
    for (const name of names) {
      const b = model.getBoneWorldPosition(name)
      if (b) return [b.x + at.x, b.y + at.y, b.z + at.z]
    }
    return null
  }
  const head = world(FIGURE_BONES.head)
  const chest = world(FIGURE_BONES.chest)
  const hips = world(FIGURE_BONES.hips)
  if (!head || !chest || !hips) return null
  // The lower foot: a raised leg must not lift the frame's floor.
  let feet: [number, number, number] | null = null
  for (const name of FIGURE_BONES.feet) {
    const b = model.getBoneWorldPosition(name)
    if (b && (!feet || b.y + at.y < feet[1])) feet = [b.x + at.x, b.y + at.y, b.z + at.z]
  }
  return { head, chest, hips, feet: feet ?? [hips[0], 0, hips[2]] }
}

export function subjectId(h: SceneToolHandles, subject: unknown): string | null {
  if (typeof subject === "string") {
    const hit = h.cast.find((c) => c.id === subject || c.name.toLowerCase() === subject.toLowerCase())
    if (hit) return hit.id
  }
  return h.cast[0]?.id ?? null
}

type ShotRequest = { shot: Shot; angle: Angle; subject?: string }

const SHOT_SCHEMA = {
  type: "object",
  properties: {
    shot: { type: "string", enum: SHOTS, description: "closeup = head and shoulders, medium = waist up, full = whole body, wide = body with room around." },
    angle: { type: "string", enum: ANGLES },
    subject: { type: "string", description: "Character name or id; the first character when omitted." },
  },
  required: ["shot", "angle"],
}

const CORE_TOOLS: SceneTool[] = [
  {
    name: "get_scene",
    description:
      "Read the scene: every look setting you can change (with current values), the camera, the characters and their material groups, effects, and the timeline. Each request already arrives with this; call it only for fresh state partway through a run.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: {
        settings: readableSettings(h.settings),
        camera: cameraOut(h.camera),
        cameraMotion: (() => {
          const engine = h.engine()
          return engine ? engine.getCameraClip().length > 0 && engine.isCameraVmdEnabled() : false
        })(),
        characters: h.cast.map((c) => ({
          id: c.id,
          name: c.name,
          groups: (h.groups[c.id] ?? []).map((g) => ({
            id: g.id,
            name: g.label ?? g.id,
            shader: g.graph.name ?? null,
            materials: g.materials.length,
          })),
          hiddenMaterials: h.hidden[c.id] ?? [],
        })),
        stages: h.stageCount,
        effects: h.effects.map((e) => ({ id: e.uid, name: e.name, influence: e.influence ?? 1, timed: Boolean(e.window?.length) })),
        lamps: h.lamps.length,
        hasMusic: Boolean(h.musicUrl),
        timeline: { time: r2(h.time()), duration: r2(h.duration) },
      },
    }),
  },
  {
    name: "set_settings",
    description:
      "Change look settings. Pass only the sections and fields to change, e.g. { sun: { strength: 1.2, elevation: 20 }, bloom: { intensity: 0.6 } }. Values outside a field's range are clamped and reported.",
    parameters: {
      type: "object",
      properties: { patch: { type: "object", description: "Sections of fields, as the settings reference in your instructions lists them." } },
      required: ["patch"],
    },
    run: async (args, h) => {
      const check = checkSettingsPatch(args.patch)
      for (const [section, fields] of Object.entries(check.apply)) {
        if (!fields) continue
        // A preset by name is the built-in itself: drop any custom grade values
        // and provenance left from before, or they would win over it.
        const part = section === "grade" && "preset" in fields ? { ...fields, spec: undefined, from: undefined } : fields
        h.patchSettings(section as keyof SceneSettings, part)
      }
      return { data: { applied: check.apply, clamped: check.clamped, errors: check.errors } }
    },
  },
  {
    name: "reset_to_default",
    description:
      "Put parts of the scene back to the editor's built-in default: `look` (sun, world light, bloom, tone, grade, outline, background, ground…), `camera`, `effects`, `lamps`. Omit `parts` for all four. The characters, their motion and the music stay — this resets how the scene looks, not what is in it. The user can undo it like any change.",
    parameters: {
      type: "object",
      properties: { parts: { type: "array", items: { type: "string", enum: RESET_PARTS } } },
    },
    run: async (args, h) => {
      const asked = Array.isArray(args.parts) && args.parts.length ? (args.parts as string[]) : [...RESET_PARTS]
      const unknown = asked.filter((p) => !(RESET_PARTS as readonly string[]).includes(p))
      if (unknown.length) return { data: { error: `unknown part ${unknown.join(", ")} — parts are ${RESET_PARTS.join(", ")}` } }
      const d = h.defaults
      const reset: string[] = []
      if (asked.includes("look")) {
        for (const section of LOOK_SECTIONS) {
          const value = d.settings[section as keyof SceneSettings]
          if (value && typeof value === "object") h.patchSettings(section as keyof SceneSettings, value as Record<string, unknown>)
        }
        reset.push("look")
      }
      if (asked.includes("camera")) {
        h.setCamera(d.camera)
        reset.push("camera")
      }
      if (asked.includes("effects")) {
        h.replaceEffects(d.effects)
        reset.push(`effects (${d.effects.map((e) => e.name).join(", ") || "none"})`)
      }
      if (asked.includes("lamps")) {
        h.setLamps(() => d.lamps)
        reset.push(`lamps (${d.lamps.length})`)
      }
      return { data: { reset } }
    },
  },
  {
    name: "set_camera",
    description:
      "Set the scene's camera exactly — the angle it is published and exported with. Pass only what changes. Prefer frame_shot to compose by shot; use this to fine-tune after looking. Distance and fov are different choices: the same size of figure from far with a narrow fov flattens her and shows less background, from close with a wide one exaggerates depth. Leave headroom, and room on the side she faces or moves toward.",
    parameters: { type: "object", properties: CAMERA_PARAMS },
    run: async (args, h) => {
      const next = cameraIn(args, h.camera)
      h.setCamera(next)
      return { data: { camera: cameraOut(next) } }
    },
  },
  {
    name: "frame_shot",
    description:
      "Compose the scene's camera by shot and angle, measured from the character's actual pose — e.g. a closeup from three-quarter-left. Commits the camera; call capture afterwards to check it.",
    parameters: SHOT_SCHEMA,
    run: async (args, h) => {
      const engine = h.engine()
      const id = subjectId(h, args.subject)
      if (!engine || !id) return { data: { error: "no character to frame" } }
      const fig = figureOf(engine, id)
      if (!fig) return { data: { error: "this character has no standard MMD bones to frame by" } }
      const view = frameShot(fig, args.shot as Shot, args.angle as Angle, h.camera.fov ?? Math.PI / 4, h.aspect)
      // Framing a shot means the camera stops riding a bone: the target is now
      // a point the shot was measured to.
      const next: SceneCamera = { ...h.camera, alpha: view.alpha, beta: view.beta, distance: view.distance, target: view.target, follow: undefined }
      h.setCamera(next)
      return { data: { camera: cameraOut(next) } }
    },
  },
  {
    name: "capture",
    description:
      "Look at the scene: renders small stills and measures them — the whole frame (luminance, clipping, saturation, tint, palette) and BY REGION: each character, each of her material groups (face, hair, skin, clothes…) and the background, with where it sits in the frame and whether it is cut off, its brightness in stops from mid-grey (the scene's light before tone mapping and before effects drawn over the frame — `look` is what is actually shown), the light reaching it (in the sun, in a cast shadow, turned away; sun vs lamps vs ambient), its depth, and how far each character stands out from the background. With no views, the camera as it is. With `shots` or `views`, try other angles WITHOUT moving the scene's camera; several come back as one labelled contact sheet.",
    parameters: {
      type: "object",
      properties: {
        shots: { type: "array", items: SHOT_SCHEMA, maxItems: 4, description: "Shots to try." },
        views: { type: "array", items: { type: "object", properties: CAMERA_PARAMS }, maxItems: 4, description: "Exact cameras to try." },
        size: { type: "number", description: "Long side in pixels, 256–768; default 512." },
        separate: { type: "boolean", description: "Several views as separate images instead of one contact sheet." },
      },
    },
    run: async (args, h) => {
      const engine = h.engine()
      if (!engine) return { data: { error: "the scene is not ready" } }
      const long = Math.min(768, Math.max(256, typeof args.size === "number" ? args.size : 512))

      const requests: { label: string; view: CaptureView | null }[] = []
      const fov = h.camera.fov ?? Math.PI / 4
      for (const s of (Array.isArray(args.shots) ? args.shots : []) as ShotRequest[]) {
        const id = subjectId(h, s.subject)
        const fig = id ? figureOf(engine, id) : null
        if (fig) requests.push({ label: `${s.shot} ${s.angle}`, view: frameShot(fig, s.shot, s.angle, fov, h.aspect) })
      }
      for (const v of (Array.isArray(args.views) ? args.views : []) as Record<string, unknown>[]) {
        const c = cameraIn(v, h.camera)
        requests.push({
          label: `yaw ${r2((c.alpha * 180) / Math.PI)} pitch ${r2((c.beta * 180) / Math.PI)} distance ${r2(c.distance)}`,
          view: { alpha: c.alpha, beta: c.beta, distance: c.distance, target: c.target, fov: c.fov, roll: c.roll },
        })
      }
      if (requests.length === 0) requests.push({ label: "current camera", view: null })
      // Several views are told apart by letter on the sheet.
      if (requests.length > 1) requests.forEach((r, i) => (r.label = `${String.fromCharCode(65 + i)}: ${r.label}`))

      const measured = await captureMeasured(h, requests, long)
      if ("error" in measured) return { data: measured }
      return {
        data: { views: measured.map(frameData), exposure: measured[0]?.frame.aovs?.exposure ?? null },
        images: await imagesOf(measured, args.separate !== true),
      }
    },
  },
  {
    name: "seek",
    description: "Move the scene to a moment, in seconds, so a capture shows that pose.",
    parameters: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] },
    run: async (args, h) => {
      const t = Math.min(h.duration || 0, Math.max(0, typeof args.seconds === "number" ? args.seconds : 0))
      h.seek(t)
      // Let a frame pass so the pose and physics have landed before a capture.
      await afterRender()
      return { data: { time: r2(t) } }
    },
  },
  {
    name: "read_console",
    description: "Recent warnings and errors from the editor and the GPU — read when something looks broken.",
    parameters: { type: "object", properties: {} },
    run: async () => ({ data: recentLogs().slice(-20).map((l) => `${l.level}: ${l.text}`) }),
  },
]

/** Every tool, in the order the agent reads them. */
export const SCENE_TOOLS: SceneTool[] = [...CORE_TOOLS, ...SEEING_TOOLS, ...LOOK_TOOLS, ...TIMELINE_TOOLS, ...AUTHOR_TOOLS]

/** Run a tool by name; an unknown name or a throw comes back as an error for
 *  the model to read, never as an exception through the loop. */
export async function runSceneTool(name: string, args: Record<string, unknown>, handles: SceneToolHandles): Promise<ToolResult> {
  const tool = SCENE_TOOLS.find((t) => t.name === name)
  if (!tool) return { data: { error: `no tool named ${name}` } }
  // By time, not count: the log is a bounded ring, so once full its length
  // stops moving while entries still arrive.
  const since = Date.now()
  let result: ToolResult
  try {
    result = await tool.run(args ?? {}, handles)
  } catch (e) {
    result = { data: { error: e instanceof Error ? e.message : String(e) } }
  }
  // Anything the editor or the GPU complained about while the tool ran rides
  // back with its result: the model should not have to think to look.
  const raised = recentLogs()
    .filter((l) => l.at >= since)
    .slice(-8)
    .map((l) => `${l.level}: ${l.text}`)
  if (raised.length && result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
    result = { ...result, data: { ...(result.data as Record<string, unknown>), console: raised } }
  } else if (raised.length) {
    result = { ...result, data: { result: result.data, console: raised } }
  }
  return result
}
