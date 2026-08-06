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

/** A scene's `graph: "<name>"` → the graph itself. Built-ins only, deliberately:
 *  use-community builds its built-in name set from GRAPH_LIBRARY at module
 *  scope, so reaching back into it from here is a cycle, and materials is still
 *  initialising when community reads from it. Community graphs need no entry
 *  anyway — they travel as pins, and an EDITED one is an orphan that
 *  adoptOrphanGraphs takes a local copy of. */
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
  // Numbers are normalised to float32 before comparing. Every one of these
  // values reaches the GPU as an f32 uniform, so two graphs whose params agree
  // in f32 ARE the same look — but as f64 they can disagree in the final digit
  // depending on which round-trip produced them:
  //
  //   engine preset   "hue": 0.46000000834465027
  //   graphs.json     "hue": 0.4600000083446502
  //
  // That is a difference of ~1e-17, far below f32's ~6e-8 resolution, and it was
  // enough to make a freshly auto-styled group fail to recognise the built-in it
  // came from — so every upload adopted "Body"/"Face" as an orphan and deposited
  // a "Body 2" draft in the user's library.
  const f32 = (_key: string, v: unknown) => (typeof v === "number" ? Math.fround(v) : v)
  const bare = (g: ShaderGraph | undefined) =>
    JSON.stringify({ ...g, name: undefined, nodes: g?.nodes?.map((n) => ({ ...n, ui: undefined })) }, f32)
  return bare(a) === bare(b)
}
