// The style-slot tables: which shader graph, label, and ordering each material category gets.

import {
  BODY_GRAPH,
  CLOTH_ROUGH_GRAPH,
  CLOTH_SMOOTH_GRAPH,
  DEFAULT_GRAPH,
  EYE_GRAPH,
  FACE_GRAPH,
  HAIR_GRAPH,
  METAL_GRAPH,
  STOCKINGS_GRAPH,
  type MaterialPreset,
  type ShaderGraph,
} from "reze-engine"

/** Every slot ships an editable graph preset (engine 0.18.1 added face + eye). */
export const SLOT_GRAPHS: Partial<Record<MaterialPreset, ShaderGraph>> = {
  hair: HAIR_GRAPH,
  body: BODY_GRAPH,
  face: FACE_GRAPH,
  eye: EYE_GRAPH,
  cloth_smooth: CLOTH_SMOOTH_GRAPH,
  cloth_rough: CLOTH_ROUGH_GRAPH,
  stockings: STOCKINGS_GRAPH,
  metal: METAL_GRAPH,
  default: DEFAULT_GRAPH,
}

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
