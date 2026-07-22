// A cheap, static schematic of a StyleGraph — nodes as rounded rects at their
// editor positions, links as faint wires. Far lighter than a real React Flow
// instance (safe to render dozens in a grid) and honest (it IS the graph, not a
// random color). Falls back to an auto-grid when a node lacks a saved position.

import type { StyleGraph } from "reze-engine"

const NW = 150 // approx node width in graph space
const NH = 46 // approx node height

export function GraphMinimap({ graph, className }: { graph: StyleGraph; className?: string }) {
  const pos = new Map<string, { x: number; y: number }>()
  graph.nodes.forEach((n, i) => {
    const p = n.ui?.position
    pos.set(n.id, p ? { x: p.x, y: p.y } : { x: (i % 6) * (NW + 40), y: Math.floor(i / 6) * (NH + 40) })
  })
  const pts = [...pos.values()]
  if (pts.length === 0) return <div className={className} />
  const minX = Math.min(...pts.map((p) => p.x)) - 8
  const minY = Math.min(...pts.map((p) => p.y)) - 8
  const maxX = Math.max(...pts.map((p) => p.x)) + NW + 8
  const maxY = Math.max(...pts.map((p) => p.y)) + NH + 8

  return (
    <svg
      viewBox={`${minX} ${minY} ${Math.max(maxX - minX, 1)} ${Math.max(maxY - minY, 1)}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
    >
      {graph.links.map((l, i) => {
        const a = pos.get(l.from.node)
        const b = pos.get(l.to.node)
        if (!a || !b) return null
        return (
          <line
            key={i}
            x1={a.x + NW}
            y1={a.y + NH / 2}
            x2={b.x}
            y2={b.y + NH / 2}
            stroke="currentColor"
            strokeOpacity={0.18}
            strokeWidth={3}
          />
        )
      })}
      {graph.nodes.map((n) => {
        const p = pos.get(n.id)!
        return (
          <rect
            key={n.id}
            x={p.x}
            y={p.y}
            width={NW}
            height={NH}
            rx={10}
            fill="currentColor"
            fillOpacity={0.12}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={2}
          />
        )
      })}
    </svg>
  )
}
