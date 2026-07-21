"use client"

// Node graph test page: React Flow editor + live engine preview + generated WGSL.
// The hair style graph loads as data; every edit (rewire, literal change on the
// node cards, node deletion) recompiles through the engine's graph→WGSL compiler
// (debounced) and hot-swaps the hair slot's pipeline. Double-click a node to
// preview its output on the model (Blender viewer-node workflow). ⌘/Ctrl+Z undo,
// ⌘/Ctrl+Shift+Z redo. Panels are resizable.

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
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  BODY_GRAPH,
  CLOTH_ROUGH_GRAPH,
  CLOTH_SMOOTH_GRAPH,
  DEFAULT_GRAPH,
  Engine,
  HAIR_GRAPH,
  METAL_GRAPH,
  STOCKINGS_GRAPH,
  Vec3,
  compileGraph,
  validateGraph,
  type Diagnostic,
  type StyleGraph,
} from "reze-engine"
import { Download, RotateCcw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RezeNode } from "@/components/graph/reze-node"
import { WgslView } from "@/components/graph/wgsl-view"
import { fromFlow, socketsOf, toFlow, type RezeFlowNode } from "@/lib/graph-flow"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

const nodeTypes = { reze: RezeNode }

// Graph presets ported so far — each targets its own slot, so styling one doesn't
// unstyle another (applied slots stay live while you edit the next).
const PRESETS: Record<string, StyleGraph> = {
  hair: HAIR_GRAPH,
  body: BODY_GRAPH,
  cloth_smooth: CLOTH_SMOOTH_GRAPH,
  cloth_rough: CLOTH_ROUGH_GRAPH,
  stockings: STOCKINGS_GRAPH,
  metal: METAL_GRAPH,
  default: DEFAULT_GRAPH,
}

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

const MODEL_ID = "serqet"
const MODEL_PRESETS = {
  eye: ["眼睛", "眼白", "目白", "右瞳", "左瞳", "眉毛"],
  face: ["脸", "face01"],
  body: ["皮肤", "skin"],
  hair: ["头发", "hair_f"],
  cloth_smooth: [
    "衣服", "裙子", "裙带", "裙布", "外套", "外套饰", "裤子", "裤子0", "腿环", "发饰",
    "鞋子", "鞋子饰", "shirt", "shoes", "shorts", "trigger", "dress", "hair_accessory", "cloth01_shoes",
  ],
  stockings: ["袜子", "stockings"],
  metal: ["metal01", "earring"],
}

export default function GraphPage() {
  const [presetKey, setPresetKey] = useState("hair")
  const [importedGraph, setImportedGraph] = useState<StyleGraph | null>(null)
  const baseGraph = presetKey === "imported" && importedGraph ? importedGraph : (PRESETS[presetKey] ?? HAIR_GRAPH)
  const initial = useMemo(() => toFlow(HAIR_GRAPH), [])
  const [nodes, setNodes] = useState<RezeFlowNode[]>(initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(initial.edges)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [fsBody, setFsBody] = useState("")
  const [applyState, setApplyState] = useState<"ok" | "error" | "compiling">("compiling")

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)

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
  }, [undo, redo])

  // ── Engine bootstrap — static posed model, no animation playback. ──
  useEffect(() => {
    let disposed = false
    const boot = async () => {
      if (!canvasRef.current) return
      try {
        const engine = new Engine(canvasRef.current, {
          camera: { distance: 24, target: new Vec3(0, 12.5, 0) },
        })
        engineRef.current = engine
        await engine.init()
        if (disposed) return
        await engine.loadModel(MODEL_ID, "/models/塞尔凯特/塞尔凯特.pmx")
        engine.setMaterialPresets(MODEL_ID, MODEL_PRESETS)
        engine.addGround({ diffuseColor: new Vec3(0.75, 0.75, 0.8) })
        // No animation on this page — bind pose loads faster and material
        // evaluation doesn't need motion.
        engine.runRenderLoop()
        setEngineReady(true)
        setEngineError(null)
      } catch (e) {
        setEngineError(e instanceof Error ? e.message : String(e))
      }
    }
    void boot()
    return () => {
      disposed = true
      engineRef.current?.dispose?.()
      engineRef.current = null
    }
  }, [])

  // Switch the editor to another graph: fresh flow state + fresh history; the
  // previous slot's applied style stays live on the model.
  const loadGraph = useCallback((key: string, graph: StyleGraph) => {
    const flow = toFlow(graph)
    setPresetKey(key)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setPreviewId(null)
    past.current = []
    future.current = []
    present.current = { nodes: flow.nodes, edges: flow.edges }
    restoring.current = true // the state swap itself is not an undo step
  }, [])

  const loadPreset = useCallback(
    (key: string) => {
      const graph = key === "imported" ? importedGraph : PRESETS[key]
      if (graph) loadGraph(key, graph)
    },
    [importedGraph, loadGraph],
  )

  // ── Preset JSON export/import — the file format IS the StyleGraph schema
  //    (what reze.design will store and share). ──
  const importFileRef = useRef<HTMLInputElement>(null)
  const onExport = useCallback(() => {
    const graph = fromFlow(baseGraph, nodes, edges) // include current edits + layout
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${graph.slot}.graph.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [baseGraph, nodes, edges])

  const onImportFile = useCallback(
    async (file: File) => {
      try {
        const graph = JSON.parse(await file.text()) as StyleGraph
        const diags = validateGraph(graph)
        if (diags.some((d) => d.severity === "error")) {
          setDiagnostics(diags)
          return
        }
        setImportedGraph(graph)
        loadGraph("imported", graph)
      } catch (e) {
        setDiagnostics([{ severity: "error", message: `import failed: ${e instanceof Error ? e.message : e}` }])
      }
    },
    [loadGraph],
  )

  const currentGraph: StyleGraph = useMemo(() => fromFlow(baseGraph, nodes, edges), [baseGraph, nodes, edges])

  // ── Topology tier: debounce → compile locally for the panels → apply to engine. ──
  useEffect(() => {
    if (engineError) return
    const engine = engineRef.current
    const opts = previewId
      ? {
          previewNode: {
            node: previewId,
            socket: socketsOf(nodes.find((n) => n.id === previewId)?.data.graphNode.type ?? "")?.outputs[0]?.[0] ?? "color",
          },
        }
      : undefined
    const timer = setTimeout(async () => {
      const local = compileGraph(currentGraph, opts)
      setFsBody(local.fsBody)
      if (!engine) {
        setDiagnostics(local.diagnostics)
        return
      }
      setApplyState("compiling")
      const result = await engine.applyStyleGraph(currentGraph, opts)
      setDiagnostics(result.diagnostics)
      setApplyState(result.ok ? "ok" : "error")
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGraph, previewId, engineReady, engineError])

  const errors = diagnostics.filter((d) => d.severity === "error")

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-200 text-sm select-none">
      <ResizablePanelGroup orientation="horizontal">
        {/* ── Node editor ── */}
        <ResizablePanel defaultSize="64" minSize="30">
          <div className="relative h-full">
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
              defaultViewport={{ x: 32, y: 48, zoom: 0.8 }}
              minZoom={0.2}
            >
              <Background gap={24} />
              <Controls />
              <MiniMap pannable zoomable style={{ width: 140, height: 92 }} />
            </ReactFlow>

            <div className="absolute top-3 left-3 z-10 px-2.5 py-2 rounded-md bg-zinc-900/90 border border-zinc-700">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">
                Reze Design <span className="text-pink-400/80">·</span> graph editor
              </div>
              <div className="flex items-center gap-2.5">
                <Select value={presetKey} onValueChange={loadPreset}>
                  <SelectTrigger className="h-7 w-56 border-zinc-700 bg-zinc-900 text-xs" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    sideOffset={4}
                    className="border-zinc-700 bg-zinc-900 text-zinc-200"
                  >
                    {Object.entries(PRESETS).map(([key, g]) => (
                      <SelectItem key={key} value={key} className="text-xs">
                        {g.name}
                        <span className="text-zinc-500">· slot: {g.slot}</span>
                      </SelectItem>
                    ))}
                    {importedGraph && (
                      <SelectItem value="imported" className="text-xs">
                        {importedGraph.name}
                        <span className="text-zinc-500">· imported · slot: {importedGraph.slot}</span>
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    applyState === "ok"
                      ? "bg-emerald-400"
                      : applyState === "error"
                        ? "bg-red-400"
                        : "bg-amber-400 animate-pulse"
                  }`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
                  title="Reset graph to preset"
                  onClick={() => loadPreset(presetKey)}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
                  title="Export graph JSON"
                  onClick={onExport}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
                  title="Import graph JSON"
                  onClick={() => importFileRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                </Button>
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
              </div>
              <div className="text-[11px] text-zinc-500 mt-1.5">
                double-click node = preview its output · ⌘/Ctrl+Z undo · ⇧ redo
              </div>
            </div>

            {previewId && (
              <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-md bg-pink-600/90 text-xs">
                previewing “{previewId}”
                <button className="ml-2 underline cursor-pointer" onClick={() => setPreviewId(null)}>
                  exit
                </button>
              </div>
            )}

            {diagnostics.length > 0 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 max-w-[70%] px-3 py-2 rounded-md bg-zinc-900/95 border border-zinc-700 text-xs space-y-0.5">
                {errors.length > 0 && (
                  <div className="text-red-400 font-medium">{errors.length} error(s) — previous look kept</div>
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

        <ResizableHandle withHandle className="bg-zinc-800" />

        {/* ── Preview + WGSL ── */}
        <ResizablePanel defaultSize="36" minSize="20">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="55" minSize="20">
              <div className="relative h-full bg-zinc-900">
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />
                {!engineReady && !engineError && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 text-zinc-500 text-xs">
                    <span className="inline-block w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
                    loading model…
                  </div>
                )}
                {engineError && (
                  <div className="absolute inset-0 flex items-center justify-center p-4 text-red-400 text-xs">
                    Engine: {engineError}
                  </div>
                )}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-zinc-800" />
            <ResizablePanel defaultSize="45" minSize="15">
              <div className="h-full flex flex-col">
                <h3 className="shrink-0 px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                  Generated WGSL (fs body)
                </h3>
                <div className="flex-1 overflow-auto select-text cursor-text">
                  {fsBody ? <WgslView code={fsBody} /> : <p className="p-3 text-zinc-600">—</p>}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
