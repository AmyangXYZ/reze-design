// Curated "Add node" palette over the engine's NODE_REGISTRY. The registry carries no display

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

// Category accent color — shared by the node-card header and the graph minimap so both speak
export const CATEGORY_COLORS: Record<string, string> = {
  Input: "#2dd4bf", // teal
  Color: "#fbbf24", // amber (matches the color socket)
  Texture: "#f472b6", // pink
  Vector: "#818cf8", // indigo (matches the vector socket)
  Math: "#94a3b8", // slate (converters, à la Blender)
  Mix: "#a78bfa", // violet
  Shader: "#4ade80", // green
}
const TYPE_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  NODE_CATALOG.flatMap((g) => g.items.map((i) => [i.type, g.category])),
)
export const categoryOf = (type: string): string | undefined => TYPE_TO_CATEGORY[type]
/** Accent hex for a node type via its category (neutral gray if uncatalogued). */
export const nodeColor = (type: string): string => CATEGORY_COLORS[categoryOf(type) ?? ""] ?? "#a1a1aa"

/** Unique node id from a type: slugify (`math/power` → `math_power`), then suffix on collision. */
export function uniqueNodeId(type: string, existing: Set<string>): string {
  const base = type.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "node"
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

/** Build a fresh GraphNode with the registry's default literals seeded (so the card shows */
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
if (process.env.NODE_ENV !== "production") {
  const listed = new Set(NODE_CATALOG.flatMap((g) => g.items.map((i) => i.type)))
  const registered = new Set(Object.keys(NODE_REGISTRY))
  const missing = [...registered].filter((t) => !listed.has(t))
  const extra = [...listed].filter((t) => !registered.has(t))
  if (missing.length || extra.length)
    console.warn("[node-catalog] out of sync with NODE_REGISTRY —", { missing, extra })
}
