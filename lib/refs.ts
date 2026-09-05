// Recognising published content by its VALUE.
//
// A scene pins `{ id }` when what it applies is exactly some published item, and
// inlines the value when it isn't. Deciding that by comparison rather
// than by bookkeeping means an edited graph automatically stops matching — it
// genuinely is no longer that item, so it must travel by value. No provenance
// state to keep in sync, and no way for a stale tag to mispin someone else's work.

import { DEFAULT_GRAPH, type ShaderGraph } from "reze-engine"
import { EFFECTS } from "@/lib/effects"
import { GRADE_PRESETS, type GradeSpec } from "@/lib/grade"
import { GRAPH_LIBRARY, sameGraphLook } from "@/lib/materials"
import { communityItems } from "@/hooks/use-community"
import type { EffectItem, GradeItem, GraphItem, LibraryKind } from "@/lib/library"
import type { ItemRef } from "@/lib/scene"

/** Built-ins first: they ship in the bundle, so a pin to one resolves offline. */
function candidates<T>(kind: LibraryKind, builtins: T[]): T[] {
  return [...builtins, ...(communityItems(kind) as T[])]
}

const pin = (item: { id: string } | undefined): ItemRef | undefined => (item ? { id: item.id } : undefined)

// Compared by LOOK, not bytes. Opening the editor on a group round-trips its
// graph through ReactFlow, which stamps node layout onto it — so a byte compare
// stops recognising a built-in nobody edited, and the scene inlines a copy of a
// preset it should simply have pinned.
function graphMatch(graph: ShaderGraph): GraphItem | undefined {
  return candidates<GraphItem>("graph", GRAPH_LIBRARY).find((i) => sameGraphLook(i.payload.graph, graph))
}

export function graphRef(graph: ShaderGraph): ItemRef | undefined {
  return pin(graphMatch(graph))
}

/** What the library calls this look, when the look IS some published or built-in
 *  graph. The name a group must wear to be findable in the library it came from. */
export function graphLibraryName(graph: ShaderGraph): string | undefined {
  return graphMatch(graph)?.name
}

function effectMatch(wgsl: string): EffectItem | undefined {
  return candidates<EffectItem>("effect", EFFECTS).find((i) => i.payload.wgsl === wgsl)
}

export function effectRef(wgsl: string): ItemRef | undefined {
  return pin(effectMatch(wgsl))
}

function gradeMatch(spec: GradeSpec): GradeItem | undefined {
  const json = JSON.stringify(spec)
  return candidates<GradeItem>("grade", GRADE_PRESETS).find((i) => JSON.stringify(i.payload.spec) === json)
}

export function gradeRef(spec: GradeSpec): ItemRef | undefined {
  return pin(gradeMatch(spec))
}

/** What a scene uses that the people who can open it would not be able to
 *  resolve. `missing` is in no library at all; `private` IS published, just not
 *  where a public scene's audience can reach it. */
export type UnpublishedUse = { kind: LibraryKind; name: string; reason: "missing" | "private" }

/**
 * Could everyone who can open this scene resolve this pin?
 *
 * A private item is served to its owner and to nobody else, so a PUBLIC scene
 * pinning one renders complete for its author and quietly short for everyone
 * else — the resolve route omits the key, and an unresolvable pin drops the
 * effect rather than substituting a wrong one. That is the failure this
 * prevents: silent, invisible to the person who caused it, and visible only to
 * people who cannot report it.
 *
 * A PRIVATE scene has one reader, its owner, who owns every private item it
 * could pin. Public items are reachable by definition, and built-ins carry no
 * visibility because they ship in the bundle.
 */
const reachable = (item: { visibility?: "public" | "private" }, scene: "public" | "private"): boolean =>
  scene === "private" || item.visibility !== "private"

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
export function unpublishedUses(
  scene: {
    gradeSpec: GradeSpec
    gradeName: string
    /** EVERY applied effect. A scene layers several, and checking only the first
     *  would let the other three publish as pins to drafts that exist on one
     *  device. */
    effects: { name: string; wgsl: string }[]
    groups: Record<string, { graph?: ShaderGraph }[]>
  },
  /** What this scene is about to be published AS. A public scene has a stricter
   *  bar than a private one, so this cannot be computed once and reused across
   *  a change of the picker. */
  visibility: "public" | "private",
): UnpublishedUse[] {
  const out: UnpublishedUse[] = []
  const grade = gradeMatch(scene.gradeSpec)
  if (!grade) out.push({ kind: "grade", name: scene.gradeName, reason: "missing" })
  else if (!reachable(grade, visibility)) out.push({ kind: "grade", name: scene.gradeName, reason: "private" })
  for (const e of scene.effects) {
    const hit = effectMatch(e.wgsl)
    if (!hit) out.push({ kind: "effect", name: e.name, reason: "missing" })
    else if (!reachable(hit, visibility)) out.push({ kind: "effect", name: e.name, reason: "private" })
  }
  const seen = new Set<string>()
  for (const list of Object.values(scene.groups)) {
    for (const g of list) {
      if (!g.graph) continue
      const hit = graphMatch(g.graph)
      if (hit && reachable(hit, visibility)) continue
      // The engine's neutral base is not a draft. It is what every new group
      // starts on and what an ungrouped material already renders, so it travels
      // by value and reproduces anywhere — it is simply not IN the library, and
      // blocking a publish over it would name a built-in as someone's unshared
      // work.
      if (sameGraphLook(g.graph, DEFAULT_GRAPH)) continue
      // One entry per look, however many groups wear it.
      if (seen.has(g.graph.name)) continue
      seen.add(g.graph.name)
      out.push({ kind: "graph", name: g.graph.name, reason: hit ? "private" : "missing" })
    }
  }
  return out
}
