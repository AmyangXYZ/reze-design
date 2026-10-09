// The look beyond settings: a custom colour grade, the shader each material
// group wears, and whole rendering styles. What matching a reference image
// mostly comes down to — a painting's palette is a grade, its brushwork a
// shader.

import { builtinName, tagLabel } from "@/lib/builtin-text"
import type { GradeSpec, Range } from "@/lib/grade"
import { specOf } from "@/lib/grade"
import { loadDrafts } from "@/lib/drafts"
import type { GradeItem } from "@/lib/library"
import { LOOK_PACKS, LOOK_PACK_ORDER, sameGraphLook, type LookPack } from "@/lib/materials"
import { NODE_REGISTRY, compileGraph, type ShaderGraph, type StyleGroup } from "reze-engine"
import type { SceneTool, SceneToolHandles } from "@/lib/ai/scene-tools"

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

/** A character and one of her groups from the agent's words, or what is wrong. */
function groupOf(h: SceneToolHandles, character: unknown, group: unknown): { id: string; name: string; group: StyleGroup } | { error: string } {
  const c = h.cast.find((m) => m.id === character || m.name.toLowerCase() === String(character ?? "").toLowerCase()) ?? h.cast[0]
  if (!c) return { error: "no character" }
  const g = String(group ?? "").toLowerCase()
  const found = (h.groups[c.id] ?? []).find((x) => x.id.toLowerCase() === g || (x.label ?? "").toLowerCase() === g)
  if (!found) return { error: `no group "${group}" on ${c.name} — groups are ${(h.groups[c.id] ?? []).map((x) => x.id).join(", ")}` }
  return { id: c.id, name: c.name, group: found }
}

type SocketValue = number | number[]
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * A graph's values that can be turned: every input a node takes as a literal —
 * not wired from another node, and not one that only means something wired.
 * These are the numbers the graph editor's fields show: a ramp's positions and
 * colours, a rim's strength, a tint.
 */
export function tunableInputs(graph: ShaderGraph): { node: string; type: string; inputs: Record<string, SocketValue> }[] {
  const wired = new Set(graph.links.map((l) => `${l.to.node}.${l.to.socket}`))
  const out: { node: string; type: string; inputs: Record<string, SocketValue> }[] = []
  for (const node of graph.nodes) {
    const spec = NODE_REGISTRY[node.type]
    if (!spec) continue
    const inputs: Record<string, SocketValue> = {}
    for (const [socket, input] of Object.entries(spec.inputs)) {
      if (input.requiresLink || wired.has(`${node.id}.${socket}`)) continue
      const v = node.inputs?.[socket] ?? input.default
      if (typeof v === "number") inputs[socket] = r4(v)
      else if (Array.isArray(v)) inputs[socket] = v.map(r4)
    }
    if (Object.keys(inputs).length) out.push({ node: node.id, type: node.type, inputs })
  }
  return out
}

/** The graph with `changes` written into its nodes' literal inputs, or the
 *  first change that does not fit. */
export function tuneGraph(
  graph: ShaderGraph,
  changes: unknown,
): { graph: ShaderGraph; applied: { node: string; socket: string; value: SocketValue }[] } | { error: string } {
  if (!Array.isArray(changes) || changes.length === 0) return { error: "changes must be a list of { node, socket, value }" }
  const tunable = new Map(tunableInputs(graph).map((t) => [t.node, t.inputs]))
  const nodes = graph.nodes.map((n) => ({ ...n, inputs: { ...(n.inputs ?? {}) } }))
  const applied: { node: string; socket: string; value: SocketValue }[] = []
  for (const c of changes as { node?: unknown; socket?: unknown; value?: unknown }[]) {
    const node = String(c?.node ?? "")
    const socket = String(c?.socket ?? "")
    const now = tunable.get(node)?.[socket]
    if (now === undefined) return { error: `${node}.${socket} is not a value that can be changed — see get_shader_inputs` }
    const v = c.value
    const fits =
      typeof now === "number"
        ? typeof v === "number" && Number.isFinite(v)
        : Array.isArray(v) && v.length === now.length && v.every((x) => typeof x === "number" && Number.isFinite(x))
    if (!fits) return { error: `${node}.${socket} takes ${typeof now === "number" ? "a number" : `${now.length} numbers`}` }
    const target = nodes.find((n) => n.id === node)!
    target.inputs[socket] = v as never
    applied.push({ node, socket, value: v as SocketValue })
  }
  return { graph: { ...graph, nodes }, applied }
}

export const LOOK_TOOLS: SceneTool[] = [
  {
    name: "set_grade",
    description:
      "Grade colour by tonal range — the main tool for matching a reference's palette. Shadows, midtones and highlights each take a hue, an amount and a lightness; plus overall contrast and saturation. Pass only what changes; the rest keeps the current grade. Compare captures' shadow/highlight tint and luminance percentiles against the reference. The result is saved to the user's grade drafts and worn.",
    parameters: {
      type: "object",
      properties: {
        shadows: RANGE_SCHEMA,
        midtones: RANGE_SCHEMA,
        highlights: RANGE_SCHEMA,
        contrast: { type: "number", description: "0.5–1.6; 1 untouched." },
        saturation: { type: "number", description: "0–2; 1 untouched, 0 black and white." },
        intensity: { type: "number", description: "0–1, how much of the grade applies." },
        name: { type: "string", description: "What to call the grade in the user's library, e.g. \"Dusk Teal\". Only used the first time; later calls keep refining that same grade." },
      },
    },
    run: async (args, h) => {
      // Against the drafts too: a grade picked from the user's own shelf is
      // worn by name with no inline spec, and would otherwise read as Neutral.
      const base = specOf(h.settings.grade, loadDrafts().grade as GradeItem[])
      const spec: GradeSpec = {
        shadows: rangeIn(args.shadows, base.shadows),
        midtones: rangeIn(args.midtones, base.midtones),
        highlights: rangeIn(args.highlights, base.highlights),
        contrast: clamp(args.contrast, 0.5, 1.6, base.contrast),
        saturation: clamp(args.saturation, 0, 2, base.saturation),
      }
      const intensity = clamp(args.intensity, 0, 1, h.settings.grade.intensity)
      // Saved as a draft and worn by that name, as the grade editor's save does:
      // a look that lived only in the scene has no library row to publish, and
      // the scene could never be published past it.
      const name = h.saveGradeDraft(spec, typeof args.name === "string" ? args.name : undefined)
      h.patchSettings("grade", { preset: name, spec, intensity, from: undefined })
      return {
        data: {
          saved: name,
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
      "The material shaders that can go on a character's groups — the built-ins by look pack and the community ones, with what each is for — and the whole-scene look packs.",
    parameters: { type: "object", properties: {} },
    run: async (_args, h) => ({
      data: {
        // Each with the name a Chinese-speaking user sees and types (`zh`);
        // pass the English `name` / `pack`.
        shaders: h.shaderLibrary.map((s) => {
          const zh = builtinName("graph", s, "zh")
          return zh !== s.name ? { ...s, zh } : s
        }),
        lookPacks: LOOK_PACK_ORDER.map((p) => {
          const zh = tagLabel(LOOK_PACKS[p].tag, "zh")
          return { pack: p, style: LOOK_PACKS[p].tag, ...(zh !== LOOK_PACKS[p].tag ? { zh } : {}), transform: LOOK_PACKS[p].transform }
        }),
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
      const found = groupOf(h, args.character, args.group)
      if ("error" in found) return { data: found }
      const error = h.assignShader(found.id, found.group.id, String(args.shader ?? ""))
      return { data: error ? { error } : { character: found.name, group: found.group.id, shader: args.shader } }
    },
  },
  {
    name: "get_shader_inputs",
    description:
      "The values inside one group's shader that can be tuned — each node (ramp, rim, tint, specular…) with its literal inputs: shadow ramp positions and colours, strengths, tints. Read before set_shader_inputs. Colours are linear [r, g, b] or [r, g, b, a].",
    parameters: {
      type: "object",
      properties: {
        character: { type: "string", description: "Character name or id." },
        group: { type: "string", description: "Group id or name, as get_scene lists them." },
      },
      required: ["group"],
    },
    run: async (args, h) => {
      const found = groupOf(h, args.character, args.group)
      if ("error" in found) return { data: found }
      return { data: { character: found.name, group: found.group.id, shader: found.group.graph.name ?? null, nodes: tunableInputs(found.group.graph) } }
    },
  },
  {
    name: "set_shader_inputs",
    description:
      "Tune one group's shader without swapping it: set node inputs by node id and socket, as get_shader_inputs lists them — e.g. move a toon ramp's edge, warm a shadow colour, strengthen a rim. Like editing the values in the graph editor; it lands in undo.",
    parameters: {
      type: "object",
      properties: {
        character: { type: "string", description: "Character name or id." },
        group: { type: "string", description: "Group id or name." },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              node: { type: "string" },
              socket: { type: "string" },
              value: { description: "A number, or [r, g, b] / [r, g, b, a] for a colour: the shape the input already has." },
            },
            required: ["node", "socket", "value"],
          },
        },
      },
      required: ["group", "changes"],
    },
    run: async (args, h) => {
      const found = groupOf(h, args.character, args.group)
      if ("error" in found) return { data: found }
      const tuned = tuneGraph(found.group.graph, args.changes)
      if ("error" in tuned) return { data: tuned }
      // A tuned graph is no longer the library item it is named after, so it is
      // saved as a draft and worn under that name — the graph editor's own save.
      // Kept under its old name it blocked publishing as that item, which IS
      // published, with no draft anywhere to publish instead. A group already
      // wearing one of the user's drafts updates it in place. Checked to compile
      // first, so a dud never reaches the library.
      let graph = tuned.graph
      let saved: string | undefined
      if (!sameGraphLook(graph, found.group.graph)) {
        const compiled = compileGraph(graph)
        const errors = compiled.diagnostics.filter((d) => d.severity === "error")
        if (!compiled.ok || errors.length) return { data: { error: "the tuned shader did not compile", diagnostics: errors.slice(0, 6).map((d) => d.message) } }
        saved = h.saveGraphDraft(graph.name || "Shader", graph)
        graph = { ...graph, name: saved }
      }
      const error = await h.setGroupGraph(found.id, found.group.id, graph)
      return { data: error ? { error } : { character: found.name, group: found.group.id, applied: tuned.applied, ...(saved ? { saved } : {}) } }
    },
  },
  {
    name: "apply_look_pack",
    description:
      "Switch the whole scene to a rendering style: every character's groups take that style's shader for their role, and the style's tone transform and world light come with it — and, for the styles that define them, its sun and bloom. The biggest single change of look — try it first when a reference is clearly one style.",
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
