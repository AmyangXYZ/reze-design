// The AI writing new shaders: WGSL effects and material shader graphs.
//
// Everything else the AI does is choosing and tuning what exists. These tools
// let it make what does not: an effect no library entry gives, a material
// look no built-in graph has. The path is the editor's own —
//
//   effects  guarded (lib/ai/wgsl-guard: nothing that can loop forever), its
//            directives parsed, then compiled AGAINST THE WHOLE SCENE as the
//            effect editor's ⌘Enter does. Broken: the scene is put back and
//            the compiler's line:col diagnostics come home to fix. Working:
//            saved as one of the user's drafts, and worn.
//   graphs   validated and compiled in the tab with no GPU (compileGraph),
//            then saved as a draft and put on the material group, whose own
//            compile is awaited too.
//
// So what the AI makes is the user's, in their library, editable in the same
// editors, and undoable like any change. How to write either is read on
// demand (read_authoring_guide) from the user manual's own pages.

import { compileGraph, parseDirectives, type ShaderGraph } from "reze-engine"
import type { SceneTool, SceneToolHandles } from "@/lib/ai/scene-tools"
import { guardLoops } from "@/lib/ai/wgsl-guard"
import { EFFECTS_GUIDE, GRAPHS_GUIDE } from "@/lib/ai/authoring-guides"

/** A character and one of her groups from the agent's words. */
function groupOf(h: SceneToolHandles, character: unknown, group: unknown) {
  const c = h.cast.find((m) => m.id === character || m.name.toLowerCase() === String(character ?? "").toLowerCase()) ?? h.cast[0]
  if (!c) return { error: "no character" } as const
  const g = String(group ?? "").toLowerCase()
  const found = (h.groups[c.id] ?? []).find((x) => x.id.toLowerCase() === g || (x.label ?? "").toLowerCase() === g)
  if (!found) return { error: `no group "${group}" on ${c.name} — groups are ${(h.groups[c.id] ?? []).map((x) => x.id).join(", ")}` } as const
  return { id: c.id, name: c.name, group: found }
}

/** A graph from the model, checked for the shape before the compiler sees it. */
function graphIn(raw: unknown, name: string): ShaderGraph | string {
  const g = (typeof raw === "string" ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw) as Partial<ShaderGraph> | null
  if (!g || typeof g !== "object") return "graph must be a ShaderGraph object: { nodes, links, output }"
  if (!Array.isArray(g.nodes) || !Array.isArray(g.links) || !g.output) return "graph needs nodes (array), links (array) and output ({ node, socket })"
  return { ...g, version: 1, name } as ShaderGraph
}

/** Lines read_effect_source gives at once: most effects whole, the longest in two reads. */
const SOURCE_LINES = 400

export const AUTHOR_TOOLS: SceneTool[] = [
  {
    name: "read_authoring_guide",
    description:
      "How to write a new WGSL effect (`effects`) or a material shader graph (`graphs`): the user manual's own reference — mounts, directives, the field contract, every rz* helper and the rules (effects); the graph document, the compiler's rules and the full node reference with socket names (graphs). Read it before your first write_effect / write_shader in a conversation.",
    parameters: { type: "object", properties: { topic: { type: "string", enum: ["effects", "graphs"] } }, required: ["topic"] },
    run: async (args) => ({ data: { guide: args.topic === "graphs" ? GRAPHS_GUIDE : EFFECTS_GUIDE } }),
  },
  {
    name: "read_effect_source",
    description:
      "The WGSL of an effect — one in the scene (by id or name) or in the library (by name). The built-ins are commented with the mistake each avoids: start a new effect from the nearest one rather than from nothing. Gives the first 400 lines and the total; `from`/`to` (1-based line numbers) read any other stretch.",
    parameters: {
      type: "object",
      properties: {
        effect: { type: "string" },
        from: { type: "number", description: "First line, 1-based." },
        to: { type: "number", description: "Last line, inclusive." },
      },
      required: ["effect"],
    },
    run: async (args, h) => {
      const want = String(args.effect ?? "")
      const key = want.toLowerCase()
      const hit = h.effects.find((e) => e.uid === want || e.name.toLowerCase() === key) ?? h.effectLibrary.find((e) => e.name.toLowerCase() === key)
      if (!hit) return { data: { error: `no effect "${want}" — list_effects names the library` } }
      const all = hit.wgsl.split("\n")
      const from = Math.max(1, Math.floor(Number(args.from) || 1))
      const to = Math.min(all.length, Math.floor(Number(args.to) || from + SOURCE_LINES - 1))
      const rest = to < all.length ? { note: `lines ${from}–${to} of ${all.length}; read on with from: ${to + 1}` } : {}
      return { data: { name: hit.name, lines: all.length, wgsl: all.slice(from - 1, to).join("\n"), ...rest } }
    },
  },
  {
    name: "write_effect",
    description:
      "Write a new WGSL effect, or rewrite one in the scene (`replace`: its id or name — it keeps that effect's timing and cast). It is compiled against the whole scene; if it fails, nothing changes and you get the compiler's line:col errors to fix and try again. If it compiles, it is saved to the user's drafts and added to the scene. Loops must have a fixed bound (a literal up to 256, an rz…Count(), arrayLength, or a #param) — `while` and `loop` are refused. Capture or filmstrip afterwards to see it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short descriptive name, e.g. Petal Drift." },
        wgsl: { type: "string", description: "The whole effect: directives, then the mounts." },
        replace: { type: "string", description: "An effect in the scene to rewrite, by id or name." },
      },
      required: ["name", "wgsl"],
    },
    run: async (args, h) => {
      const name = String(args.name ?? "").trim() || "AI Effect"
      const wgsl = String(args.wgsl ?? "")
      if (!wgsl.trim()) return { data: { error: "wgsl is empty" } }
      const guard = guardLoops(wgsl)
      if (guard.length) return { data: { error: "refused before compiling", problems: guard } }
      const { errors } = parseDirectives(wgsl)
      if (errors.length) return { data: { error: "directive errors", problems: errors } }
      const r = await h.authorEffect(name, wgsl, typeof args.replace === "string" ? args.replace : undefined)
      if (!r.ok) return { data: { error: "did not compile — fix and write again", diagnostics: r.diagnostics.slice(0, 12) } }
      return {
        data: {
          saved: r.name,
          id: r.uid,
          dials: r.params,
          ...(r.duration ? { seconds: r.duration } : {}),
          ...(r.diagnostics.length ? { warnings: r.diagnostics.slice(0, 6) } : {}),
        },
      }
    },
  },
  {
    name: "read_shader_graph",
    description:
      "The whole graph (nodes, links, output) of a library shader by name, or of the shader on one character's group. Read the one closest to what you want before write_shader, and change it rather than starting from nothing.",
    parameters: {
      type: "object",
      properties: {
        shader: { type: "string", description: "A library shader's name, e.g. AG Face." },
        character: { type: "string" },
        group: { type: "string", description: "Read the graph this group wears instead." },
      },
    },
    run: async (args, h) => {
      if (typeof args.shader === "string" && args.shader) {
        const g = h.graphSource(args.shader)
        return { data: g ? { graph: g } : { error: `no shader named "${args.shader}" — see list_shaders` } }
      }
      const found = groupOf(h, args.character, args.group)
      if ("error" in found) return { data: found }
      return { data: { character: found.name, group: found.group.id, graph: found.group.graph } }
    },
  },
  {
    name: "write_shader",
    description:
      "Write a material shader graph and put it on one character's group. The graph is { nodes: [{ id, type, inputs? }], links: [{ from: { node, socket }, to: { node, socket } }], output: { node, socket }, params? } with node types and sockets exactly as the graphs guide lists them. It is validated and compiled first; if it fails nothing changes and you get the compiler's messages. If it compiles it is saved to the user's drafts and the group wears it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "A short descriptive name, e.g. Ink Wash Skin." },
        graph: { type: "object", description: "The ShaderGraph." },
        character: { type: "string" },
        group: { type: "string", description: "The material group to put it on, as get_scene lists them." },
      },
      required: ["name", "graph", "group"],
    },
    run: async (args, h) => {
      const found = groupOf(h, args.character, args.group)
      if ("error" in found) return { data: found }
      const name = String(args.name ?? "").trim() || "AI Shader"
      const graph = graphIn(args.graph, name)
      if (typeof graph === "string") return { data: { error: graph } }
      const compiled = compileGraph(graph)
      const errors = compiled.diagnostics.filter((d) => d.severity === "error")
      if (!compiled.ok || errors.length) {
        return { data: { error: "did not compile — fix and write again", diagnostics: errors.slice(0, 12).map((d) => (d.nodeId ? `${d.nodeId}: ${d.message}` : d.message)) } }
      }
      const saved = h.saveGraphDraft(name, graph)
      const applied = await h.setGroupGraph(found.id, found.group.id, { ...graph, name: saved })
      if (applied) return { data: { error: `saved as ${saved}, but the group could not take it: ${applied}` } }
      const warnings = compiled.diagnostics.filter((d) => d.severity !== "error").map((d) => d.message)
      return { data: { saved, character: found.name, group: found.group.id, ...(warnings.length ? { warnings: warnings.slice(0, 6) } : {}) } }
    },
  },
]
