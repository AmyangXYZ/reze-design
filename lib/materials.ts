import { NODE_REGISTRY, type MaterialPreset, type ShaderGraph } from "reze-engine"
import graphs from "@/content/graphs.json"
import stageGraphs from "@/content/stage-graphs.json"
import { asBuiltins, type GraphItem } from "@/lib/library"

// Pinned SNAPSHOTS of the engine's presets rather than live imports. The library
// presents these with authors and dates, so retuning a preset upstream shouldn't
// silently rewrite what a user sees.
//
// Two files, one shelf. The character set answers to a ROLE (body, hair, eye) and
// the engine's auto-classifier fills those slots; the stage set answers to a
// MATERIAL (tile, wood, glass) and nothing fills it automatically until someone
// loads a stage. They are tagged apart — every stage entry carries `stage` — so
// the rail can narrow to one or the other, and they share every other mechanism:
// browse, apply, fork, publish.
export const GRAPH_LIBRARY = asBuiltins<GraphItem>([
  ...(graphs as unknown as Omit<GraphItem, "owner">[]),
  ...(stageGraphs as unknown as Omit<GraphItem, "owner">[]),
])

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
  // Everything below is canonicalised before comparing, because the editor is a
  // graph EDITOR, not a text editor: the order nodes sit in the array, the order
  // sockets were typed into `inputs`, and a literal that restates the socket's own
  // default are all invisible to the compiler, which topo-sorts by node id and
  // emits the same constant either way. Comparing them raw made ordinary editing
  // register as an edit — drag a node, add a link and take it back, nudge a
  // slider and nudge it home — and every one of those ended in "where should I
  // save this?" for a graph that renders exactly as it opened.
  const bySocket = (x: [string, unknown], y: [string, unknown]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)
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
  // A literal equal to the socket's registry default says nothing the default
  // doesn't. Sockets that must be linked keep theirs: there, present and absent
  // is the difference between a graph that compiles and one that doesn't.
  const literals = (type: string, inputs: ShaderGraph["nodes"][number]["inputs"]) => {
    const spec = NODE_REGISTRY[type]
    const kept = Object.entries(inputs ?? {}).filter(([socket, value]) => {
      const input = spec?.inputs[socket]
      return !input || input.requiresLink || JSON.stringify(value, f32) !== JSON.stringify(input.default, f32)
    })
    return Object.fromEntries(kept.sort(bySocket))
  }
  const bare = (g: ShaderGraph | undefined) =>
    JSON.stringify(
      {
        version: g?.version,
        output: g?.output,
        params: g?.params,
        tags: g?.tags,
        // `ui` is layout and `name` is the label the group stamps on apply —
        // neither reaches the shader.
        nodes: [...(g?.nodes ?? [])]
          .map((n) => ({ id: n.id, type: n.type, inputs: literals(n.type, n.inputs) }))
          .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
        links: [...(g?.links ?? [])]
          .map((l) => `${l.from.node}.${l.from.socket}>${l.to.node}.${l.to.socket}`)
          .sort(),
      },
      f32,
    )
  return bare(a) === bare(b)
}

// ── Look packs ───────────────────────────────────────────────────────────────
//
// A pack is a whole rendering style: which graph each ROLE gets, and the view
// transform the set was authored against. The transform is part of the pack, not
// a preference — WuWa was tuned under Standard, which passes through the colours
// the shader computes, and reading it under Filmic desaturates exactly what makes
// it that look. Nothing else in the scene belongs here: world colour and sun are
// the user's art direction — except the WORLD, which turned out to be part of the
// look rather than beside it: the demo ships a saturated magenta world tuned for
// the AG set, and every surface multiplies ambient, so WuWa read magenta under it
// however well its own ramp was tuned. Each pack carries the world its look was
// authored under. The sun stays the user's: direction and strength are staging,
// and a style switch has no business moving the key light.

export type LookPack = "ag" | "wuwa"

/** Menu order — declared, not derived, because it is a curated shelf. */
export const LOOK_PACK_ORDER: LookPack[] = ["ag", "wuwa"]

export const LOOK_PACKS: Record<
  LookPack,
  { tag: string; transform: "standard" | "filmic"; exposure: number; world: { color: string; strength: number } }
> = {
  ag: { tag: "aether-gazer", transform: "filmic", exposure: 0.6, world: { color: "#ed6aff", strength: 0.66 } },
  wuwa: { tag: "wuthering-waves", transform: "standard", exposure: 0, world: { color: "#fdf2f8", strength: 0.36 } },
}

// Roles a pack may not cover. WuWa has one cloth look where AG has three, so a
// rough-cloth or stockings group lands on the cloth graph rather than being left
// behind on the other pack's — the group keeps its own alpha mode either way,
// which is what actually made stockings work.
const ROLE_FALLBACK: Record<string, string> = {
  cloth_rough: "cloth_smooth",
  stockings: "cloth_smooth",
}

/** The role a graph plays, as its own tags declare it. */
export function graphRole(graph: ShaderGraph): string | undefined {
  return graph.tags?.[0]
}

/**
 * The pack's graph for a role, or undefined when the pack has nothing for it.
 *
 * Undefined means LEAVE IT ALONE. A group wearing a community look, or the
 * neutral default, is not something a pack switch should quietly replace — the
 * user chose it, and it is not part of either set.
 */
export function packGraph(pack: LookPack, role: string | undefined): ShaderGraph | undefined {
  if (!role || role === "default") return undefined
  const { tag } = LOOK_PACKS[pack]
  const inPack = GRAPH_LIBRARY.filter((g) => g.tags.includes(tag))
  const find = (r: string) => inPack.find((g) => graphRole(g.payload.graph) === r)?.payload.graph
  return find(role) ?? find(ROLE_FALLBACK[role] ?? "")
}


/**
 * Which pack a set of groups is wearing, or null when it is not wearing one
 * whole.
 *
 * Only groups a pack HAS an opinion about count: a stage material or the neutral
 * default is left alone by a switch, so letting it vote would mean no scene ever
 * reads as a pack. A scene half-switched, or with one group on a community look,
 * is genuinely neither — and says so.
 */
export function activeLookPack(graphs: ShaderGraph[]): LookPack | null {
  const packs = new Set<LookPack>()
  for (const g of graphs) {
    const role = graphRole(g)
    if (!role || !packGraph("ag", role)) continue
    const name = g.name
    const hit = LOOK_PACK_ORDER.find((p) => GRAPH_LIBRARY.some((i) => i.name === name && i.tags.includes(LOOK_PACKS[p].tag)))
    if (!hit) return null
    packs.add(hit)
  }
  return packs.size === 1 ? [...packs][0] : null
}
