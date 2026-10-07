// The look beyond settings: a custom colour grade, the shader each material
// group wears, and whole rendering styles. What matching a reference image
// mostly comes down to — a painting's palette is a grade, its brushwork a
// shader.

import type { GradeSpec, Range } from "@/lib/grade"
import { specOf } from "@/lib/grade"
import { LOOK_PACKS, LOOK_PACK_ORDER, type LookPack } from "@/lib/materials"
import type { SceneTool } from "@/lib/ai/scene-tools"

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d

/** A tonal range from the agent's words over the one it replaces. Hue in
 *  degrees, amount 0–1 (how far the range is pushed toward it), lightness 0–1
 *  with 0.5 untouched (lower crushes, higher lifts). */
function rangeIn(arg: unknown, base: Range): Range {
  if (!arg || typeof arg !== "object") return base
  const a = arg as { hue?: unknown; amount?: unknown; lightness?: unknown }
  const hue = (((clamp(a.hue, -720, 720, base[0]) % 360) + 360) % 360)
  return [hue, clamp(a.amount, 0, 1, base[1]), clamp(a.lightness, 0, 1, base[2] ?? 0.5)]
}

const rangeOut = (r: Range) => ({ hue: Math.round(r[0]), amount: Math.round(r[1] * 100) / 100, lightness: Math.round((r[2] ?? 0.5) * 100) / 100 })

const RANGE_SCHEMA = {
  type: "object",
  properties: {
    hue: { type: "number", description: "Degrees the range is tinted toward: 0 red, 35 warm/orange, 60 yellow, 120 green, 210 cool blue, 270 violet, 320 magenta." },
    amount: { type: "number", description: "0–1, how strongly. 0.1–0.3 is a grade; above 0.5 is a filter." },
    lightness: { type: "number", description: "0–1, 0.5 untouched; below crushes this range darker, above lifts it." },
  },
}

export const LOOK_TOOLS: SceneTool[] = [
  {
    name: "set_grade",
    description:
      "Grade colour by tonal range — the main tool for matching a reference's palette. Shadows, midtones and highlights each take a hue, an amount and a lightness; plus overall contrast and saturation. Pass only what changes; the rest keeps the current grade. Compare captures' shadow/highlight tint and luminance percentiles against the reference.",
    parameters: {
      type: "object",
      properties: {
        shadows: RANGE_SCHEMA,
        midtones: RANGE_SCHEMA,
        highlights: RANGE_SCHEMA,
        contrast: { type: "number", description: "0.5–1.6; 1 untouched." },
        saturation: { type: "number", description: "0–2; 1 untouched, 0 black and white." },
        intensity: { type: "number", description: "0–1, how much of the grade applies." },
      },
    },
    run: async (args, h) => {
      const base = specOf(h.settings.grade)
      const spec: GradeSpec = {
        shadows: rangeIn(args.shadows, base.shadows),
        midtones: rangeIn(args.midtones, base.midtones),
        highlights: rangeIn(args.highlights, base.highlights),
        contrast: clamp(args.contrast, 0.5, 1.6, base.contrast),
        saturation: clamp(args.saturation, 0, 2, base.saturation),
      }
      const intensity = clamp(args.intensity, 0, 1, h.settings.grade.intensity)
      h.patchSettings("grade", { preset: "Custom", spec, intensity, from: undefined })
      return {
        data: {
          grade: {
            shadows: rangeOut(spec.shadows),
            midtones: rangeOut(spec.midtones),
            highlights: rangeOut(spec.highlights),
            contrast: spec.contrast,
            saturation: spec.saturation,
            intensity,
          },
        },
      }
    },
  },
  {
    name: "list_shaders",
    description:
      "The material shaders that can go on a character's groups: built-ins by game style (AG = Aether Gazer, WuWa = Wuthering Waves, ZZZ = Zenless Zone Zero, HSR = Honkai Star Rail) and community ones, with what each is for. Also the whole-scene look packs.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: {
        shaders: h.shaderLibrary,
        lookPacks: LOOK_PACK_ORDER.map((p) => ({ pack: p, style: LOOK_PACKS[p].tag, transform: LOOK_PACKS[p].transform })),
      },
    }),
  },
  {
    name: "assign_shader",
    description: "Put a shader on one material group of a character, by the shader's name from list_shaders. Groups are in get_scene.",
    parameters: {
      type: "object",
      properties: {
        character: { type: "string", description: "Character name or id." },
        group: { type: "string", description: "Group id or name, e.g. hair, Body." },
        shader: { type: "string", description: "Shader name, e.g. AG Hair." },
      },
      required: ["group", "shader"],
    },
    run: async (args, h) => {
      const c =
        h.cast.find((m) => m.id === args.character || m.name.toLowerCase() === String(args.character ?? "").toLowerCase()) ?? h.cast[0]
      if (!c) return { data: { error: "no character" } }
      const g = String(args.group ?? "").toLowerCase()
      const group = (h.groups[c.id] ?? []).find((x) => x.id.toLowerCase() === g || (x.label ?? "").toLowerCase() === g)
      if (!group) return { data: { error: `no group "${args.group}" on ${c.name} — groups are ${(h.groups[c.id] ?? []).map((x) => x.id).join(", ")}` } }
      const error = h.assignShader(c.id, group.id, String(args.shader ?? ""))
      return { data: error ? { error } : { character: c.name, group: group.id, shader: args.shader } }
    },
  },
  {
    name: "apply_look_pack",
    description:
      "Switch the whole scene to a game's rendering style: every character's groups take that style's shader for their role, and the tone transform and world light come with it. The sun stays. The biggest single change of look — try it first when a reference is clearly one game's style.",
    parameters: {
      type: "object",
      properties: { pack: { type: "string", enum: LOOK_PACK_ORDER } },
      required: ["pack"],
    },
    run: async (args, h) => {
      const pack = args.pack as LookPack
      if (!LOOK_PACK_ORDER.includes(pack)) return { data: { error: `pack must be one of ${LOOK_PACK_ORDER.join(", ")}` } }
      h.applyLookPack(pack)
      return { data: { pack, style: LOOK_PACKS[pack].tag } }
    },
  },
]
