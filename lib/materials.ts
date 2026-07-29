import type { MaterialPreset, ShaderGraph } from "reze-engine"
import graphs from "@/content/graphs.json"

// Pinned SNAPSHOTS of the engine's presets rather than live imports. The library
// presents these with authors and dates, so retuning a preset upstream shouldn't
// silently rewrite what a user sees — and once graphs are server-backed, builtin
// and contributed entries need to live in the same shape.
export const SLOT_GRAPHS = graphs as unknown as Partial<Record<MaterialPreset, ShaderGraph>>


export const SLOT_ORDER: MaterialPreset[] = [
  "hair",
  "body",
  "face",
  "eye",
  "cloth_smooth",
  "cloth_rough",
  "stockings",
  "metal",
  "default",
]

export const SLOT_LABELS: Record<MaterialPreset, string> = {
  hair: "Hair",
  body: "Skin",
  face: "Face",
  eye: "Eyes",
  cloth_smooth: "Smooth Cloth",
  cloth_rough: "Rough Cloth",
  stockings: "Stockings",
  metal: "Metal",
  default: "Default",
}
