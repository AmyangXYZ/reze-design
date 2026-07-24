"use client"

// The node-graph editor for one style group, hosted inside the bottom drawer.
// Ported from the original full-page editor: every edit (rewire, literal change,
// node deletion) recompiles through the engine's graph→WGSL compiler (debounced)
// and hot-swaps the group's pipeline live. Double-click a node to preview its
// output on the model. ⌘/Ctrl+Z undo, ⇧ redo. The page remounts this component
// per group (key includes the group id), so all state here is one graph. Save
// keeps the live edits; Back-to-library discards them (the page reverts) — both
// are page-owned; this component just fires the callbacks.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { compileGraph, validateGraph, type CompileOptions, type Diagnostic, type ShaderGraph } from "reze-engine"
import { Check, Code, FileDown, FileUp, Grip, Maximize2, Minimize2, RotateCcw, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { RezeNode } from "@/components/graph/reze-node"
import { WgslView } from "@/components/graph/wgsl-view"
import { AddNodeMenu } from "@/components/graph/add-node-menu"
import { NodeContextMenu, type MenuAction } from "@/components/graph/node-context-menu"
import { makeGraphNode, uniqueNodeId } from "@/lib/node-catalog"
import { canConnect, fromFlow, socketsOf, socketType, toFlow, type RezeFlowNode } from "@/lib/graph-flow"
import { cn } from "@/lib/utils"

const nodeTypes = { reze: RezeNode }

// Copy/paste clipboard at module scope so it survives the per-group remount — you can
// copy nodes in one style group's graph and paste them into another's.
let clipboard: { nodes: RezeFlowNode[]; edges: Edge[] } | null = null

// Undo history compares graphs by content (positions, literals, links) so selection
// changes and sub-pixel drags don't pollute the stack.
type Snapshot = { nodes: RezeFlowNode[]; edges: Edge[] }
const snapshotSig = (s: Snapshot) =>
  JSON.stringify({
    n: s.nodes.map((n) => ({
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      g: n.data.graphNode,
    })),
    e: s.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
  })

export function GraphEditor({
  presetGraph,
  getInitialGraph,
  slotLabel,
  engineReady,
  engineError,
  open,
  onSave,
  onClose,
  onApply,
  onGraphChange,
  onApplyStateChange,
  fullscreen,
  onToggleFullscreen,
}: {
  /** The group's factory preset — what Reset returns to. */
  presetGraph: ShaderGraph
  /** Lazily resolves what the editor opens with — the preset, or a cached
   *  work-in-progress. Called once on mount (state initializer). */
  getInitialGraph: () => ShaderGraph
  slotLabel: string
  engineReady: boolean
  engineError: string | null
  open: boolean
  /** Save & close — keep the current graph, end the editing session. */
  onSave: () => void
  /** Close — discard this session's edits (restore the baseline) and close. */
  onClose: () => void
  /** Compile + swap this graph onto the active group (parent upserts the group). */
  onApply: (graph: ShaderGraph, opts?: CompileOptions) => Promise<{ ok: boolean; diagnostics: Diagnostic[] }>
  /** Fires with the rebuilt ShaderGraph on every edit — the page caches it per group. */
  onGraphChange?: (graph: ShaderGraph) => void
  /** Mirrors the compile/apply status dot — the page shows it on the collapsed pill. */
  onApplyStateChange?: (state: "ok" | "error" | "compiling") => void
  /** Full-screen drawer state (page-owned) + toggle. */
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  // `base` supplies what the flow doesn't model (name, slot, output, params);
  // importing a JSON graph swaps it, reset returns to the slot's preset.
  const [initial] = useState(() => {
    const graph = getInitialGraph()
    return { graph, ...toFlow(graph) }
  })
  const [base, setBase] = useState(initial.graph)
  const [nodes, setNodes] = useState<RezeFlowNode[]>(initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(initial.edges)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [fsBody, setFsBody] = useState("")
  const [showWgsl, setShowWgsl] = useState(false)
  const [applyState, setApplyStateRaw] = useState<"ok" | "error" | "compiling">("compiling")

  const onApplyStateChangeRef = useRef(onApplyStateChange)
  useEffect(() => {
    onApplyStateChangeRef.current = onApplyStateChange
  })
  const setApplyState = useCallback((s: "ok" | "error" | "compiling") => {
    setApplyStateRaw(s)
    onApplyStateChangeRef.current?.(s)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange<RezeFlowNode>[]) => setNodes((n) => applyNodeChanges(changes, n)),
    [],
  )
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)), [])
  // A new link into an occupied input replaces the old one (Blender/Unreal behavior;
  // the compiler also rejects two links into one socket).
  const onConnect = useCallback(
    (conn: Connection) =>
      setEdges((e) =>
        addEdge(conn, e.filter((el) => !(el.target === conn.target && el.targetHandle === conn.targetHandle))),
      ),
    [],
  )

  // Reject incompatible links mid-drag (React Flow dims the invalid target handles):
  // the source output type must be able to feed the target input type.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false // no self-connection (immediate cycle)
      const from = nodes.find((n) => n.id === c.source)?.data.graphNode.type
      const to = nodes.find((n) => n.id === c.target)?.data.graphNode.type
      if (!from || !to) return false
      const fromT = socketType(from, c.sourceHandle, "source")
      const toT = socketType(to, c.targetHandle, "target")
      return !!fromT && !!toT && canConnect(fromT, toT)
    },
    [nodes],
  )

  // ── Node ops: right-click pane → Add palette; right-click node → actions menu. ──
  const rfRef = useRef<ReactFlowInstance<RezeFlowNode, Edge> | null>(null)
  // A wire dragged onto empty canvas remembers its source socket so the Add palette
  // can auto-connect the node you pick (Blender/Unreal/Unity's core building gesture).
  type PendingConnect = { nodeId: string; handleId: string | null; handleType: "source" | "target" }
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; connect?: PendingConnect } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null)
  const connectingRef = useRef<PendingConnect | null>(null)
  // Last cursor position over the canvas, so ⌘V pastes where you're looking.
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const openAddMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault()
    setNodeMenu(null)
    setEdgeMenu(null)
    setAddMenu({ x: e.clientX, y: e.clientY })
  }, [])
  const openNodeMenu = useCallback((e: React.MouseEvent, node: RezeFlowNode) => {
    e.preventDefault()
    setAddMenu(null)
    setEdgeMenu(null)
    // Right-clicking outside the current selection selects just this node, so the
    // menu's actions have an unambiguous target (matches most node editors).
    if (!node.selected) setNodes((cur) => cur.map((n) => ({ ...n, selected: n.id === node.id })))
    setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])
  const openEdgeMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault()
    setAddMenu(null)
    setNodeMenu(null)
    setEdgeMenu({ x: e.clientX, y: e.clientY, edgeId: edge.id })
  }, [])

  const onConnectStart = useCallback<OnConnectStart>((_e, params) => {
    connectingRef.current =
      params.nodeId && params.handleType ? { nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType } : null
  }, [])
  const onConnectEnd = useCallback<OnConnectEnd>((e) => {
    const pending = connectingRef.current
    connectingRef.current = null
    // Only a drop on empty canvas opens the palette; a drop on a handle is a normal
    // connect (already handled by onConnect) or an invalid target (ignored).
    if (!pending || !(e.target as HTMLElement)?.classList?.contains("react-flow__pane")) return
    const point = "changedTouches" in e ? e.changedTouches[0] : e
    setNodeMenu(null)
    setAddMenu({ x: point.clientX, y: point.clientY, connect: pending })
  }, [])

  const addNode = useCallback(
    (type: string) => {
      if (!addMenu) return
      const pos = rfRef.current?.screenToFlowPosition({ x: addMenu.x, y: addMenu.y }) ?? { x: 0, y: 0 }
      const id = uniqueNodeId(type, new Set(nodes.map((n) => n.id)))
      const node: RezeFlowNode = {
        id,
        type: "reze",
        position: pos,
        selected: true, // select the fresh node, deselect the rest
        data: { graphNode: makeGraphNode(type, id, pos), linkedInputs: [] },
      }
      setNodes((cur) => [...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), node])

      // Auto-wire the new node to the socket the drag started from (first compatible).
      const c = addMenu.connect
      const other = c && nodes.find((n) => n.id === c.nodeId)?.data.graphNode.type
      if (c && other) {
        const socks = socketsOf(type)
        if (c.handleType === "source") {
          // Dragged from an output → wire to the new node's first same-type input,
          // else the first convertible one (so color lands on color, not float `fac`).
          const fromT = socketType(other, c.handleId, "source")
          const input =
            socks.inputs.find(([, t]) => t === fromT) ?? socks.inputs.find(([, t]) => fromT && canConnect(fromT, t))
          if (input) onConnect({ source: c.nodeId, sourceHandle: c.handleId, target: id, targetHandle: input[0] })
        } else {
          // Dragged from an input → wire the new node's first same-type output, else convertible.
          const toT = socketType(other, c.handleId, "target")
          const output =
            socks.outputs.find(([, t]) => t === toT) ?? socks.outputs.find(([, t]) => toT && canConnect(t, toT))
          if (output) onConnect({ source: id, sourceHandle: output[0], target: c.nodeId, targetHandle: c.handleId })
        }
      }
      setAddMenu(null)
    },
    [addMenu, nodes, onConnect],
  )

  // When the palette opened from a dragged wire, offer only type-compatible nodes.
  const connectAccept = useMemo(() => {
    const c = addMenu?.connect
    if (!c) return undefined
    const other = nodes.find((n) => n.id === c.nodeId)?.data.graphNode.type
    return (type: string) => {
      if (!other) return true
      const socks = socketsOf(type)
      if (c.handleType === "source") {
        const fromT = socketType(other, c.handleId, "source")
        return !!fromT && socks.inputs.some(([, t]) => canConnect(fromT, t))
      }
      const toT = socketType(other, c.handleId, "target")
      return !!toT && socks.outputs.some(([, t]) => canConnect(t, toT))
    }
  }, [addMenu, nodes])

  // Duplicate node(s) with a small offset; links aren't copied (single-node case
  // has none, and multi-select duplication keeping wires is a later refinement).
  const duplicateNodes = useCallback((ids: string[]) => {
    setNodes((cur) => {
      const taken = new Set(cur.map((n) => n.id))
      const clones: RezeFlowNode[] = []
      for (const id of ids) {
        const src = cur.find((n) => n.id === id)
        if (!src) continue
        const newId = uniqueNodeId(src.data.graphNode.type, taken)
        taken.add(newId)
        const position = { x: src.position.x + 32, y: src.position.y + 32 }
        clones.push({
          id: newId,
          type: "reze",
          position,
          selected: true,
          data: {
            graphNode: { ...src.data.graphNode, id: newId, inputs: { ...src.data.graphNode.inputs }, ui: { position } },
            linkedInputs: [],
          },
        })
      }
      if (!clones.length) return cur
      return [...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), ...clones]
    })
  }, [])

  const deleteNodes = useCallback((ids: string[]) => {
    const gone = new Set(ids)
    setNodes((cur) => cur.filter((n) => !gone.has(n.id)))
    setEdges((cur) => cur.filter((e) => !gone.has(e.source) && !gone.has(e.target)))
    setPreviewId((p) => (p && gone.has(p) ? null : p))
  }, [])

  // Break every link touching these nodes (Unreal's "Break All Pin Links").
  const disconnectNodes = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setEdges((cur) => cur.filter((e) => !set.has(e.source) && !set.has(e.target)))
  }, [])

  // ── Copy / cut / paste (cross-graph via the module clipboard). ──
  const copyNodes = useCallback(
    (ids: string[]) => {
      const set = new Set(ids)
      const picked = nodes.filter((n) => set.has(n.id))
      if (!picked.length) return
      clipboard = {
        nodes: picked.map((n) => ({ ...n, data: { ...n.data, graphNode: { ...n.data.graphNode } } })),
        edges: edges.filter((e) => set.has(e.source) && set.has(e.target)).map((e) => ({ ...e })), // internal only
      }
    },
    [nodes, edges],
  )

  const paste = useCallback(() => {
    if (!clipboard?.nodes.length) return
    const anchor = rfRef.current?.screenToFlowPosition(lastPointer.current) ?? { x: 0, y: 0 }
    const minX = Math.min(...clipboard.nodes.map((n) => n.position.x))
    const minY = Math.min(...clipboard.nodes.map((n) => n.position.y))
    const taken = new Set(nodes.map((n) => n.id))
    const idMap = new Map<string, string>()
    const pastedNodes = clipboard.nodes.map((n) => {
      const nid = uniqueNodeId(n.data.graphNode.type, taken)
      taken.add(nid)
      idMap.set(n.id, nid)
      const position = { x: anchor.x + (n.position.x - minX), y: anchor.y + (n.position.y - minY) }
      return { ...n, id: nid, position, selected: true, data: { ...n.data, graphNode: { ...n.data.graphNode, id: nid, ui: { position } } } }
    })
    const pastedEdges: Edge[] = clipboard.edges.map((e) => {
      const source = idMap.get(e.source)!
      const target = idMap.get(e.target)!
      return { ...e, id: `${source}.${e.sourceHandle}→${target}.${e.targetHandle}`, source, target }
    })
    // Recompute linkedInputs from the pasted (internal) edges so literal controls show correctly.
    const linkedBy = new Map<string, string[]>()
    for (const e of pastedEdges) linkedBy.set(e.target, [...(linkedBy.get(e.target) ?? []), e.targetHandle ?? ""])
    for (const n of pastedNodes) n.data = { ...n.data, linkedInputs: linkedBy.get(n.id) ?? [] }
    setNodes((cur) => [...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), ...pastedNodes])
    setEdges((cur) => [...cur, ...pastedEdges])
  }, [nodes])

  // Point the graph's final output at a node's primary output socket.
  const setOutputNode = useCallback(
    (nodeId: string) => {
      const socket = socketsOf(nodes.find((n) => n.id === nodeId)?.data.graphNode.type ?? "").outputs[0]?.[0]
      if (socket) setBase((b) => ({ ...b, output: { node: nodeId, socket } }))
    },
    [nodes],
  )

  // ── Edge reconnect: drag either end of an existing edge to a new socket;
  //    dropping it on empty canvas deletes it (Blender-like). ──
  const reconnectDidConnect = useRef(false)
  const onReconnectStart = useCallback(() => {
    reconnectDidConnect.current = false
  }, [])
  const onReconnect = useCallback((oldEdge: Edge, conn: Connection) => {
    reconnectDidConnect.current = true
    setEdges((els) => reconnectEdge(oldEdge, conn, els))
  }, [])
  const onReconnectEnd = useCallback((_e: unknown, edge: Edge) => {
    if (!reconnectDidConnect.current) setEdges((els) => els.filter((el) => el.id !== edge.id))
    reconnectDidConnect.current = true
  }, [])

  // ── Undo/redo: debounced content snapshots — a whole node drag or a burst of
  //    literal edits is one undo step. ──
  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const present = useRef<Snapshot>({ nodes: initial.nodes, edges: initial.edges })
  const restoring = useRef(false)

  useEffect(() => {
    if (restoring.current) {
      restoring.current = false
      return
    }
    const timer = setTimeout(() => {
      const snap = { nodes, edges }
      if (snapshotSig(snap) === snapshotSig(present.current)) {
        present.current = snap // keep latest selection state, no history entry
        return
      }
      past.current.push(present.current)
      if (past.current.length > 64) past.current.shift()
      present.current = snap
      future.current = []
    }, 300)
    return () => clearTimeout(timer)
  }, [nodes, edges])

  const restore = useCallback((snap: Snapshot) => {
    restoring.current = true
    present.current = snap
    setNodes(snap.nodes)
    setEdges(snap.edges)
  }, [])
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(present.current)
    restore(prev)
  }, [restore])
  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(present.current)
    restore(next)
  }, [restore])

  useEffect(() => {
    if (!open) return // drawer hidden — don't swallow the page's shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      const t = e.target as HTMLElement
      // Inputs keep their native text undo.
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, undo, redo])

  // ⇧D duplicates the current selection (Blender's shortcut). Read selection from the
  // instance so this doesn't re-subscribe on every node change.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.key.toLowerCase() !== "d") return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return
      const sel = rfRef.current?.getNodes().filter((n) => n.selected).map((n) => n.id) ?? []
      if (!sel.length) return
      e.preventDefault()
      duplicateNodes(sel)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, duplicateNodes])

  // ⌘/Ctrl+C copy · X cut · V paste, on the current selection.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k !== "c" && k !== "x" && k !== "v") return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return
      const sel = rfRef.current?.getNodes().filter((n) => n.selected).map((n) => n.id) ?? []
      if (k === "v") {
        e.preventDefault()
        paste()
      } else if (sel.length) {
        e.preventDefault()
        copyNodes(sel)
        if (k === "x") deleteNodes(sel)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, paste, copyNodes, deleteNodes])

  // Swap the editor to another graph (import / reset): fresh flow state + history.
  const loadGraph = useCallback((graph: ShaderGraph) => {
    const flow = toFlow(graph)
    setBase(graph)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setPreviewId(null)
    past.current = []
    future.current = []
    present.current = { nodes: flow.nodes, edges: flow.edges }
    restoring.current = true // the state swap itself is not an undo step
  }, [])

  // ── Preset JSON export/import — the file format IS the ShaderGraph schema. ──
  const importFileRef = useRef<HTMLInputElement>(null)
  const onExport = useCallback(() => {
    const graph = fromFlow(base, nodes, edges) // include current edits + layout
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${graph.name || slotLabel || "graph"}.graph.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [base, nodes, edges, slotLabel])

  const onImportFile = useCallback(
    async (file: File) => {
      try {
        // A graph is pure shading now (no slot) — it applies to whatever group is
        // being edited, so no retargeting is needed.
        const graph = JSON.parse(await file.text()) as ShaderGraph
        const diags = validateGraph(graph)
        if (diags.some((d) => d.severity === "error")) {
          setDiagnostics(diags)
          return
        }
        loadGraph(graph)
      } catch (e) {
        setDiagnostics([{ severity: "error", message: `import failed: ${e instanceof Error ? e.message : e}` }])
      }
    },
    [loadGraph],
  )

  const currentGraph: ShaderGraph = useMemo(() => fromFlow(base, nodes, edges), [base, nodes, edges])

  // Inject the output/preview badges for rendering only (kept out of `nodes` state so
  // graph changes stay clean); `nodes` remains the source of truth for edits/undo.
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const isOutput = n.id === base.output.node
        const isPreview = n.id === previewId
        return isOutput || isPreview ? { ...n, data: { ...n.data, isOutput, isPreview } } : n
      }),
    [nodes, base.output.node, previewId],
  )

  const onGraphChangeRef = useRef(onGraphChange)
  useEffect(() => {
    onGraphChangeRef.current = onGraphChange
  })
  const onApplyRef = useRef(onApply)
  useEffect(() => {
    onApplyRef.current = onApply
  })
  useEffect(() => {
    onGraphChangeRef.current?.(currentGraph)
  }, [currentGraph])

  // ── Topology tier: debounce → compile locally for the panels → apply to engine. ──
  useEffect(() => {
    if (engineError) return
    const opts = previewId
      ? {
          previewNode: {
            node: previewId,
            socket:
              socketsOf(nodes.find((n) => n.id === previewId)?.data.graphNode.type ?? "")?.outputs[0]?.[0] ?? "color",
          },
        }
      : undefined
    const timer = setTimeout(async () => {
      const local = compileGraph(currentGraph, opts)
      setFsBody(local.fsBody)
      // Before the GPU device is up, applying would explode — engineReady is in
      // the deps, so the pending graph re-applies the moment boot completes.
      if (!engineReady) {
        setDiagnostics(local.diagnostics)
        return
      }
      setApplyState("compiling")
      try {
        const result = await onApplyRef.current(currentGraph, opts)
        setDiagnostics(result.diagnostics)
        setApplyState(result.ok ? "ok" : "error")
      } catch (e) {
        setDiagnostics([
          ...local.diagnostics,
          { severity: "error", message: `apply failed: ${e instanceof Error ? e.message : e}` },
        ])
        setApplyState("error")
      }
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGraph, previewId, engineReady, engineError])

  const errors = diagnostics.filter((d) => d.severity === "error")

  // Mount React Flow only once its host has real dimensions — the drawer's
  // panels measure asynchronously, and RF warns (error #004) if it mounts into
  // a 0×0 container.
  const flowHostRef = useRef<HTMLDivElement>(null)
  const [flowSized, setFlowSized] = useState(false)
  useEffect(() => {
    const el = flowHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setFlowSized(true)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* ── Header — same language as the pill: slot icon + label, icons for
          everything else. The icon carries compile status (red on error). ── */}
      {/* The whole header is the window drag surface (buttons still work — see
          FloatingPanel.onContainerDown); a centered grip is the affordance. */}
      <header
        data-drag-handle
        // Solid (opaque, no backdrop) — it's a thin, non-focal strip, and keeping it
        // out of the panel's translucent/blurred layer is cheaper and reads crisper.
        className={cn(
          // border-b (not a separate <Separator>) so the divider is part of the solid
          // header's box — no sub-pixel seam letting the glass panel bleed through.
          "relative flex shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950 pt-1 pb-1 pr-2 pl-3",
          !fullscreen && "cursor-grab active:cursor-grabbing",
        )}
      >
        <Workflow
          className={cn(
            "size-3.5",
            applyState === "error" ? "text-red-400" : "text-zinc-400",
            applyState === "compiling" && "animate-pulse",
          )}
        />
        <span className="min-w-0 truncate text-xs font-medium text-zinc-200">{slotLabel}</span>
        {!fullscreen && (
          <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-600">
            <Grip className="size-4" />
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {/* ── Tools: code view + reset ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-6", showWgsl ? "text-pink-300 hover:text-pink-200" : "text-zinc-400 hover:text-zinc-100")}
                onClick={() => setShowWgsl((v) => !v)}
              >
                <Code className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Generated WGSL</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={() => loadGraph(presetGraph)}>
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to preset</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

          {/* ── Import / export the graph as JSON ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={() => importFileRef.current?.click()}>
                <FileUp className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import graph (.json)</TooltipContent>
          </Tooltip>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void onImportFile(file)
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={onExport}>
                <FileDown className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export graph (.json)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

          {/* ── Full screen ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={onToggleFullscreen}>
                {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{fullscreen ? "Exit full screen" : "Full screen"}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />

          {/* ── Exit: close (discard) or save (keep) ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={onClose}>
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Discard changes &amp; close</TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            onClick={onSave}
            className="ml-1 h-6 gap-1 bg-blue-400 px-2 text-xs font-medium text-white hover:bg-blue-300"
          >
            <Check className="size-3.5" />
            Save
          </Button>
        </div>
      </header>

      {/* ── Graph canvas + optional WGSL pane ── */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="70" minSize="40">
            <div
              ref={flowHostRef}
              className="relative h-full"
              onMouseMove={(e) => (lastPointer.current = { x: e.clientX, y: e.clientY })}
            >
              {flowSized && (
                <ReactFlow
                onInit={(inst) => (rfRef.current = inst)}
                nodes={displayNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                onReconnectStart={onReconnectStart}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                onNodeDoubleClick={(_, n) => setPreviewId((prev) => (prev === n.id ? null : n.id))}
                onPaneContextMenu={openAddMenu}
                onNodeContextMenu={openNodeMenu}
                onEdgeContextMenu={openEdgeMenu}
                deleteKeyCode={["Backspace", "Delete"]}
                colorMode="dark"
                defaultViewport={{ x: 24, y: 24, zoom: 0.7 }}
                minZoom={0.2}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background gap={24} />
                  <Controls showInteractive={false} />
                  <MiniMap pannable zoomable style={{ width: 120, height: 80 }} bgColor="transparent" />
                </ReactFlow>
              )}

              {previewId && (
                <div className="absolute top-2 right-2 z-10 rounded-md bg-pink-600/90 px-2.5 py-1 text-xs">
                  previewing “{previewId}”
                  <button className="ml-2 cursor-pointer underline" onClick={() => setPreviewId(null)}>
                    exit
                  </button>
                </div>
              )}

              {diagnostics.length > 0 && (
                <div className="absolute bottom-2 left-1/2 z-10 max-w-[70%] -translate-x-1/2 space-y-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs">
                  {errors.length > 0 && (
                    <div className="font-medium text-red-400">{errors.length} error(s) — previous look kept</div>
                  )}
                  {diagnostics.map((d, i) => (
                    <div key={i} className={d.severity === "error" ? "text-red-400" : "text-amber-400"}>
                      {d.nodeId && <span className="text-zinc-500">[{d.nodeId}] </span>}
                      {d.message}
                    </div>
                  ))}
                </div>
              )}

              {addMenu && (
                <AddNodeMenu
                  x={addMenu.x}
                  y={addMenu.y}
                  accept={connectAccept}
                  onPick={addNode}
                  onClose={() => setAddMenu(null)}
                />
              )}

              {nodeMenu &&
                (() => {
                  const node = nodes.find((n) => n.id === nodeMenu.nodeId)
                  if (!node) return null
                  // openNodeMenu guarantees the clicked node is selected; act on the
                  // whole selection (single- or multi-node).
                  const sel = nodes.filter((n) => n.selected).map((n) => n.id)
                  const targets = sel.length ? sel : [nodeMenu.nodeId]
                  const single = targets.length === 1
                  const isOutput = base.output.node === nodeMenu.nodeId
                  const isPreview = previewId === nodeMenu.nodeId
                  const hasOutput = socketsOf(node.data.graphNode.type).outputs.length > 0
                  const plural = single ? "" : ` ${targets.length}`
                  const actions: (MenuAction | "separator")[] = [
                    // Output/preview are single-node concepts — hidden in a multi-select.
                    ...(single
                      ? ([
                          {
                            label: "Set as output",
                            checked: isOutput,
                            disabled: isOutput || !hasOutput,
                            onSelect: () => setOutputNode(nodeMenu.nodeId),
                          },
                          {
                            label: isPreview ? "Stop preview" : "Preview output",
                            disabled: !hasOutput,
                            onSelect: () => setPreviewId(isPreview ? null : nodeMenu.nodeId),
                          },
                          "separator",
                        ] as (MenuAction | "separator")[])
                      : []),
                    { label: `Copy${plural}`, shortcut: "⌘C", onSelect: () => copyNodes(targets) },
                    { label: `Duplicate${plural}`, shortcut: "⇧D", onSelect: () => duplicateNodes(targets) },
                    { label: "Disconnect", onSelect: () => disconnectNodes(targets) },
                    "separator",
                    { label: `Delete${plural}`, shortcut: "⌫", danger: true, onSelect: () => deleteNodes(targets) },
                  ]
                  return (
                    <NodeContextMenu
                      x={nodeMenu.x}
                      y={nodeMenu.y}
                      actions={actions}
                      onClose={() => setNodeMenu(null)}
                    />
                  )
                })()}

              {edgeMenu && (
                <NodeContextMenu
                  x={edgeMenu.x}
                  y={edgeMenu.y}
                  actions={[
                    {
                      label: "Delete link",
                      shortcut: "⌫",
                      danger: true,
                      onSelect: () => setEdges((cur) => cur.filter((el) => el.id !== edgeMenu.edgeId)),
                    },
                  ]}
                  onClose={() => setEdgeMenu(null)}
                />
              )}
            </div>
          </ResizablePanel>
          {showWgsl && (
            <>
              <ResizableHandle className="bg-white/5" />
              <ResizablePanel defaultSize="30" minSize="15">
                <div className="flex h-full flex-col">
                  <h3 className="shrink-0 border-b border-white/10 px-3 py-1.5 text-xs tracking-wide text-zinc-500 uppercase">
                    Generated WGSL · fs body
                  </h3>
                  <div className="flex-1 cursor-text overflow-auto select-text">
                    {fsBody ? <WgslView code={fsBody} /> : <p className="p-3 text-zinc-600">—</p>}
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
