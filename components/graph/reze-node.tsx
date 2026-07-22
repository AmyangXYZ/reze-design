"use client"

// Blender-style node card: input sockets down the left, outputs down the right.
// Socket names are the React Flow handle ids — the 1:1 mapping the engine schema
// was designed around (see lib/graph-flow.ts). Unlinked float literals are edited
// inline on the card (Blender-style); edits flow through updateNodeData →
// onNodesChange → recompile.

import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { Input } from "@/components/ui/input"
import { socketsOf, type RezeFlowNode } from "@/lib/graph-flow"

const SOCKET_COLORS: Record<string, string> = {
  float: "#a1a1aa", // gray — scalar
  color: "#facc15", // yellow — Blender color socket
  vector: "#818cf8", // indigo — Blender vector socket
  vec4: "#f472b6",
}

// Display precision only — the graph keeps full-precision Blender constants until
// the user actually edits a field (0.19999998807907104 shows as 0.2).
const round4 = (v: number) => Math.round(v * 10000) / 10000

function fmtLiteral(v: number | number[]): string {
  if (typeof v === "number") return String(round4(v))
  return `(${v.map((x) => round4(x)).join(",")})`
}

export function RezeNode({ id, data, selected }: NodeProps<RezeFlowNode>) {
  const { updateNodeData } = useReactFlow()
  const { graphNode, linkedInputs } = data
  const { inputs, outputs } = socketsOf(graphNode.type)
  const isContext = inputs.length === 0 && (graphNode.type === "texture" || graphNode.type === "geometry")

  const setLiteral = (socket: string, value: number) => {
    if (!Number.isFinite(value)) return
    updateNodeData(id, {
      graphNode: { ...graphNode, inputs: { ...graphNode.inputs, [socket]: value } },
    })
  }

  return (
    <div
      className={`rounded-md border bg-zinc-900/95 text-zinc-200 shadow-lg min-w-44 text-xs ${
        selected ? "border-pink-400" : isContext ? "border-emerald-700" : "border-zinc-700"
      }`}
    >
      <div
        className={`px-2 py-1 rounded-t-md font-medium text-xs ${isContext ? "bg-emerald-900/60" : "bg-zinc-800"}`}
      >
        {graphNode.id}
        <span className="ml-2 text-zinc-500 font-normal">{graphNode.type}</span>
      </div>
      <div className="py-1">
        {outputs.map(([name, type]) => (
          <div key={`out-${name}`} className="relative flex justify-end items-center px-2 h-5.5">
            <span className="text-zinc-400">{name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={name}
              style={{ background: SOCKET_COLORS[type] ?? "#fff", width: 8, height: 8 }}
            />
          </div>
        ))}
        {inputs.map(([name, type]) => {
          const literal = graphNode.inputs?.[name]
          const linked = linkedInputs.includes(name)
          const editable = !linked && type === "float" && typeof literal === "number"
          return (
            <div key={`in-${name}`} className="relative flex items-center gap-1.5 px-2 h-5.5">
              <Handle
                type="target"
                position={Position.Left}
                id={name}
                style={{ background: SOCKET_COLORS[type] ?? "#fff", width: 8, height: 8 }}
              />
              <span className="text-zinc-400">{name}</span>
              {editable ? (
                <Input
                  type="number"
                  step={0.01}
                  value={round4(literal as number)}
                  onChange={(e) => setLiteral(name, Number(e.target.value))}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="nodrag ml-auto h-4.5 w-16 rounded-sm border-zinc-700 bg-zinc-950/80 px-1 py-0 text-right !text-xs tabular-nums shadow-none focus-visible:ring-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              ) : (
                !linked &&
                literal !== undefined && (
                  <span className="ml-auto text-zinc-500 tabular-nums">{fmtLiteral(literal)}</span>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
