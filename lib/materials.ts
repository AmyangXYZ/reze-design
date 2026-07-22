// Material → slot resolution for the demo model. The engine resolves presets
// internally from the same map (setMaterialPresets) but exposes no per-material
// getter, so the UI owns this mapping and derives the sidebar grouping from it.
// Materials not listed here fall back to the engine's mmd_classic shader and
// have no editable style graph.

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
  type MaterialPresetMap,
  type StyleGraph,
} from "reze-engine"

export const MODEL_ID = "serqet"
export const MODEL_PATH = "/models/塞尔凯特/塞尔凯特.pmx"

export const MODEL_PRESETS: MaterialPresetMap = {
  eye: ["眼睛", "眼白", "目白", "右瞳", "左瞳", "眉毛"],
  face: ["脸", "face01"],
  body: ["皮肤", "skin"],
  hair: ["头发", "hair_f"],
  cloth_smooth: [
    "衣服", "裙子", "裙带", "裙布", "外套", "外套饰", "裤子", "裤子0", "腿环", "发饰",
    "鞋子", "鞋子饰", "shirt", "shoes", "shorts", "trigger", "dress", "hair_accessory", "cloth01_shoes",
  ],
  stockings: ["袜子", "stockings"],
  metal: ["metal01", "earring"],
}

/** Every slot ships an editable graph preset (engine 0.18.1 added face + eye). */
export const SLOT_GRAPHS: Partial<Record<MaterialPreset, StyleGraph>> = {
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
  "hair", "body", "face", "eye", "cloth_smooth", "cloth_rough", "stockings", "metal", "default",
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

export function slotOfMaterial(name: string): MaterialPreset | null {
  for (const [slot, names] of Object.entries(MODEL_PRESETS)) {
    if (names?.includes(name)) return slot as MaterialPreset
  }
  return null
}
