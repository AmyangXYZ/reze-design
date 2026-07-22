"use client"

// Immersive scene page: the WebGPU viewport is the page, everything else floats
// over it. Left: glass sidebar, material-led — each material carries a slot-
// assignment chip (mapping is per-model; styling is per-slot). Bottom: the node
// editor collapses Aloha-style into a status pill; the full drawer is kept
// mounted while minimized so edits, undo history, and the live compile survive.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  parsePmxFolderInput,
  pmxFileAtRelativePath,
  type MaterialPreset,
  type MaterialPresetMap,
  type StyleGraph,
} from "reze-engine"
import { CircleDashed, SlidersHorizontal, X } from "lucide-react"
import { GithubMark } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GraphEditor } from "@/components/graph/graph-editor"
import { AnimPlayer } from "@/components/scene/anim-player"
import { MaterialSidebar } from "@/components/scene/material-sidebar"
import { SceneSidebar } from "@/components/scene/scene-sidebar"
import { useEngine } from "@/hooks/use-engine"
import { MaterialSphereIcon, SLOT_ICONS } from "@/components/scene/slot-icons"
import { MODEL_ID, SLOT_GRAPHS, SLOT_LABELS, slotOfMaterial } from "@/lib/materials"
import {
  azElToDirection,
  hexToLinearVec3,
  loadSceneSettings,
  saveSceneSettings,
  type SceneSettings,
} from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

const UI_KEY = "reze-design.ui.v1"
function loadUiState(): { left: boolean; right: boolean } {
  if (typeof window === "undefined") return { left: true, right: false }
  try {
    const raw = window.localStorage.getItem(UI_KEY)
    return { left: true, right: false, ...(raw ? (JSON.parse(raw) as Partial<{ left: boolean; right: boolean }>) : {}) }
  } catch {
    return { left: true, right: false }
  }
}
function saveUiState(state: { left: boolean; right: boolean }) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(state))
  } catch {
    // non-fatal
  }
}

export default function Home() {
  const [selected, setSelected] = useState<string | null>(null)
  const [activeSlot, setActiveSlot] = useState<MaterialPreset>("hair")
  // Material → slot mapping: the demo model's curated map, plus user overrides.
  const [slotOverrides, setSlotOverrides] = useState<Record<string, MaterialPreset | null>>({})
  // Sidebar open state persists; first visit = materials open, scene closed.
  // Panels render only after mount (see `mounted`), so reading localStorage in
  // the initializer can't cause a hydration mismatch.
  const [sidebarOpen, setSidebarOpen] = useState(() => loadUiState().left)
  const [rightOpen, setRightOpen] = useState(() => loadUiState().right)
  // Gates everything whose SSR output could differ from the client (stored
  // settings text, stored open states). The canvas itself always renders.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (mounted) saveUiState({ left: sidebarOpen, right: rightOpen })
  }, [mounted, sidebarOpen, rightOpen])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerH, setDrawerH] = useState(380)
  const [applyStatus, setApplyStatus] = useState<"ok" | "error" | "compiling">("compiling")
  const [animName, setAnimName] = useState<string | null>(null)
  // Read stored settings synchronously (SSR-safe: falls back to defaults) so
  // the page background AND the engine boot (world/sun/bloom/ground) already
  // match the user's config — no default flash on first paint.
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(() => loadSceneSettings())

  // The engine hook needs a pick handler at construction; route through a ref
  // (synced in an effect) so the handler can use everything defined below.
  const pickRef = useRef<(material: string | null) => void>(() => {})
  const {
    canvasRef,
    engineRef,
    ready,
    error,
    materials,
    modelName,
    highlight,
    toggleVisible,
    loadFromFiles,
    loadVmdFile,
    stopAnimation,
  } = useEngine((m) => pickRef.current(m), sceneSettings)

  // The curated map only covers the demo model; an uploaded model starts unset
  // (the engine still auto-resolves by name hints internally) until the user
  // assigns slots here.
  const isCustomModel = modelName !== MODEL_ID
  const assignments = useMemo<Record<string, MaterialPreset | null>>(
    () =>
      Object.fromEntries(
        materials.map((m) => [
          m.name,
          m.name in slotOverrides ? slotOverrides[m.name] : isCustomModel ? null : slotOfMaterial(m.name),
        ]),
      ),
    [materials, slotOverrides, isCustomModel],
  )

  const pick = (material: string | null) => {
    setSelected(material)
    highlight(material)
    if (!material) return // clicked empty space — deselect, keep the editor
    const slot = assignments[material]
    if (slot) setActiveSlot(slot)
  }
  useEffect(() => {
    pickRef.current = pick
  })

  // Per-slot edit cache: switching slots remounts the editor (key={slot}),
  // this keeps each slot's work-in-progress instead of resetting to the preset.
  const edited = useRef(new Map<MaterialPreset, StyleGraph>())

  // Reassign a material to a slot. setMaterialPresets is live — the engine
  // re-resolves every draw call and rebinds style buffers immediately.
  const assign = (name: string, slot: MaterialPreset | null) => {
    const next = { ...assignments, [name]: slot }
    setSlotOverrides((prev) => ({ ...prev, [name]: slot }))
    const engine = engineRef.current
    if (engine) {
      const map: MaterialPresetMap = {}
      for (const [mat, s] of Object.entries(next)) {
        if (s) (map[s] ??= []).push(mat)
      }
      engine.setMaterialPresets(modelName, map)
    }
    if (slot && slot in SLOT_GRAPHS) {
      setActiveSlot(slot)
      // Sync the slot's pipeline with the editor's cached graph so the moved
      // material shows current edits, not a stale preset.
      const graph = edited.current.get(slot) ?? SLOT_GRAPHS[slot]
      if (graph && ready) void engine?.applyStyleGraph(graph).catch(() => {})
    }
  }

  // ── "Use your own" model upload: pick a folder, resolve its PMX (or ask
  // which one when several exist), swap the model in. ──
  type UploadState = { kind: "pick"; files: File[]; paths: string[] } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const loadCustom = async (files: File[], pmxFile: File) => {
    setUpload(null)
    setSelected(null)
    setSlotOverrides({}) // stale overrides must not leak onto the new model's materials
    setAnimName(null) // the new model starts in bind pose
    await loadFromFiles(files, pmxFile)
  }

  // ── VMD animation upload ──
  const vmdInputRef = useRef<HTMLInputElement | null>(null)
  const onVmdPicked = async (file: File | undefined) => {
    if (!file) return
    setAnimName(await loadVmdFile(file))
  }
  const onFolderPicked = (fileList: FileList | null) => {
    const result = parsePmxFolderInput(fileList)
    if (result.status === "single") void loadCustom(result.files, result.pmxFile)
    else if (result.status === "multiple")
      setUpload({ kind: "pick", files: result.files, paths: result.pmxRelativePaths })
    else if (result.status === "no_pmx") setUpload({ kind: "notice", message: "No .pmx file found in that folder." })
    else if (result.status === "not_directory")
      setUpload({ kind: "notice", message: "Please pick the model's folder itself, textures included." })
  }

  // ── Scene settings: persist + push to engine on change. World/sun/bloom are
  // cheap uniform writes; the ground only rebuilds when its colors changed. ──
  const prevGround = useRef<{ ground: string; grid: string } | null>(null)
  useEffect(() => {
    saveSceneSettings(sceneSettings)
    if (!ready) return
    const engine = engineRef.current
    if (!engine) return
    const { world, sun, bloom, colors } = sceneSettings
    engine.setWorld({ color: hexToLinearVec3(world.color), strength: world.strength })
    engine.setSun({
      color: hexToLinearVec3(sun.color),
      strength: sun.strength,
      direction: azElToDirection(sun.azimuth, sun.elevation),
    })
    engine.setBloomOptions({
      enabled: bloom.enabled,
      threshold: bloom.threshold,
      knee: bloom.knee,
      radius: bloom.radius,
      intensity: bloom.intensity,
      color: hexToLinearVec3(bloom.color),
    })
    if (prevGround.current?.ground !== colors.ground || prevGround.current?.grid !== colors.grid) {
      // addGround fully rebuilds — re-calling it is the color-update path.
      engine.addGround({ diffuseColor: hexToLinearVec3(colors.ground), gridLineColor: hexToLinearVec3(colors.grid) })
      prevGround.current = { ground: colors.ground, grid: colors.grid }
    }
  }, [sceneSettings, ready, engineRef])

  // ── Drawer drag-resize. Geometry transitions are suspended while dragging so
  // the height tracks the pointer 1:1 instead of springing after it. ──
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, h: drawerH }
    setResizing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    const next = dragStart.current.h + (dragStart.current.y - e.clientY)
    setDrawerH(Math.min(Math.max(next, 220), window.innerHeight - 160))
  }
  const onDragUp = () => {
    dragStart.current = null
    setResizing(false)
  }

  // The pill's intrinsic width — the morph container needs numeric sizes to
  // animate between, so measure the pill content.
  const pillInnerRef = useRef<HTMLDivElement>(null)
  const [pillW, setPillW] = useState(240)
  useEffect(() => {
    const el = pillInnerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPillW(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const presetGraph = SLOT_GRAPHS[activeSlot]
  // Pill leads with the slot's icon (same language as the sidebar); it only
  // changes color on a real compile error instead of flashing per keystroke.
  const PillIcon = SLOT_ICONS[activeSlot] ?? CircleDashed

  return (
    <div
      className="fixed inset-0 overflow-hidden text-sm text-zinc-200 select-none"
      style={{ backgroundColor: sceneSettings.colors.background }}
      // Static prerender renders the default background; the client renders the
      // stored one. Intentional — suppress the style-attr mismatch warning.
      suppressHydrationWarning
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/60 px-4 py-2 text-xs text-zinc-400 backdrop-blur-sm">
            <span className="size-2 animate-pulse rounded-full bg-pink-400" />
            loading model…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-2xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-xs text-red-400 backdrop-blur-xl">
            Engine: {error}
          </div>
        </div>
      )}

      {/* ── Top edge: brand bar (top-left) and scene-tools toggle (top-right),
          lifted to the very top; the panels below share one y. ── */}
      <div className="absolute top-2 left-4 z-10 flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/60 py-1 pr-1.5 pl-3 shadow-2xl backdrop-blur-sm">
        <span className="text-sm font-semibold tracking-tight text-zinc-100">Reze Design</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="size-6 text-zinc-500 hover:text-zinc-200">
              <a href="https://github.com/AmyangXYZ/reze-design" target="_blank" rel="noreferrer">
                <GithubMark className="size-4" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">GitHub</TooltipContent>
        </Tooltip>
      </div>
      {/* ── Left column: materials panel. pointer-events-none on the column so
          its empty regions never block camera orbit; each surface re-enables
          them. Bottom follows the drawer with the drawer's easing. ── */}
      {mounted && (
      <div
        className={cn(
          "pointer-events-none absolute top-14 left-4 z-10 flex flex-col items-start transition-[bottom] duration-[420ms]",
          // Match the drawer: decelerate cleanly when it expands, spring when it collapses.
          drawerOpen ? "ease-out-soft" : "ease-spring",
          resizing && "transition-none",
        )}
        style={{ bottom: drawerOpen ? drawerH + 28 : 16 }}
      >
        {/* Panel ⇄ icon-button morph: both stay mounted in the same grid cell
            (scroll position survives), scale/fade swapping from a shared
            top-left origin. */}
        <div className="grid min-h-0">
          <div
            className={cn(
              "flex min-h-0 origin-top-left transition-[scale,opacity] duration-300 ease-spring [grid-area:1/1]",
              sidebarOpen ? "pointer-events-auto" : "pointer-events-none scale-90 opacity-0",
            )}
          >
            <MaterialSidebar
              materials={materials}
              assignments={assignments}
              selected={selected}
              activeSlot={activeSlot}
              onSelect={pick}
              onHover={(name) => highlight(name ?? selected)}
              onAssign={assign}
              onToggleVisible={toggleVisible}
              onCollapse={() => setSidebarOpen(false)}
            />
          </div>
          <div
            className={cn(
              "origin-top-left transition-[scale,opacity] duration-300 ease-spring [grid-area:1/1]",
              sidebarOpen ? "pointer-events-none scale-[2] opacity-0" : "pointer-events-auto",
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-xl border border-white/10 bg-zinc-950/60 text-zinc-400 shadow-2xl backdrop-blur-sm hover:bg-zinc-900/80 hover:text-zinc-100"
                  onClick={() => setSidebarOpen(true)}
                >
                  <MaterialSphereIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Materials</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      )}

      {/* ── Right column: scene sidebar (Figma-style — same y as the left
          panel, collapsible to an icon button). ── */}
      {mounted && (
      <div
        className={cn(
          "pointer-events-none absolute top-14 right-4 z-10 flex flex-col items-end transition-[bottom] duration-[420ms]",
          drawerOpen ? "ease-out-soft" : "ease-spring",
          resizing && "transition-none",
        )}
        style={{ bottom: drawerOpen ? drawerH + 28 : 16 }}
      >
        <div className="grid min-h-0 justify-items-end">
          <div
            className={cn(
              "flex min-h-0 origin-top-right transition-[scale,opacity] duration-300 ease-spring [grid-area:1/1]",
              rightOpen ? "pointer-events-auto" : "pointer-events-none scale-90 opacity-0",
            )}
          >
            <SceneSidebar
              settings={sceneSettings}
              onChange={setSceneSettings}
              onCollapse={() => setRightOpen(false)}
              onUploadModel={() => folderInputRef.current?.click()}
              onUploadAnimation={() => vmdInputRef.current?.click()}
              player={
                animName ? (
                  <AnimPlayer
                    engineRef={engineRef}
                    modelName={modelName}
                    clipName={animName}
                    onStop={() => {
                      stopAnimation()
                      setAnimName(null)
                    }}
                  />
                ) : null
              }
            />
          </div>
          <div
            className={cn(
              "origin-top-right transition-[scale,opacity] duration-300 ease-spring [grid-area:1/1]",
              rightOpen ? "pointer-events-none scale-[2] opacity-0" : "pointer-events-auto",
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-xl border border-white/10 bg-zinc-950/60 text-zinc-400 shadow-2xl backdrop-blur-sm hover:bg-zinc-900/80 hover:text-zinc-100"
                  onClick={() => setRightOpen(true)}
                >
                  <SlidersHorizontal className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Scene</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
      )}

      {/* ── Node editor: ONE surface that morphs between pill and drawer.
          The container animates its real geometry (width/height/radius) with a
          spring; the drawer content sits at fixed size anchored bottom-center,
          so the shrinking container clips it (iOS-sheet style) instead of
          squishing it. Content layers crossfade with a slight stagger. ── */}
      <div
        className={cn(
          "absolute bottom-3 left-1/2 z-20 -translate-x-1/2 overflow-hidden border border-white/10 bg-zinc-950/60 shadow-2xl backdrop-blur-sm",
          "transition-[width,height,border-radius,scale] duration-[420ms]",
          // Expanding overshoot looks wrong on a big sheet — decelerate cleanly
          // up, but keep the springy settle when snapping back into the pill.
          drawerOpen ? "ease-out-soft" : "ease-spring",
          !drawerOpen && "cursor-pointer hover:scale-[1.04] active:scale-[0.97]",
          resizing && "transition-none",
        )}
        style={{
          // +2: the container's own border, which border-box takes from content.
          width: drawerOpen ? "calc(100vw - 24px)" : pillW + 2,
          height: drawerOpen ? drawerH : 34,
          borderRadius: drawerOpen ? 16 : 17,
        }}
        onClick={drawerOpen ? undefined : () => setDrawerOpen(true)}
      >
        {/* Drawer layer — fixed drawer geometry, clipped while the pill is small. */}
        <div
          className={cn(
            "absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col transition-opacity duration-200 ease-out-soft",
            drawerOpen ? "opacity-100 delay-100" : "pointer-events-none opacity-0",
          )}
          style={{ width: "calc(100vw - 24px)", height: drawerH }}
        >
          {/* Resize grip overlays the top edge (no layout space), so the editor
              header sits vertically centered in the drawer's top strip. */}
          <div
            className="absolute inset-x-0 top-0 z-10 flex h-2 cursor-row-resize touch-none items-start justify-center pt-[3px]"
            onPointerDown={onDragDown}
            onPointerMove={onDragMove}
            onPointerUp={onDragUp}
          >
            <span className="h-0.5 w-10 rounded-full bg-white/15" />
          </div>
          {presetGraph ? (
            <GraphEditor
              key={activeSlot}
              slotLabel={SLOT_LABELS[activeSlot]}
              presetGraph={presetGraph}
              getInitialGraph={() => edited.current.get(activeSlot) ?? presetGraph}
              onGraphChange={(g) => edited.current.set(activeSlot, g)}
              onApplyStateChange={setApplyStatus}
              engineRef={engineRef}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
            />
          ) : (
            <div className="relative flex flex-1 items-center justify-center text-xs text-zinc-500">
              {SLOT_LABELS[activeSlot]} uses a built-in shader — no editable graph for this slot yet
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-2 size-7 text-zinc-500 hover:text-zinc-200"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Pill layer — the editor's "address bar"; its measured width drives
            the container's collapsed geometry. */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out-soft",
            drawerOpen ? "pointer-events-none opacity-0" : "opacity-100 delay-150",
          )}
        >
          <div ref={pillInnerRef} className="flex items-center gap-2 px-4 whitespace-nowrap">
            <PillIcon
              className={cn(
                "size-3.5",
                presetGraph && applyStatus === "error" ? "text-red-400" : "text-zinc-400",
                presetGraph && applyStatus === "compiling" && "animate-pulse",
              )}
            />
            <span className="text-xs font-medium text-zinc-200">{SLOT_LABELS[activeSlot]}</span>
          </div>
        </div>
      </div>

      {/* ── Uploads: hidden folder + VMD inputs, PMX picker dialog ── */}
      <input
        ref={(el) => {
          folderInputRef.current = el
          el?.setAttribute("webkitdirectory", "")
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFolderPicked(e.target.files)
          e.target.value = ""
        }}
      />
      <input
        ref={vmdInputRef}
        type="file"
        accept=".vmd"
        className="hidden"
        onChange={(e) => {
          void onVmdPicked(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <Dialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)}>
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-zinc-950/90 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-200">
              {upload?.kind === "pick" ? "Multiple models found — pick one" : "Can't load that folder"}
            </DialogTitle>
          </DialogHeader>
          {upload?.kind === "pick" ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {upload.paths.map((path) => (
                <button
                  key={path}
                  className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition-colors hover:bg-white/5 hover:text-zinc-100"
                  onClick={() => {
                    const pmx = pmxFileAtRelativePath(upload.files, path)
                    if (pmx) void loadCustom(upload.files, pmx)
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-400">{upload?.kind === "notice" ? upload.message : null}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
