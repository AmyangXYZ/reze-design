"use client"

// The node-graph editor for one style group, hosted inside the bottom drawer.

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
import { Check, Code, Download, Grip, Maximize2, Minimize2, RotateCcw, Upload, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { RezeNode, RenameNodeProvider } from "@/components/graph/reze-node"
import { WgslView } from "@/components/graph/wgsl-view"
import { AddNodeMenu } from "@/components/graph/add-node-menu"
import { NodeContextMenu, type MenuAction } from "@/components/graph/node-context-menu"
import { makeGraphNode, uniqueNodeId } from "@/lib/node-catalog"
import { canConnect, fromFlow, socketsOf, socketType, toFlow, type RezeFlowNode } from "@/lib/graph-flow"
import { useUndoScope } from "@/hooks/use-undo-scope"
import { useT } from "@/lib/i18n"
import { slug } from "@/lib/scene-file"
import { cn } from "@/lib/utils"

const nodeTypes = { reze: RezeNode }

// Copy/paste clipboard at module scope so it survives the per-group remount
let clipboard: { nodes: RezeFlowNode[]; edges: Edge[] } | null = null

// Undo history compares graphs by content (positions, literals, links) so selection changes
// aren't steps. `base` rides along because the output socket and the exposed params live
// there rather than in the flow, and a node rename moves BOTH — history that watched only
// the flow could undo the rename and leave the output pointing at an id nothing carries.
type Snapshot = { nodes: RezeFlowNode[]; edges: Edge[]; base: ShaderGraph }
const snapshotSig = (s: Snapshot) =>
  JSON.stringify({
    n: s.nodes.map((n) => ({
      id: n.id,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      g: n.data.graphNode,
    })),
    e: s.edges.map((e) => [e.source, e.sourceHandle, e.target, e.targetHandle]),
    b: { output: s.base.output, params: s.base.params },
  })

export function GraphEditor({
  presetGraph,
  getInitialGraph,
  slotLabel,
  engineReady,
  engineError,
  open,
  onClose,
  onApply,
  onGraphChange,
  onApplyStateChange,
  fullscreen = false,
  onToggleFullscreen,
}: {
  /** The group's factory preset — what Reset returns to. */
  presetGraph: ShaderGraph
  /** Lazily resolves what the editor opens with — the preset, or a cached work-in-progress. */
  getInitialGraph: () => ShaderGraph
  slotLabel: string
  engineReady: boolean
  engineError: string | null
  open: boolean
  /** Save & close — keep the current graph, end the editing session. */
  /** Close — discard this session's edits (restore the baseline) and close. */
  onClose: () => void
  /** Compile + swap this graph onto the active group (parent upserts the group). */
  onApply: (graph: ShaderGraph, opts?: CompileOptions) => Promise<{ ok: boolean; diagnostics: Diagnostic[] }>
  /** Fires with the rebuilt ShaderGraph on every edit — the page caches it per group. */
  onGraphChange?: (graph: ShaderGraph) => void
  /** Mirrors the compile/apply status dot — the page shows it on the collapsed pill. */
  onApplyStateChange?: (state: "ok" | "error" | "compiling") => void
  /** Full-screen state (page-owned, since the PANEL is what resizes) + toggle.
   *  No toggle passed = no button: a host that cannot resize its panel must not
   *  show a control that would do nothing. */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}) {
  const t = useT()
  // `base` supplies what the flow doesn't model (name, slot, output, params)
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
  // A new link into an occupied input replaces the old one (Blender/Unreal behavior
  const onConnect = useCallback(
    (conn: Connection) =>
      setEdges((e) =>
        addEdge(conn, e.filter((el) => !(el.target === conn.target && el.targetHandle === conn.targetHandle))),
      ),
    [],
  )

  // Reject incompatible links mid-drag (React Flow dims the invalid target handles)
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
    // Right-clicking outside the current selection selects just this node, so the menu's actions
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
    // Only a drop on empty canvas opens the palette
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
          // Dragged from an output → wire to the new node's first same-type input, else the first
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

  // Duplicate node(s) with a small offset
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

  // Rename a node's id — its title doubles as its identity (Blender-nickname style)
  const renameNode = useCallback((oldId: string, raw: string) => {
    const next = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
    if (!next || next === oldId) return
    if (rfRef.current?.getNodes().some((n) => n.id === next)) return // id already taken
    setNodes((cur) =>
      cur.map((n) =>
        n.id === oldId ? { ...n, id: next, data: { ...n.data, graphNode: { ...n.data.graphNode, id: next } } } : n,
      ),
    )
    setEdges((cur) =>
      cur.map((e) => {
        if (e.source !== oldId && e.target !== oldId) return e
        const source = e.source === oldId ? next : e.source
        const target = e.target === oldId ? next : e.target
        return { ...e, source, target, id: `${source}.${e.sourceHandle}→${target}.${e.targetHandle}` }
      }),
    )
    setBase((b) => (b.output.node === oldId ? { ...b, output: { ...b.output, node: next } } : b))
    setPreviewId((p) => (p === oldId ? next : p))
  }, [])

  // Which node's title is in rename mode
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const nodeRenameOps = useMemo(
    () => ({ rename: renameNode, renamingId, setRenaming: setRenamingId }),
    [renameNode, renamingId],
  )

  // Edge reconnect: drag either end of an existing edge to a new socket
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

  // Undo/redo: debounced content snapshots
  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const present = useRef<Snapshot>({ nodes: initial.nodes, edges: initial.edges, base: initial.graph })
  const latest = useRef<Snapshot>({ nodes: initial.nodes, edges: initial.edges, base: initial.graph })
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoring = useRef(false)

  // Close the open step. A burst of edits is one entry, so this normally runs on
  // the settle timer — but ⌘Z fires it first, because an edit undone within the
  // settle window is exactly the case the debounce would otherwise swallow: the
  // keystroke found an empty timeline, did nothing, and the edit landed anyway.
  const commit = useCallback(() => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    const snap = latest.current
    if (snapshotSig(snap) === snapshotSig(present.current)) {
      present.current = snap // keep latest selection state, no history entry
      return
    }
    past.current.push(present.current)
    if (past.current.length > 64) past.current.shift()
    present.current = snap
    future.current = []
  }, [])

  useEffect(() => {
    latest.current = { nodes, edges, base }
    if (restoring.current) {
      restoring.current = false
      return
    }
    settle.current = setTimeout(commit, 300)
    return () => {
      if (settle.current) clearTimeout(settle.current)
      settle.current = null
    }
  }, [nodes, edges, base, commit])

  const restore = useCallback((snap: Snapshot) => {
    restoring.current = true
    present.current = snap
    latest.current = snap
    setNodes(snap.nodes)
    setEdges(snap.edges)
    setBase(snap.base)
  }, [])
  const undo = useCallback(() => {
    commit()
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(present.current)
    restore(prev)
  }, [commit, restore])
  const redo = useCallback(() => {
    commit()
    const next = future.current.pop()
    if (!next) return
    past.current.push(present.current)
    restore(next)
  }, [commit, restore])

  // Undo reaches this editor only while the user is working inside it — the scope
  // props go on the root below.
  const undoScope = useUndoScope("graph", { undo, redo }, { enabled: open })

  // ⇧D duplicates the current selection (Blender's shortcut).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.key.toLowerCase() !== "d") return
      const el = e.target as HTMLElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return
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
      const el = e.target as HTMLElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return
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
    present.current = { nodes: flow.nodes, edges: flow.edges, base: graph }
    latest.current = present.current
    restoring.current = true // the state swap itself is not an undo step
  }, [])

  const currentGraph: ShaderGraph = useMemo(() => fromFlow(base, nodes, edges), [base, nodes, edges])

  // ── Graph as a file ──────────────────────────────────────────────────────
  // A graph is small, self-contained JSON, which makes it the natural unit to
  // hand around: a look can be written by hand, generated against the node
  // registry, or passed between people without a scene or a login.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const exportGraph = useCallback(() => {
    const json = JSON.stringify(currentGraph, null, 2)
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }))
    const a = document.createElement("a")
    a.href = url
    // Named the way scene and video exports are, so a downloads folder sorts a
    // session's artifacts together — and so a file that has travelled through a
    // chat still says what it is and what made it.
    a.download = `reze-design-shader-graph-${slug(slotLabel, "graph")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [currentGraph, slotLabel])

  const importGraph = useCallback(
    async (file: File) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        setDiagnostics([{ severity: "error", message: t.graph.importNotJson }])
        return
      }
      const graph = parsed as ShaderGraph
      // Validated BEFORE it reaches the canvas. A generated graph is exactly the
      // kind that arrives subtly wrong, and the compiler already says why in the
      // same panel edits report through — so a bad file reads as a list of
      // problems rather than a material that silently stops rendering.
      let problems: Diagnostic[]
      try {
        problems = validateGraph(graph)
      } catch {
        setDiagnostics([{ severity: "error", message: t.graph.importNotGraph }])
        return
      }
      if (problems.some((d) => d.severity === "error")) {
        setDiagnostics(problems)
        return
      }
      loadGraph(graph)
    },
    [loadGraph, t],
  )

  // Inject the output/preview badges for rendering only (kept out of `nodes` state so graph
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

  // ── Two tiers, and only one of them is free ──
  //
  // Generating WGSL from the graph is CPU work in this tab. Handing it to the
  // engine is a shader compile and a pipeline rebuild, which stalls frames — and
  // it ran 250ms after EVERY edit, so dragging one slider paid for a dozen of
  // them. The local tier stays live, because a graph with a mistake in it should
  // say so while you type; the engine tier is now something you ask for.
  const previewOpts = useMemo(
    () =>
      previewId
        ? {
            previewNode: {
              node: previewId,
              socket:
                socketsOf(nodes.find((n) => n.id === previewId)?.data.graphNode.type ?? "")?.outputs[0]?.[0] ?? "color",
            },
          }
        : undefined,
    [previewId, nodes],
  )
  // What the ENGINE is showing. Compared by value, so an edit that lands back on
  // the applied graph puts the Apply button away instead of leaving it lit.
  const appliedRef = useRef<string | null>(null)
  const [dirty, setDirty] = useState(false)
  // What an unmount would still owe the engine, kept beside the flag that
  // decides it. Data rather than a callback, because what has to survive the
  // teardown is the graph — the apply goes through the host's ref, which
  // outlives this component.
  const pendingRef = useRef<{ graph: ShaderGraph; opts?: CompileOptions } | null>(null)

  // Local tier: WGSL + diagnostics, debounced, no GPU.
  useEffect(() => {
    if (engineError) return
    const timer = setTimeout(() => {
      const local = compileGraph(currentGraph, previewOpts)
      setFsBody(local.fsBody)
      setDiagnostics(local.diagnostics)
      const behind = JSON.stringify([currentGraph, previewId]) !== appliedRef.current
      setDirty(behind)
      pendingRef.current = behind ? { graph: currentGraph, opts: previewOpts } : null
    }, 250)
    return () => clearTimeout(timer)
  }, [currentGraph, previewId, previewOpts, engineError])

  // Engine tier: what Apply and closing call.
  const applyNow = useCallback(async () => {
    if (!engineReady || engineError) return
    const key = JSON.stringify([currentGraph, previewId])
    const local = compileGraph(currentGraph, previewOpts)
    setApplyState("compiling")
    try {
      const result = await onApplyRef.current(currentGraph, previewOpts)
      setDiagnostics(result.diagnostics)
      setApplyState(result.ok ? "ok" : "error")
      // Recorded even when it FAILED: the engine has been told, and asking it
      // the same failing question again changes nothing. Editing clears it.
      appliedRef.current = key
      setDirty(false)
      pendingRef.current = null
    } catch (e) {
      setDiagnostics([
        ...local.diagnostics,
        { severity: "error", message: `apply failed: ${e instanceof Error ? e.message : e}` },
      ])
      setApplyState("error")
    }
  }, [currentGraph, previewId, previewOpts, engineReady, engineError, setApplyState])
  // ONCE on open, so the canvas behind the panel is the preview from the first
  // frame — the whole premise of editing a look here, and what makes the
  // library's "edit this one" show you the thing you picked. The guard is what
  // makes it once; depending on applyNow only keeps it holding the current
  // graph, and every re-run after the first returns on the first line.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current || !engineReady || engineError) return
    booted.current = true
    void applyNow()
  }, [engineReady, engineError, applyNow])

  // Previewing a node's output is a VIEW command, not an edit — you asked to see
  // something, so it goes now rather than waiting behind Apply.
  const shownPreview = useRef(previewId)
  useEffect(() => {
    if (shownPreview.current === previewId) return
    shownPreview.current = previewId
    void applyNow()
  }, [previewId, applyNow])

  // Every way out applies first. The host's save-on-close compares the group's
  // APPLIED graph against the baseline, so edits left unapplied would not just
  // be unshown — they would be invisible to the prompt and lost without a word.
  const requestClose = async () => {
    if (dirty) await applyNow()
    onClose()
  }
  // Same rule for the ways out this component does not own: Escape closes the
  // panel from outside and the body simply unmounts.
  useEffect(
    () => () => {
      const pending = pendingRef.current
      if (pending) void onApplyRef.current(pending.graph, pending.opts)
    },
    [],
  )

  const errors = diagnostics.filter((d) => d.severity === "error")

  // Mount React Flow only once its host has real dimensions
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
    <div className="flex h-full flex-col" {...undoScope}>
      {/* Header — same language as the pill: slot icon + label, icons for everything else. */}
      {/* The whole header is the window drag surface (buttons still work */}
      <header
        data-drag-handle
        // Solid (opaque, no backdrop)
        className={cn(
          // border-b (not a separate <Separator>) so the divider is part of the solid header's box
          "relative flex shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950 pt-1 pb-1 pr-2 pl-3",
          // Filling the screen, there is nowhere to drag TO — the same rule the
          // shared EditorHeader follows, so the grab cursor never promises a
          // move the panel will refuse.
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
            <TooltipContent>{t.graph.generatedWgsl}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={() => loadGraph(presetGraph)}>
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.graph.resetToPreset}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-zinc-400 hover:text-zinc-100" onClick={exportGraph}>
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.graph.exportJson}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.graph.importJson}</TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Cleared so re-picking the same file after fixing it still fires.
              e.target.value = ""
              if (f) void importGraph(f)
            }}
          />

          {/* ── Apply: hand the graph to the engine ──
              Lit while there is something to hand over, and gone quiet the rest
              of the time. It is the only control here that costs frames, so it
              is the only one that had to become a button rather than a
              consequence of typing. ⌘⏎ does the same thing, matching the WGSL
              editor's Compile. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!dirty || !engineReady}
                onClick={() => void applyNow()}
                className={cn("size-6", dirty ? "text-blue-400 hover:text-blue-300" : "text-zinc-400 hover:text-zinc-100")}
              >
                <Check className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.graph.apply}</TooltipContent>
          </Tooltip>
          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />

          {/* ── Window: fill the screen, then come back ── */}
          {onToggleFullscreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-zinc-400 hover:text-zinc-100"
                  onClick={onToggleFullscreen}
                >
                  {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{fullscreen ? t.graph.exitFullscreen : t.graph.fullscreen}</TooltipContent>
            </Tooltip>
          )}

          {/* ── Exit: close (discard) or save (keep) ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={() => void requestClose()}
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.graph.discardClose}</TooltipContent>
          </Tooltip>
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
                <RenameNodeProvider value={nodeRenameOps}>
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
                </RenameNodeProvider>
              )}

              {previewId && (
                <div className="absolute top-2 right-2 z-10 rounded-md bg-pink-600/90 px-2.5 py-1 text-xs">
                  {t.graph.previewing(previewId)}
                  <button className="ml-2 cursor-pointer underline" onClick={() => setPreviewId(null)}>
                    {t.graph.exit}
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
                  // openNodeMenu guarantees the clicked node is selected
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
                            label: t.graph.rename,
                            onSelect: () => setRenamingId(nodeMenu.nodeId),
                          },
                          {
                            label: t.graph.setAsOutput,
                            checked: isOutput,
                            disabled: isOutput || !hasOutput,
                            onSelect: () => setOutputNode(nodeMenu.nodeId),
                          },
                          {
                            label: isPreview ? t.graph.stopPreview : t.graph.previewOutput,
                            disabled: !hasOutput,
                            onSelect: () => setPreviewId(isPreview ? null : nodeMenu.nodeId),
                          },
                          "separator",
                        ] as (MenuAction | "separator")[])
                      : []),
                    { label: `${t.graph.copy}${plural}`, shortcut: "⌘C", onSelect: () => copyNodes(targets) },
                    { label: `${t.graph.duplicate}${plural}`, shortcut: "⇧D", onSelect: () => duplicateNodes(targets) },
                    { label: t.graph.disconnect, onSelect: () => disconnectNodes(targets) },
                    "separator",
                    { label: `${t.graph.deleteNode}${plural}`, shortcut: "⌫", danger: true, onSelect: () => deleteNodes(targets) },
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
                      label: t.graph.deleteLink,
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
