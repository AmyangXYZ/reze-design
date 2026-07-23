// Bijection between the engine's ShaderGraph JSON and React Flow's node/edge model.
// The engine schema is the source of truth; React Flow state is a projection of it.
// Socket names double as handle ids, so links ↔ edges is a mechanical mapping.

import type { Edge, Node } from "@xyflow/react"
import { NODE_REGISTRY, type GraphNode, type ShaderGraph } from "reze-engine"

export type RezeNodeData = {
  graphNode: GraphNode
  /** Input sockets currently fed by a link (handles render dots either way; the
   *  inspector uses this to know which literals are editable). */
  linkedInputs: string[]
  /** Editor-only badges, injected per-render from graph state (not persisted):
   *  the graph's final output node, and the node whose output is being previewed. */
  isOutput?: boolean
  isPreview?: boolean
  [key: string]: unknown
}

export type RezeFlowNode = Node<RezeNodeData, "reze">

const edgeId = (l: ShaderGraph["links"][number]) => `${l.from.node}.${l.from.socket}→${l.to.node}.${l.to.socket}`

/** Layered auto-layout for graphs without saved ui positions: x by topological
 *  depth, y stacked with per-node height estimates so tall nodes (principled,
 *  ramps) don't overlap their column neighbors. */
function autoLayout(graph: ShaderGraph): Map<string, { x: number; y: number }> {
  const depth = new Map<string, number>()
  const deps = new Map<string, string[]>()
  for (const n of graph.nodes) deps.set(n.id, [])
  for (const l of graph.links) deps.get(l.to.node)?.push(l.from.node)
  const compute = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0 // cycle — layout shouldn't crash; validation reports it
    seen.add(id)
    const d = Math.max(-1, ...deps.get(id)!.map((p) => compute(p, seen))) + 1
    depth.set(id, d)
    return d
  }
  for (const n of graph.nodes) compute(n.id, new Set())

  // Header ~28px + ~22px per socket row + card padding — matches RezeNode's rendering
  // closely enough that stacked columns keep a real visual gap.
  const estHeight = (type: string) => {
    const { inputs, outputs } = socketsOf(type)
    return 36 + (inputs.length + outputs.length) * 22
  }
  const columnY = new Map<number, number>()
  const pos = new Map<string, { x: number; y: number }>()
  for (const n of graph.nodes) {
    const d = depth.get(n.id)!
    const y = columnY.get(d) ?? 0
    pos.set(n.id, { x: d * 290, y })
    columnY.set(d, y + estHeight(n.type) + 45)
  }
  return pos
}

export function toFlow(graph: ShaderGraph): { nodes: RezeFlowNode[]; edges: Edge[] } {
  const layout = autoLayout(graph)
  const linkedByNode = new Map<string, string[]>()
  for (const l of graph.links) {
    const list = linkedByNode.get(l.to.node) ?? []
    list.push(l.to.socket)
    linkedByNode.set(l.to.node, list)
  }
  const nodes: RezeFlowNode[] = graph.nodes.map((graphNode) => ({
    id: graphNode.id,
    type: "reze",
    position: graphNode.ui?.position ?? layout.get(graphNode.id)!,
    data: { graphNode, linkedInputs: linkedByNode.get(graphNode.id) ?? [] },
  }))
  const edges: Edge[] = graph.links.map((l) => ({
    id: edgeId(l),
    source: l.from.node,
    sourceHandle: l.from.socket,
    target: l.to.node,
    targetHandle: l.to.socket,
  }))
  return { nodes, edges }
}

/** Rebuild a ShaderGraph from React Flow state; `base` supplies everything the flow
 *  doesn't model (version, name, slot, output, params). */
export function fromFlow(base: ShaderGraph, nodes: RezeFlowNode[], edges: Edge[]): ShaderGraph {
  return {
    ...base,
    nodes: nodes.map((n) => ({
      ...n.data.graphNode,
      ui: { position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } },
    })),
    links: edges.map((e) => ({
      from: { node: e.source, socket: e.sourceHandle ?? "" },
      to: { node: e.target, socket: e.targetHandle ?? "" },
    })),
  }
}

export function socketsOf(type: string): { inputs: [string, string][]; outputs: [string, string][] } {
  const spec = NODE_REGISTRY[type]
  if (!spec) return { inputs: [], outputs: [] }
  return {
    inputs: Object.entries(spec.inputs).map(([name, s]) => [name, s.type]),
    outputs: Object.entries(spec.outputs).map(([name, t]) => [name, t as string]),
  }
}
