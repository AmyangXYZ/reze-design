"use client"

// The node-graph editor for one style slot, hosted inside the bottom drawer.
// Ported from the original full-page editor: every edit (rewire, literal change,
// node deletion) recompiles through the engine's graph→WGSL compiler (debounced)
// and hot-swaps the slot's pipeline. Double-click a node to preview its output
// on the model. ⌘/Ctrl+Z undo, ⇧ redo. The page remounts this component per
// slot (key={slot}), so all state here belongs to a single graph.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
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
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { compileGraph, validateGraph, type Diagnostic, type Engine, type StyleGraph } from "reze-engine"
import { ChevronDown, CircleDashed, Code, Download, RotateCcw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { RezeNode } from "@/components/graph/reze-node"
import { WgslView } from "@/components/graph/wgsl-view"
import { SLOT_ICONS } from "@/components/scene/slot-icons"
import { fromFlow, socketsOf, toFlow, type RezeFlowNode } from "@/lib/graph-flow"
import { cn } from "@/lib/utils"

const nodeTypes = { reze: RezeNode }

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
  engineRef,
  engineReady,
  engineError,
  open,
  onClose,
  onGraphChange,
  onApplyStateChange,
}: {
  /** The slot's built-in preset — what Reset returns to. */
  presetGraph: StyleGraph
  /** Lazily resolves what the editor opens with — the preset, or a cached
   *  work-in-progress. Called once on mount (state initializer). */
  getInitialGraph: () => StyleGraph
  slotLabel: string
  engineRef: RefObject<Engine | null>
  engineReady: boolean
  engineError: string | null
  open: boolean
  onClose: () => void
  /** Fires with the rebuilt StyleGraph on every edit — the page caches it per slot. */
  onGraphChange?: (graph: StyleGraph) => void
  /** Mirrors the compile/apply status dot — the page shows it on the collapsed pill. */
  onApplyStateChange?: (state: "ok" | "error" | "compiling") => void
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
  const onConnect = useCallback((conn: Connection) => setEdges((e) => addEdge(conn, e)), [])

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

  // Swap the editor to another graph (import / reset): fresh flow state + history.
  const loadGraph = useCallback((graph: StyleGraph) => {
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

  // ── Preset JSON export/import — the file format IS the StyleGraph schema. ──
  const importFileRef = useRef<HTMLInputElement>(null)
  const onExport = useCallback(() => {
    const graph = fromFlow(base, nodes, edges) // include current edits + layout
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${graph.slot}.graph.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [base, nodes, edges])

  const onImportFile = useCallback(
    async (file: File) => {
      try {
        const graph = JSON.parse(await file.text()) as StyleGraph
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

  const currentGraph: StyleGraph = useMemo(() => fromFlow(base, nodes, edges), [base, nodes, edges])

  const onGraphChangeRef = useRef(onGraphChange)
  useEffect(() => {
    onGraphChangeRef.current = onGraphChange
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
      const engine = engineRef.current
      // Before the GPU device is up, applying would explode — engineReady is in
      // the deps, so the pending graph re-applies the moment boot completes.
      if (!engine || !engineReady) {
        setDiagnostics(local.diagnostics)
        return
      }
      setApplyState("compiling")
      try {
        const result = await engine.applyStyleGraph(currentGraph, opts)
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
  const HeaderIcon = SLOT_ICONS[base.slot] ?? CircleDashed

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
      <header className="flex pt-1 shrink-0 items-center gap-2 pr-2 pl-3.5">
        <HeaderIcon
          className={cn(
            "size-3.5",
            applyState === "error" ? "text-red-400" : "text-zinc-400",
            applyState === "compiling" && "animate-pulse",
          )}
        />
        <span className="text-xs font-medium text-zinc-200">{slotLabel}</span>
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6",
                  showWgsl ? "text-pink-300 hover:text-pink-200" : "text-zinc-400 hover:text-zinc-100",
                )}
                onClick={() => setShowWgsl((v) => !v)}
              >
                <Code className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Generated WGSL</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={() => loadGraph(presetGraph)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to preset</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={onExport}
              >
                <Download className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export graph JSON</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={() => importFileRef.current?.click()}
              >
                <Upload className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import graph JSON</TooltipContent>
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
          <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-zinc-400 hover:text-zinc-100"
                onClick={onClose}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Minimize</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <Separator className="bg-white/5" />

      {/* ── Graph canvas + optional WGSL pane ── */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="70" minSize="40">
            <div ref={flowHostRef} className="relative h-full">
              {flowSized && (
                <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnectStart={onReconnectStart}
                onReconnect={onReconnect}
                onReconnectEnd={onReconnectEnd}
                onNodeDoubleClick={(_, n) => setPreviewId((prev) => (prev === n.id ? null : n.id))}
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
            </div>
          </ResizablePanel>
          {showWgsl && (
            <>
              <ResizableHandle className="bg-white/5" />
              <ResizablePanel defaultSize="30" minSize="15">
                <div className="flex h-full flex-col">
                  <h3 className="shrink-0 border-b border-white/5 px-3 py-1.5 text-xs tracking-wide text-zinc-500 uppercase">
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
