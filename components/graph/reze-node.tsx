"use client"

// Blender-style node card: input sockets down the left, outputs down the right.
// Socket names are the React Flow handle ids — the 1:1 mapping the engine schema
// was designed around (see lib/graph-flow.ts). Unlinked float literals are edited
// inline on the card (Blender-style); edits flow through updateNodeData →
// onNodesChange → recompile.

import { useState } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { Input } from "@/components/ui/input"
import { NODE_REGISTRY } from "reze-engine"
import { ColorPickerDialog } from "@/components/color-picker"
import { hexToLinearVec3, linearVec3ToHex } from "@/lib/scene-settings"
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

// Shared inline number-field styling (float literal + vector components).
const NUM_FIELD =
  "nodrag h-4.5 rounded-sm border-zinc-700 bg-zinc-950/80 px-1 py-0 text-right !text-xs tabular-nums shadow-none focus-visible:ring-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

// A color socket's literal is a linear vec3 (or vec4 rgb); the picker speaks sRGB
// hex, so convert on the boundary. `nodrag` keeps clicks from dragging the node.
function ColorSocketButton({ rgb, onChange }: { rgb: [number, number, number]; onChange: (rgb: [number, number, number]) => void }) {
  const [open, setOpen] = useState(false)
  const hex = linearVec3ToHex({ x: rgb[0], y: rgb[1], z: rgb[2] })
  return (
    <>
      <button
        type="button"
        aria-label="Pick color"
        onClick={() => setOpen(true)}
        onDoubleClick={(e) => e.stopPropagation()}
        className="nodrag ml-auto h-4.5 w-9 shrink-0 rounded-sm ring-1 ring-white/20"
        style={{ background: hex }}
      />
      <ColorPickerDialog
        open={open}
        onOpenChange={setOpen}
        value={hex}
        onChange={(h) => {
          const v = hexToLinearVec3(h)
          onChange([v.x, v.y, v.z])
        }}
      />
    </>
  )
}

// Three compact XYZ fields for a vector literal, stacked under the socket label.
function VectorSocketInput({ value, onChange }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  return (
    <div className="nodrag mt-0.5 mb-1 flex gap-1 pl-3" onDoubleClick={(e) => e.stopPropagation()}>
      {([0, 1, 2] as const).map((i) => (
        <Input
          key={i}
          type="number"
          step={0.1}
          value={round4(value[i])}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            const next: [number, number, number] = [...value]
            next[i] = n
            onChange(next)
          }}
          className={`${NUM_FIELD} w-full min-w-0`}
        />
      ))}
    </div>
  )
}

/** Coerce a socket literal to an rgb triple (scalars splat) for the color control. */
const asRgb = (v: number | number[]): [number, number, number] =>
  typeof v === "number" ? [v, v, v] : [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]

export function RezeNode({ id, data, selected }: NodeProps<RezeFlowNode>) {
  const { updateNodeData } = useReactFlow()
  const { graphNode, linkedInputs, isOutput, isPreview } = data
  const { inputs, outputs } = socketsOf(graphNode.type)
  const isContext = inputs.length === 0 && (graphNode.type === "texture" || graphNode.type === "geometry")

  const setInput = (socket: string, value: number | number[]) => {
    updateNodeData(id, {
      graphNode: { ...graphNode, inputs: { ...graphNode.inputs, [socket]: value } },
    })
  }

  return (
    <div
      className={`rounded-md border bg-zinc-900/95 text-zinc-200 shadow-lg min-w-44 text-xs ${
        selected
          ? "border-pink-400"
          : isOutput
            ? "border-blue-400"
            : isContext
              ? "border-emerald-700"
              : "border-zinc-700"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-2 py-1 rounded-t-md font-medium text-xs ${isContext ? "bg-emerald-900/60" : "bg-zinc-800"}`}
      >
        <span>{graphNode.id}</span>
        <span className="text-zinc-500 font-normal">{graphNode.type}</span>
        <span className="ml-auto flex items-center gap-1">
          {isPreview && (
            <span className="rounded-sm bg-pink-500/20 px-1 text-[9px] font-semibold tracking-wide text-pink-300">
              PREVIEW
            </span>
          )}
          {isOutput && (
            <span className="rounded-sm bg-blue-400/20 px-1 text-[9px] font-semibold tracking-wide text-blue-300">
              OUT
            </span>
          )}
        </span>
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
          // Fall back to the registry default so a socket left at its default (often
          // omitted from the JSON) still shows an editable control. The write only
          // happens on edit, so an untouched requiresLink socket stays link-enforced.
          const literal = graphNode.inputs?.[name] ?? NODE_REGISTRY[graphNode.type]?.inputs[name]?.default
          const linked = linkedInputs.includes(name)
          // A linked socket takes its value from the wire — no literal control.
          // Vector literals get their own XYZ row below the label (they don't fit
          // inline), so only render the label row here and the fields underneath.
          const showVector = !linked && type === "vector" && Array.isArray(literal)
          return (
            <div key={`in-${name}`} className="relative px-2">
              <div className="flex items-center gap-1.5 h-5.5">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={name}
                  style={{ background: SOCKET_COLORS[type] ?? "#fff", width: 8, height: 8 }}
                />
                <span className="text-zinc-400">{name}</span>
                {!linked && type === "float" && typeof literal === "number" && (
                  <Input
                    type="number"
                    step={0.01}
                    value={round4(literal)}
                    onChange={(e) => setInput(name, Number(e.target.value))}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`${NUM_FIELD} ml-auto w-16`}
                  />
                )}
                {!linked && type === "color" && literal !== undefined && (
                  <ColorSocketButton rgb={asRgb(literal)} onChange={(rgb) => setInput(name, rgb)} />
                )}
                {!linked && type === "vec4" && Array.isArray(literal) && (
                  <ColorSocketButton
                    rgb={asRgb(literal)}
                    onChange={(rgb) => setInput(name, [...rgb, literal[3] ?? 1])}
                  />
                )}
                {!linked && !showVector && type !== "float" && type !== "color" && type !== "vec4" && literal !== undefined && (
                  <span className="ml-auto text-zinc-500 tabular-nums">{fmtLiteral(literal)}</span>
                )}
              </div>
              {showVector && (
                <VectorSocketInput value={asRgb(literal)} onChange={(v) => setInput(name, v)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
