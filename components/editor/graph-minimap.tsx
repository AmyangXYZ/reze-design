// A compact but honest schematic of a ShaderGraph — it IS the graph, not a random
// picture. Each node is a titled card (type label + a header strip), with input
// sockets down the left edge and outputs down the right, colored by socket type
// (yellow=color, indigo=vector, zinc=float) exactly like the real editor. Links
// run socket→socket in the source socket's color. Far lighter than a live React
// Flow instance, so it's safe to render dozens in a grid.

import type { ShaderGraph } from "reze-engine"
import { nodeColor } from "@/lib/node-catalog"
import { autoLayout, socketsOf } from "@/lib/graph-flow"

const NW = 150 // node width in graph space
const NH = 46 // node height
const HEADER = 15 // title strip height

// Socket type → color (mirrors components/graph/reze-node.tsx).
const SOCKET: Record<string, string> = {
  color: "#facc15", // yellow
  vector: "#818cf8", // indigo
  vec4: "#818cf8",
  float: "#a1a1aa", // zinc
}

type Meta = { x: number; y: number; ins: [string, string][]; outs: [string, string][] }

export function GraphMinimap({ graph, className }: { graph: ShaderGraph; className?: string }) {
  // Same layout source as the editor (ui.position ?? autoLayout), so a graph looks
  // identical here and in the editor — and opening the editor (which persists the
  // autoLayout positions) no longer makes this minimap jump.
  const layout = autoLayout(graph)
  const meta = new Map<string, Meta>()
  graph.nodes.forEach((n) => {
    const p = n.ui?.position ?? layout.get(n.id)!
    const { inputs, outputs } = socketsOf(n.type)
    meta.set(n.id, { x: p.x, y: p.y, ins: inputs, outs: outputs })
  })
  const nodes = [...meta.values()]
  if (nodes.length === 0) return <div className={className} />

  // Socket y-position: sockets are distributed down the node body (below the header).
  const socketY = (m: Meta, list: [string, string][], socket: string) => {
    const idx = Math.max(0, list.findIndex(([name]) => name === socket))
    return m.y + HEADER + ((idx + 0.5) * (NH - HEADER)) / Math.max(list.length, 1)
  }

  const minX = Math.min(...nodes.map((n) => n.x)) - 10
  const minY = Math.min(...nodes.map((n) => n.y)) - 8
  const maxX = Math.max(...nodes.map((n) => n.x)) + NW + 10
  const maxY = Math.max(...nodes.map((n) => n.y)) + NH + 8

  return (
    <svg
      viewBox={`${minX} ${minY} ${Math.max(maxX - minX, 1)} ${Math.max(maxY - minY, 1)}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
    >
      {/* Links first, so nodes draw on top. */}
      {graph.links.map((l, i) => {
        const a = meta.get(l.from.node)
        const b = meta.get(l.to.node)
        if (!a || !b) return null
        const [, socketType] = a.outs.find(([name]) => name === l.from.socket) ?? []
        return (
          <line
            key={i}
            x1={a.x + NW}
            y1={socketY(a, a.outs, l.from.socket)}
            x2={b.x}
            y2={socketY(b, b.ins, l.to.socket)}
            stroke={SOCKET[socketType ?? "float"] ?? "currentColor"}
            strokeOpacity={0.55}
            strokeWidth={2.5}
          />
        )
      })}

      {graph.nodes.map((n) => {
        const accent = nodeColor(n.type)
        const m = meta.get(n.id)!
        return (
          <g key={n.id}>
            <rect x={m.x} y={m.y} width={NW} height={NH} rx={8} fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} />
            {/* Header tint + colored underline — same subtle palette as the node card
                (a faint fill, not a saturated strip), so preview matches the editor. */}
            <path
              d={`M ${m.x} ${m.y + HEADER} V ${m.y + 8} Q ${m.x} ${m.y} ${m.x + 8} ${m.y} H ${m.x + NW - 8} Q ${m.x + NW} ${m.y} ${m.x + NW} ${m.y + 8} V ${m.y + HEADER} Z`}
              fill={accent}
              fillOpacity={0.16}
            />
            <line x1={m.x} y1={m.y + HEADER} x2={m.x + NW} y2={m.y + HEADER} stroke={accent} strokeOpacity={0.5} strokeWidth={1.5} />
            <text x={m.x + 8} y={m.y + 11} fontSize={11} fontWeight={600} fill="currentColor" fillOpacity={0.9}>
              {n.type}
            </text>
            {/* Input sockets (left) + output sockets (right) */}
            {m.ins.map(([name, t], j) => (
              <circle key={`i${j}`} cx={m.x} cy={socketY(m, m.ins, name)} r={3.5} fill={SOCKET[t] ?? "#a1a1aa"} />
            ))}
            {m.outs.map(([name, t], j) => (
              <circle key={`o${j}`} cx={m.x + NW} cy={socketY(m, m.outs, name)} r={3.5} fill={SOCKET[t] ?? "#a1a1aa"} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
