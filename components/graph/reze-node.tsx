"use client"

// Blender-style node card: input sockets down the left, outputs down the right.

import { createContext, memo, useContext, useRef, useState } from "react"
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react"
import { Input } from "@/components/ui/input"
import { NODE_REGISTRY } from "reze-engine"
import { ColorPickerDialog } from "@/components/color-picker"
import { nodeColor } from "@/lib/node-catalog"
import { useT } from "@/lib/i18n"
import { hexToLinearVec3, linearVec3ToHex } from "@/lib/scene-settings"
import { socketsOf, type RezeFlowNode } from "@/lib/graph-flow"

// Lets the editor drive per-node rename without threading callbacks through node `data`
export type NodeRenameOps = {
  rename: (oldId: string, next: string) => void
  renamingId: string | null
  setRenaming: (id: string | null) => void
}
const RenameNodeContext = createContext<NodeRenameOps | null>(null)
export const RenameNodeProvider = RenameNodeContext.Provider

const SOCKET_COLORS: Record<string, string> = {
  float: "#a1a1aa", // gray — scalar
  color: "#facc15", // yellow — Blender color socket
  vector: "#818cf8", // indigo — Blender vector socket
  vec4: "#f472b6",
}

// Display precision only — the graph keeps full-precision Blender constants until the user
const round4 = (v: number) => Math.round(v * 10000) / 10000

function fmtLiteral(v: number | number[]): string {
  if (typeof v === "number") return String(round4(v))
  return `(${v.map((x) => round4(x)).join(",")})`
}

// Shared inline number-field styling (float literal + vector components).
const NUM_FIELD =
  "nodrag h-4.5 rounded-sm border-zinc-700 bg-zinc-950/80 px-1 py-0 text-right !text-[11px] tabular-nums shadow-none focus-visible:ring-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

// A number input that edits smoothly
function NumberField({ value, onCommit, className }: { value: number; onCommit: (n: number) => void; className?: string }) {
  const [text, setText] = useState(() => String(round4(value)))
  const last = useRef(value)
  const focused = useRef(false)
  // Only re-sync the text from an OUTSIDE change (reset/preview) and only while NOT editing.
  if (!focused.current && value !== last.current) {
    last.current = value
    setText(String(round4(value)))
  }
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const n = Number(raw)
        if (raw.trim() !== "" && Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        focused.current = false
        last.current = value
        setText(String(round4(value)))
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={className}
    />
  )
}

// A color socket's literal is a linear vec3 (or vec4 rgb)
function ColorSocketButton({ rgb, onChange }: { rgb: [number, number, number]; onChange: (rgb: [number, number, number]) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const hex = linearVec3ToHex({ x: rgb[0], y: rgb[1], z: rgb[2] })
  return (
    <>
      <button
        type="button"
        aria-label={t.graph.pickColor}
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

// Three compact XYZ fields for a vector literal, sitting inline at the right edge
function VectorSocketInput({ value, onChange }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  return (
    <div className="nodrag ml-auto flex gap-1" onDoubleClick={(e) => e.stopPropagation()}>
      {([0, 1, 2] as const).map((i) => (
        <NumberField
          key={i}
          value={value[i]}
          onCommit={(n) => {
            const next: [number, number, number] = [...value]
            next[i] = n
            onChange(next)
          }}
          className={`${NUM_FIELD} w-9`}
        />
      ))}
    </div>
  )
}

/** Coerce a socket literal to an rgb triple (scalars splat) for the color control. */
const asRgb = (v: number | number[]): [number, number, number] =>
  typeof v === "number" ? [v, v, v] : [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]

// Memoized so a change to one node (or a viewport pan) doesn't re-render every node.
export const RezeNode = memo(function RezeNode({ id, data, selected }: NodeProps<RezeFlowNode>) {
  const t = useT()
  const { updateNodeData } = useReactFlow()
  const { graphNode, linkedInputs, isOutput, isPreview } = data
  const { inputs, outputs } = socketsOf(graphNode.type)
  const accent = nodeColor(graphNode.type) // category color (Blender-style header)
  const ops = useContext(RenameNodeContext)
  const editing = ops?.renamingId === graphNode.id

  const setInput = (socket: string, value: number | number[]) => {
    updateNodeData(id, {
      graphNode: { ...graphNode, inputs: { ...graphNode.inputs, [socket]: value } },
    })
  }

  return (
    <div
      // Preview is shown as a pink ring (the "previewing …" pill already names
      className={`rounded-md border bg-zinc-900/95 text-zinc-200 shadow-lg min-w-44 text-xs ${
        selected ? "border-pink-400" : isOutput ? "border-blue-400" : "border-zinc-700"
      }${isPreview ? " ring-2 ring-pink-500/80" : ""}`}
    >
      <div
        className="flex items-center gap-2 px-2 py-1 rounded-t-md font-medium text-xs"
        // Category-tinted header with a colored underline — the family cue.
        style={{ backgroundColor: `${accent}26`, boxShadow: `inset 0 -1.5px 0 ${accent}59` }}
      >
        {/* The id is the node's name (Blender-nickname style) — double-click to rename. */}
        {editing ? (
          <input
            autoFocus
            defaultValue={graphNode.id}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              ops?.rename(graphNode.id, e.target.value)
              ops?.setRenaming(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation() // keep Backspace/Enter/Esc out of the editor's shortcuts + RF delete
              if (e.key === "Enter") e.currentTarget.blur()
              else if (e.key === "Escape") {
                e.currentTarget.value = graphNode.id // cancel: blur then commits a no-op rename
                e.currentTarget.blur()
              }
            }}
            // field-sizing keeps the box hugging the text (in place, ~label-sized) instead of stretching
            className="nodrag rounded-sm border border-zinc-600 bg-zinc-950 px-1 text-xs text-zinc-100 outline-none [field-sizing:content] min-w-[2ch]"
          />
        ) : (
          <span
            className="cursor-text"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation() // don't also toggle preview (onNodeDoubleClick)
              ops?.setRenaming(graphNode.id)
            }}
          >
            {graphNode.id}
          </span>
        )}
        {/* Friendly (localized) node name — mirrors the Add-node palette. */}
        <span className="text-zinc-500 font-normal">{t.nodeLabel[graphNode.type] ?? graphNode.type}</span>
        {isOutput && (
          <span className="ml-auto rounded-sm bg-blue-400/20 px-1 text-[9px] font-semibold tracking-wide text-blue-300">
            OUT
          </span>
        )}
      </div>
      <div className="py-1">
        {outputs.map(([name, type]) => (
          <div key={`out-${name}`} className="relative flex justify-end items-center px-2 h-5.5">
            <span className="text-zinc-400">{t.socket[name] ?? name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={name}
              style={{ background: SOCKET_COLORS[type] ?? "#fff", width: 8, height: 8 }}
            />
          </div>
        ))}
        {inputs.map(([name, type]) => {
          // Fall back to the registry default so a socket left at its default (often omitted
          const literal = graphNode.inputs?.[name] ?? NODE_REGISTRY[graphNode.type]?.inputs[name]?.default
          const linked = linkedInputs.includes(name)
          // A linked socket takes its value from the wire — no literal control.
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
                <span className="text-zinc-400">{t.socket[name] ?? name}</span>
                {!linked && type === "float" && typeof literal === "number" && (
                  <NumberField value={literal} onCommit={(n) => setInput(name, n)} className={`${NUM_FIELD} ml-auto w-16`} />
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
                {showVector && (
                  <VectorSocketInput value={asRgb(literal)} onChange={(v) => setInput(name, v)} />
                )}
                {!linked && !showVector && type !== "float" && type !== "color" && type !== "vec4" && literal !== undefined && (
                  <span className="ml-auto text-zinc-500 tabular-nums">{fmtLiteral(literal)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
