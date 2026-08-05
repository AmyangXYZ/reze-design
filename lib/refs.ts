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
import { GRAPH_LIBRARY, sameGraphLook } from "@/lib/materials"
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
  // Compared by LOOK, not bytes. Opening the editor on a group round-trips its
  // graph through ReactFlow, which stamps node layout onto it — so a byte
  // compare stops recognising a built-in nobody edited, and the scene inlines a
  // copy of a preset it should simply have pinned.
  return pin(candidates<GraphItem>("graph", GRAPH_LIBRARY).find((i) => sameGraphLook(i.payload.graph, graph)))
}

export function effectRef(wgsl: string): ItemRef | undefined {
  return pin(candidates<EffectItem>("effect", BACKGROUND_EFFECTS).find((i) => i.payload.wgsl === wgsl))
}

export function gradeRef(spec: GradeSpec): ItemRef | undefined {
  const json = JSON.stringify(spec)
  return pin(candidates<GradeItem>("grade", GRADE_PRESETS).find((i) => JSON.stringify(i.payload.spec) === json))
}

/** What a scene uses that exists in no library — built-in or published. */
export type UnpublishedUse = { kind: LibraryKind; name: string }

/**
 * Everything in a scene that would have to travel by value because it matches
 * nothing published.
 *
 * Publishing is blocked on this being empty. A scene renders fine either way —
 * inlined values are exactly what makes a published scene reproduce on someone
 * else's machine — but a look that reaches the world only inside a scene is a
 * look nobody can find, credit, or reuse. Requiring it to be published first is
 * what keeps the library a complete account of what people are actually using.
 */
export function unpublishedUses(scene: {
  gradeSpec: GradeSpec
  gradeName: string
  effect: { name: string; wgsl: string } | null
  groups: Record<string, { graph?: ShaderGraph }[]>
}): UnpublishedUse[] {
  const out: UnpublishedUse[] = []
  if (!gradeRef(scene.gradeSpec)) out.push({ kind: "grade", name: scene.gradeName })
  if (scene.effect && !effectRef(scene.effect.wgsl)) out.push({ kind: "effect", name: scene.effect.name })
  const seen = new Set<string>()
  for (const list of Object.values(scene.groups)) {
    for (const g of list) {
      if (!g.graph || graphRef(g.graph)) continue
      // One entry per look, however many groups wear it.
      if (seen.has(g.graph.name)) continue
      seen.add(g.graph.name)
      out.push({ kind: "graph", name: g.graph.name })
    }
  }
  return out
}
