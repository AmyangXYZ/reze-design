// Recognising published content by its VALUE.
//
// A scene pins `{ id, version }` when what it applies is exactly some published
// item, and inlines the value when it isn't. Deciding that by comparison rather
// than by bookkeeping means an edited graph automatically stops matching — it
// genuinely is no longer that item, so it must travel by value. No provenance
// state to keep in sync, and no way for a stale tag to mispin someone else's work.

import type { ShaderGraph } from "reze-engine"
import { BACKGROUND_EFFECTS } from "@/lib/background-effects"
import { GRADE_PRESETS, type GradeSpec } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { communityItems } from "@/hooks/use-community"
import type { EffectItem, GradeItem, GraphItem, LibraryKind } from "@/lib/library"
import type { ItemRef } from "@/lib/scene"

/** Built-ins first: they ship in the bundle, so a pin to one resolves offline. */
function candidates<T>(kind: LibraryKind, builtins: T[]): T[] {
  return [...builtins, ...(communityItems(kind) as T[])]
}

const pin = (item: { id: string; version: number } | undefined): ItemRef | undefined =>
  item ? { id: item.id, version: item.version } : undefined

export function graphRef(graph: ShaderGraph): ItemRef | undefined {
  const json = JSON.stringify(graph)
  return pin(candidates<GraphItem>("graph", GRAPH_LIBRARY).find((i) => JSON.stringify(i.payload.graph) === json))
}

export function effectRef(wgsl: string): ItemRef | undefined {
  return pin(candidates<EffectItem>("effect", BACKGROUND_EFFECTS).find((i) => i.payload.wgsl === wgsl))
}

export function gradeRef(spec: GradeSpec): ItemRef | undefined {
  const json = JSON.stringify(spec)
  return pin(candidates<GradeItem>("grade", GRADE_PRESETS).find((i) => JSON.stringify(i.payload.spec) === json))
}
