import type { MaterialPreset } from "reze-engine"
import graphs from "@/content/graphs.json"
import { asBuiltins, type GraphItem } from "@/lib/library"

// Pinned SNAPSHOTS of the engine's presets rather than live imports. The library
// presents these with authors and dates, so retuning a preset upstream shouldn't
// silently rewrite what a user sees.
export const GRAPH_LIBRARY = asBuiltins<GraphItem>(graphs as unknown as Omit<GraphItem, "owner">[])

/** Role → graph, for the slots that ship with a default look. */
export const SLOT_GRAPHS = Object.fromEntries(
  GRAPH_LIBRARY.filter((g) => g.payload.role).map((g) => [g.payload.role, g.payload.graph]),
) as Partial<Record<MaterialPreset, GraphItem["payload"]["graph"]>>

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
