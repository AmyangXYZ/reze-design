// Curated "Add node" palette over the engine's NODE_REGISTRY. The registry carries
// no display metadata (labels, grouping) — that's an editor concern — so the human
// labels and category order live here. Every registry type appears exactly once
// (see the dev-only completeness check at the bottom). Categories mirror the section
// comments in the engine's registry (Input · Color · Texture · Vector · Math · Mix ·
// Shader), the order a Blender user expects in an Add-node search.

import { NODE_REGISTRY, type GraphNode, type SocketValue } from "reze-engine"

export type CatalogItem = { type: string; label: string }
export type CatalogGroup = { category: string; items: CatalogItem[] }

export const NODE_CATALOG: CatalogGroup[] = [
  {
    category: "Input",
    items: [
      { type: "texture", label: "Image Texture" },
      { type: "geometry", label: "Geometry" },
      { type: "material_diffuse", label: "Material Diffuse" },
      { type: "value", label: "Value" },
      { type: "rgb", label: "RGB" },
    ],
  },
  {
    category: "Color",
    items: [
      { type: "hue_sat", label: "Hue / Saturation" },
      { type: "bright_contrast", label: "Bright / Contrast" },
      { type: "invert", label: "Invert" },
      { type: "ramp_linear", label: "Color Ramp · Linear" },
      { type: "ramp_constant", label: "Color Ramp · Constant" },
      { type: "ramp_cardinal", label: "Color Ramp · Cardinal" },
      { type: "ramp_constant_aa", label: "Color Ramp · Constant AA" },
      { type: "ramp_tri", label: "Color Ramp · Triangle" },
    ],
  },
  {
    category: "Texture",
    items: [
      { type: "tex_noise", label: "Noise Texture" },
      { type: "tex_gradient", label: "Gradient Texture" },
      { type: "tex_voronoi/f1", label: "Voronoi · F1" },
      { type: "tex_voronoi/color", label: "Voronoi · Color" },
    ],
  },
  {
    category: "Vector",
    items: [
      { type: "mapping", label: "Mapping" },
      { type: "bump", label: "Bump" },
      { type: "separate_xyz", label: "Separate XYZ" },
      { type: "vect_cross", label: "Vector Cross" },
    ],
  },
  {
    category: "Math",
    items: [
      { type: "math/add", label: "Add" },
      { type: "math/multiply", label: "Multiply" },
      { type: "math/power", label: "Power" },
      { type: "math/greater_than", label: "Greater Than" },
      { type: "math/clamp01", label: "Clamp 0–1" },
    ],
  },
  {
    category: "Mix",
    items: [
      { type: "mix/blend", label: "Mix Color" },
      { type: "mix/multiply", label: "Multiply" },
      { type: "mix/overlay", label: "Overlay" },
      { type: "mix/lighten", label: "Lighten" },
      { type: "mix/linear_light", label: "Linear Light" },
      { type: "mix/add_emit", label: "Add Emission" },
    ],
  },
  {
    category: "Shader",
    items: [
      { type: "principled", label: "Principled BSDF" },
      { type: "emission", label: "Emission" },
      { type: "add_shader", label: "Add Shader" },
      { type: "mix_shader", label: "Mix Shader" },
      { type: "shader_to_rgb_diffuse", label: "Shader to RGB · Diffuse" },
      { type: "fresnel", label: "Fresnel" },
      { type: "layer_weight/fresnel", label: "Layer Weight · Fresnel" },
      { type: "layer_weight/facing", label: "Layer Weight · Facing" },
    ],
  },
]

/** Human label for a node type (falls back to the raw registry key). */
export const nodeLabel = (type: string): string =>
  NODE_CATALOG.flatMap((g) => g.items).find((i) => i.type === type)?.label ?? type

/** Unique node id from a type: slugify (`math/power` → `math_power`), then suffix on
 *  collision. Result matches the engine's id rule `/^[a-z0-9_]+$/`. */
export function uniqueNodeId(type: string, existing: Set<string>): string {
  const base = type.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "node"
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

/** Build a fresh GraphNode with the registry's default literals seeded (so the card
 *  shows editable values immediately) at a ui position. Context/link-only sockets
 *  (no `default`) are left for the compiler to resolve. Arrays are cloned so nodes
 *  never share a literal with the registry. */
export function makeGraphNode(type: string, id: string, position: { x: number; y: number }): GraphNode {
  const spec = NODE_REGISTRY[type]
  const inputs: Record<string, SocketValue> = {}
  if (spec) {
    for (const [socket, input] of Object.entries(spec.inputs)) {
      const d = input.default
      if (d === undefined) continue
      inputs[socket] = structuredClone(d)
    }
  }
  return { id, type, inputs, ui: { position: { x: Math.round(position.x), y: Math.round(position.y) } } }
}

// Dev-only drift guard: fail loudly in the console if the registry gains/loses a type
// the catalog doesn't mirror. Cheap, runs once at module load.
if (process.env.NODE_ENV !== "production") {
  const listed = new Set(NODE_CATALOG.flatMap((g) => g.items.map((i) => i.type)))
  const registered = new Set(Object.keys(NODE_REGISTRY))
  const missing = [...registered].filter((t) => !listed.has(t))
  const extra = [...listed].filter((t) => !registered.has(t))
  if (missing.length || extra.length)
    console.warn("[node-catalog] out of sync with NODE_REGISTRY —", { missing, extra })
}
