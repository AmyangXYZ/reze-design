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
      { type: "sphere_map", label: "Sphere Map" },
      { type: "light", label: "Light" },
      { type: "head_basis", label: "Head Basis" },
      { type: "uv_map", label: "UV Map" },
      { type: "attribute", label: "Attribute" },
      { type: "object_info", label: "Object Info" },
      { type: "light_path", label: "Light Path" },
      { type: "value", label: "Value" },
      { type: "rgb", label: "RGB" },
      { type: "tex_image/0", label: "Group Image 0" },
      { type: "tex_image/1", label: "Group Image 1" },
      { type: "tex_image/2", label: "Group Image 2" },
      { type: "tex_image/3", label: "Group Image 3" },
    ],
  },
  {
    category: "Color",
    items: [
      { type: "hue_sat", label: "Hue / Saturation" },
      { type: "bright_contrast", label: "Bright / Contrast" },
      { type: "invert", label: "Invert" },
      { type: "gamma", label: "Gamma" },
      { type: "rgb_curve", label: "RGB Curves" },
      { type: "separate_color", label: "Separate Color · RGB" },
      { type: "separate_color/hsv", label: "Separate Color · HSV" },
      { type: "separate_color/hsl", label: "Separate Color · HSL" },
      { type: "combine_color", label: "Combine Color · RGB" },
      { type: "combine_color/hsv", label: "Combine Color · HSV" },
      { type: "combine_color/hsl", label: "Combine Color · HSL" },
      { type: "ramp_linear", label: "Color Ramp · Linear" },
      { type: "ramp_linear_3", label: "Color Ramp · Linear, 3 stops" },
      { type: "ramp_constant", label: "Color Ramp · Constant" },
      { type: "ramp_constant_aa", label: "Color Ramp · Constant AA" },
      { type: "ramp_cardinal", label: "Color Ramp · Cardinal" },
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
      { type: "normal_map", label: "Normal Map" },
      { type: "separate_xyz", label: "Separate XYZ" },
      { type: "combine_xyz", label: "Combine XYZ" },
      { type: "vect_cross", label: "Cross Product" },
      { type: "vector_rotate/axis_angle", label: "Vector Rotate · Axis Angle" },
      { type: "vector_rotate/euler_xyz", label: "Vector Rotate · Euler XYZ" },
      { type: "vector_transform/world_to_camera", label: "Vector Transform · World → Camera" },
      { type: "vector_transform/camera_to_world", label: "Vector Transform · Camera → World" },
      { type: "vector_transform/point_world_to_camera", label: "Vector Transform · Point, World → Camera" },
      { type: "vector_math/add", label: "Vector Add" },
      { type: "vector_math/subtract", label: "Vector Subtract" },
      { type: "vector_math/multiply", label: "Vector Multiply" },
      { type: "vector_math/divide", label: "Vector Divide" },
      { type: "vector_math/multiply_add", label: "Vector Multiply Add" },
      { type: "vector_math/cross", label: "Vector Cross Product" },
      { type: "vector_math/project", label: "Vector Project" },
      { type: "vector_math/reflect", label: "Vector Reflect" },
      { type: "vector_math/refract", label: "Vector Refract" },
      { type: "vector_math/dot", label: "Vector Dot Product" },
      { type: "vector_math/distance", label: "Vector Distance" },
      { type: "vector_math/length", label: "Vector Length" },
      { type: "vector_math/scale", label: "Vector Scale" },
      { type: "vector_math/normalize", label: "Vector Normalize" },
      { type: "vector_math/absolute", label: "Vector Absolute" },
      { type: "vector_math/minimum", label: "Vector Minimum" },
      { type: "vector_math/maximum", label: "Vector Maximum" },
      { type: "vector_math/floor", label: "Vector Floor" },
      { type: "vector_math/ceil", label: "Vector Ceil" },
      { type: "vector_math/fraction", label: "Vector Fraction" },
      { type: "vector_math/modulo", label: "Vector Modulo" },
      { type: "vector_math/wrap", label: "Vector Wrap" },
      { type: "vector_math/snap", label: "Vector Snap" },
      { type: "vector_math/faceforward", label: "Vector Faceforward" },
    ],
  },
  {
    category: "Math",
    items: [
      { type: "math/add", label: "Add" },
      { type: "math/subtract", label: "Subtract" },
      { type: "math/multiply", label: "Multiply" },
      { type: "math/divide", label: "Divide" },
      { type: "math/multiply_add", label: "Multiply Add" },
      { type: "math/power", label: "Power" },
      { type: "math/logarithm", label: "Logarithm" },
      { type: "math/sqrt", label: "Square Root" },
      { type: "math/inversesqrt", label: "Inverse Square Root" },
      { type: "math/absolute", label: "Absolute" },
      { type: "math/exponent", label: "Exponent" },
      { type: "math/minimum", label: "Minimum" },
      { type: "math/maximum", label: "Maximum" },
      { type: "math/less_than", label: "Less Than" },
      { type: "math/greater_than", label: "Greater Than" },
      { type: "math/sign", label: "Sign" },
      { type: "math/compare", label: "Compare" },
      { type: "math/smooth_min", label: "Smooth Minimum" },
      { type: "math/smooth_max", label: "Smooth Maximum" },
      { type: "math/round", label: "Round" },
      { type: "math/floor", label: "Floor" },
      { type: "math/ceil", label: "Ceil" },
      { type: "math/truncate", label: "Truncate" },
      { type: "math/fraction", label: "Fraction" },
      { type: "math/modulo", label: "Modulo" },
      { type: "math/floored_modulo", label: "Floored Modulo" },
      { type: "math/wrap", label: "Wrap" },
      { type: "math/snap", label: "Snap" },
      { type: "math/pingpong", label: "Ping-Pong" },
      { type: "math/sine", label: "Sine" },
      { type: "math/cosine", label: "Cosine" },
      { type: "math/tangent", label: "Tangent" },
      { type: "math/arcsine", label: "Arcsine" },
      { type: "math/arccosine", label: "Arccosine" },
      { type: "math/arctangent", label: "Arctangent" },
      { type: "math/arctan2", label: "Arctan2" },
      { type: "math/radians", label: "To Radians" },
      { type: "math/degrees", label: "To Degrees" },
      { type: "math/clamp01", label: "Clamp 0–1" },
      { type: "map_range", label: "Map Range · Clamped" },
      { type: "map_range/linear", label: "Map Range · Linear" },
      { type: "map_range/smoothstep", label: "Map Range · Smoothstep" },
    ],
  },
  {
    category: "Mix",
    items: [
      { type: "mix/blend", label: "Mix" },
      { type: "mix/add", label: "Add" },
      { type: "mix/subtract", label: "Subtract" },
      { type: "mix/multiply", label: "Multiply" },
      { type: "mix/divide", label: "Divide" },
      { type: "mix/screen", label: "Screen" },
      { type: "mix/overlay", label: "Overlay" },
      { type: "mix/soft_light", label: "Soft Light" },
      { type: "mix/dodge", label: "Dodge" },
      { type: "mix/burn", label: "Burn" },
      { type: "mix/darken", label: "Darken" },
      { type: "mix/lighten", label: "Lighten" },
      { type: "mix/difference", label: "Difference" },
      { type: "mix/exclusion", label: "Exclusion" },
      { type: "mix/linear_light", label: "Linear Light" },
      { type: "mix/hue", label: "Hue" },
      { type: "mix/saturation", label: "Saturation" },
      { type: "mix/color", label: "Color" },
      { type: "mix/value", label: "Value" },
      { type: "mix/add_emit", label: "Add (Emission)" },
    ],
  },
  {
    category: "Shader",
    items: [
      { type: "principled", label: "Principled BSDF" },
      { type: "bsdf_diffuse", label: "Diffuse BSDF" },
      { type: "bsdf_transparent", label: "Transparent BSDF" },
      { type: "emission", label: "Emission" },
      { type: "add_shader", label: "Add Shader" },
      { type: "mix_shader", label: "Mix Shader" },
      { type: "shader_to_rgb", label: "Shader to RGB" },
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

// Dev-time drift guard. This THROWS rather than warns, the way asBuiltins does
// for a duplicate id: it warned for an entire release while the editor offered 40
// of the registry's 145 nodes, which is exactly the failure a warning is bad at —
// nothing looks broken, there is simply no way to reach two thirds of the
// vocabulary. A node added to the engine is not usable until it is named here.
if (process.env.NODE_ENV !== "production") {
  const listed = new Set(NODE_CATALOG.flatMap((g) => g.items.map((i) => i.type)))
  const registered = new Set(Object.keys(NODE_REGISTRY))
  const missing = [...registered].filter((t) => !listed.has(t))
  const extra = [...listed].filter((t) => !registered.has(t))
  if (missing.length || extra.length)
    throw new Error(`node-catalog out of sync with NODE_REGISTRY — missing: [${missing.join(", ")}] extra: [${extra.join(", ")}]`)
}
