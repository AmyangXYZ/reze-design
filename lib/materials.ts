import type { MaterialPreset, ShaderGraph } from "reze-engine"
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

/** A scene's `graph: "<name>"` → the graph itself. Drafts aren't here by design:
 *  they're unpublished, so a scene that uses one inlines it instead. */
export function libraryGraph(name: string): GraphItem["payload"]["graph"] | undefined {
  return GRAPH_LIBRARY.find((g) => g.name === name)?.payload.graph
}

/**
 * Role → display name, DERIVED from the graph that fills that role.
 *
 * Hand-written it drifted: the engine labels an auto group `graph.name`, so a
 * second list of names could disagree with the library about the same thing
 * ("Skin" in one place, "Body" in the other). Deriving leaves one name per role.
 */
export const SLOT_LABELS = Object.fromEntries(
  GRAPH_LIBRARY.filter((g) => g.payload.role).map((g) => [g.payload.role, g.name]),
) as Record<MaterialPreset, string>

/**
 * What to call a style group.
 *
 * Auto-derived groups arrive keyed by role, so an unlabelled one would show the
 * raw key ("body") while its graph showed the friendly name. Hand-made groups
 * carry their own label and pass straight through.
 */
export function groupLabel(group: { id: string; label?: string }): string {
  return group.label ?? SLOT_LABELS[group.id as MaterialPreset] ?? group.id
}

/**
 * Do two shader graphs describe the same LOOK?
 *
 * Not a deep equality: `name` is rewritten to the group's label on apply, and
 * opening the editor round-trips the graph through ReactFlow, which stamps
 * layout positions onto every node. Neither changes how anything renders, so
 * comparing raw would report "edited" for a graph nobody touched — and prompt to
 * save it on close.
 */
export function sameGraphLook(a: ShaderGraph | undefined, b: ShaderGraph | undefined): boolean {
  const bare = (g: ShaderGraph | undefined) =>
    JSON.stringify({ ...g, name: undefined, nodes: g?.nodes?.map((n) => ({ ...n, ui: undefined })) })
  return bare(a) === bare(b)
}
