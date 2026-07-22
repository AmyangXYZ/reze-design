"use client"

// Immersive editor (home). The WebGPU viewport is the page; a Figma-style shell
// floats over it: top-left brand pill + top-right account/play/share cluster
// stay put, while TWO docks — left (Materials / Scene / Assets via an icon rail)
// and right (Properties / Render tabs) — collapse together behind the brand
// pill's single toggle. The node-graph editor lives in a bottom drawer, narrowed
// to sit between the docks, and collapses on its own into a status pill.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  parsePmxFolderInput,
  pmxFileAtRelativePath,
  type MaterialPreset,
  type MaterialPresetMap,
  type StyleGraph,
} from "reze-engine"
import { Clapperboard, Package, Sun, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { GraphEditor } from "@/components/graph/graph-editor"
import { AnimPlayer } from "@/components/scene/anim-player"
import { MaterialsPanel } from "@/components/scene/material-sidebar"
import { ScenePanel } from "@/components/scene/scene-sidebar"
import { AssetsPanel } from "@/components/editor/assets-panel"
import { BrandPill, RailLogo, TopRightCluster } from "@/components/editor/editor-chrome"
import { LeftDock, RightDock, type DockTab } from "@/components/editor/dock"
import { NodeLibrary } from "@/components/editor/node-library"
import { RenderPanel } from "@/components/editor/render-panel"
import { useEngine } from "@/hooks/use-engine"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { MODEL_ID, SLOT_GRAPHS, SLOT_LABELS, SLOT_ORDER, slotOfMaterial } from "@/lib/materials"
import {
  azElToDirection,
  hexToLinearVec3,
  loadSceneSettings,
  saveSceneSettings,
  type SceneSettings,
} from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

// Bundled defaults so a first-open scene is a complete "MMD" — the model dances
// on load; audio joins on the first user interaction (browser autoplay policy).
// Paths are %20-encoded (the filenames contain a space).
const DEFAULT_ANIM = { name: "IRIS OUT.vmd", url: "/animations/IRIS%20OUT.vmd" }
const DEFAULT_AUDIO = { name: "IRIS OUT.wav", url: "/audios/IRIS%20OUT.wav" }

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const fmtDur = (s: number) => {
  if (!s || !isFinite(s)) return ""
  return `${Math.floor(s / 60)}:${Math.round(s % 60)
    .toString()
    .padStart(2, "0")}`
}

const UI_KEY = "reze-design.ui"
function loadUiState(): { docks: boolean; leftTab: string; rightTab: string } {
  const def = { docks: true, leftTab: "materials", rightTab: "assets" }
  if (typeof window === "undefined") return def
  try {
    const raw = window.localStorage.getItem(UI_KEY)
    return { ...def, ...(raw ? (JSON.parse(raw) as Partial<typeof def>) : {}) }
  } catch {
    return def
  }
}
function saveUiState(state: { docks: boolean; leftTab: string; rightTab: string }) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(state))
  } catch {
    // non-fatal
  }
}

export default function Home() {
  const [selected, setSelected] = useState<string | null>(null)
  const [activeSlot, setActiveSlot] = useState<MaterialPreset>("hair")
  // Whether we've defaulted the editor slot for the current model yet (see below).
  const [slotInited, setSlotInited] = useState(false)
  // Node-graph library popup + the display name of the graph applied per role.
  const [library, setLibrary] = useState<{ open: boolean; role: MaterialPreset | null; material: string | null }>({
    open: false,
    role: null,
    material: null,
  })
  const [slotGraphName, setSlotGraphName] = useState<Partial<Record<MaterialPreset, string>>>({})
  // Bumped on library-pick to remount the graph editor with the new graph.
  const [libVersion, setLibVersion] = useState(0)
  // Material → slot mapping: the demo model's curated map, plus user overrides.
  const [slotOverrides, setSlotOverrides] = useState<Record<string, MaterialPreset | null>>({})

  // Dock + tab state persists; panels render only after mount (see `mounted`),
  // so reading localStorage in the initializer can't cause a hydration mismatch.
  const [docksOpen, setDocksOpen] = useState(() => loadUiState().docks)
  const [leftTab, setLeftTab] = useState(() => loadUiState().leftTab)
  const [rightTab, setRightTab] = useState(() => loadUiState().rightTab)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (mounted) saveUiState({ docks: docksOpen, leftTab, rightTab })
  }, [mounted, docksOpen, leftTab, rightTab])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerH, setDrawerH] = useState(380)
  const [animName, setAnimName] = useState<string | null>(null)
  // Read stored settings synchronously (SSR-safe: falls back to defaults) so the
  // page background AND the engine boot already match the user's config.
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
    modelFile,
    modelStats,
    highlight,
    toggleVisible,
    loadFromFiles,
    loadVmdFile,
    loadVmdUrl,
    stopAnimation,
  } = useEngine((m) => pickRef.current(m), sceneSettings)

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

  // Highlight follows selection only while the Materials tab is active — leaving
  // it clears the on-model highlight so styling other panels isn't visually noisy.
  useEffect(() => {
    highlight(leftTab === "materials" ? selected : null)
  }, [leftTab, selected, highlight])

  // Default the node-graph slot to the first material that actually HAS an
  // editable graph (instead of a hard-coded slot), so the bottom pill reflects
  // the loaded model. Set during render, guarded so it runs once per model —
  // React's recommended alternative to a syncing effect. Reset on upload.
  if (!slotInited && materials.length > 0) {
    const firstEditable = materials.map((m) => assignments[m.name]).find((s) => s && s in SLOT_GRAPHS)
    if (firstEditable) {
      setActiveSlot(firstEditable)
      setSlotInited(true)
    }
  }

  // Per-slot edit cache: switching slots remounts the editor (key={slot}), this
  // keeps each slot's work-in-progress instead of resetting to the preset.
  const edited = useRef(new Map<MaterialPreset, StyleGraph>())

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
      const graph = edited.current.get(slot) ?? SLOT_GRAPHS[slot]
      if (graph && ready) void engine?.applyStyleGraph(graph).catch(() => {})
    }
  }

  // Apply a library look. By default it targets the material's whole role group
  // (the engine shades per role). Opting out of "apply to similar" moves just
  // this material to a free slot so only it changes — a free slot may not exist
  // (≤9 roles), in which case we fall back to the group.
  const applyLibrary = (graph: StyleGraph, name: string, applyToSimilar: boolean) => {
    const { role, material } = library
    if (!role) return

    let targetSlot = role
    if (!applyToSimilar && material) {
      const usedByOthers = new Set(
        Object.entries(assignments)
          .filter(([m]) => m !== material)
          .map(([, s]) => s),
      )
      const free = SLOT_ORDER.find((s) => s in SLOT_GRAPHS && !usedByOthers.has(s))
      if (free) {
        targetSlot = free
        const next = { ...assignments, [material]: free }
        setSlotOverrides((prev) => ({ ...prev, [material]: free }))
        const engine = engineRef.current
        if (engine) {
          const map: MaterialPresetMap = {}
          for (const [mat, s] of Object.entries(next)) if (s) (map[s] ??= []).push(mat)
          engine.setMaterialPresets(modelName, map)
        }
      }
    }

    const retargeted: StyleGraph = { ...graph, slot: targetSlot }
    edited.current.set(targetSlot, retargeted)
    setSlotGraphName((prev) => ({ ...prev, [targetSlot]: name }))
    setActiveSlot(targetSlot)
    setLibVersion((v) => v + 1)
    if (ready) void engineRef.current?.applyStyleGraph(retargeted).catch(() => {})
    setLibrary({ open: false, role: null, material: null })
  }

  // ── Model upload ──
  type UploadState = { kind: "pick"; files: File[]; paths: string[] } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const loadCustom = async (files: File[], pmxFile: File) => {
    setUpload(null)
    setSelected(null)
    setSlotOverrides({}) // stale overrides must not leak onto the new model's materials
    setAnimName(null) // the new model starts in bind pose
    setSlotInited(false) // re-pick the default editable slot for the new model
    setModelSize(pmxFile.size)
    await loadFromFiles(files, pmxFile)
  }

  // ── VMD animation upload ──
  const vmdInputRef = useRef<HTMLInputElement | null>(null)
  const onVmdPicked = async (file: File | undefined) => {
    if (!file) return
    setAnimSize(file.size)
    setAnimName(await loadVmdFile(file))
  }

  // ── Music: a bundled default track, replaceable via upload. An <audio>
  // element (below) is the source; a rAF loop mirrors the model's animation
  // clock onto it so play/pause/seek/loop from the transport drive both. ──
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const [audioName, setAudioName] = useState<string | null>(DEFAULT_AUDIO.name)
  const [audioSrc, setAudioSrc] = useState<string>(DEFAULT_AUDIO.url)

  // High-level asset metadata (size for uploads; duration read from the engine /
  // audio element once available). Sizes are unknown for the bundled defaults.
  const [modelSize, setModelSize] = useState<number | null>(null)
  const [animDuration, setAnimDuration] = useState(0)
  const [animKeyframes, setAnimKeyframes] = useState(0)
  const [animSize, setAnimSize] = useState<number | null>(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [audioSize, setAudioSize] = useState<number | null>(null)

  // Animation duration + total bone keyframes become available a frame after the
  // clip is shown/loaded.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const model = animName ? engineRef.current?.getModel(modelName) : null
      setAnimDuration(model?.getAnimationProgress().duration ?? 0)
      let kf = 0
      const clip = model && animName ? model.getClip(animName) : null
      if (clip) for (const track of clip.boneTracks.values()) kf += track.length
      setAnimKeyframes(kf)
    })
    return () => cancelAnimationFrame(raf)
  }, [animName, modelName, engineRef])

  // Browsers block audio until the user interacts — start the track on the first
  // pointer down, synced to wherever the animation already is.
  const userInteracted = useRef(false)
  useEffect(() => {
    const on = () => {
      userInteracted.current = true
    }
    window.addEventListener("pointerdown", on, { once: true })
    return () => window.removeEventListener("pointerdown", on)
  }, [])

  // Load the bundled default motion once the demo model is ready (custom uploads
  // don't re-trigger `ready`, so this stays demo-only).
  const defaultAnimLoaded = useRef(false)
  useEffect(() => {
    if (!ready || defaultAnimLoaded.current) return
    defaultAnimLoaded.current = true
    void loadVmdUrl(DEFAULT_ANIM.name, DEFAULT_ANIM.url).then((n) => {
      if (n) setAnimName(n)
    })
  }, [ready, loadVmdUrl])

  // Mirror the animation clock onto the audio element (model is the master).
  useEffect(() => {
    const audio = audioElRef.current
    if (!audio) return
    if (!animName) {
      audio.pause()
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(modelName)?.getAnimationProgress()
      if (!p) return
      if (p.playing && userInteracted.current) {
        if (audio.paused) {
          audio.currentTime = p.current
          void audio.play().catch(() => {})
        } else if (Math.abs(audio.currentTime - p.current) > 0.2) {
          audio.currentTime = p.current // drift correction (seek / loop restart)
        }
      } else if (!p.playing && !audio.paused) {
        audio.pause()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animName, modelName, engineRef])
  const onFolderPicked = (fileList: FileList | null) => {
    const result = parsePmxFolderInput(fileList)
    if (result.status === "single") void loadCustom(result.files, result.pmxFile)
    else if (result.status === "multiple") setUpload({ kind: "pick", files: result.files, paths: result.pmxRelativePaths })
    else if (result.status === "no_pmx") setUpload({ kind: "notice", message: "No .pmx file found in that folder." })
    else if (result.status === "not_directory")
      setUpload({ kind: "notice", message: "Please pick the model's folder itself, textures included." })
  }

  // ── Scene settings → engine ──
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
      engine.addGround({ diffuseColor: hexToLinearVec3(colors.ground), gridLineColor: hexToLinearVec3(colors.grid) })
      prevGround.current = { ground: colors.ground, grid: colors.grid }
    }
  }, [sceneSettings, ready, engineRef])

  // ── Drawer drag-resize. Resize the container via the DOM during the drag (no
  // setState per pointer move) so React Flow isn't re-rendered every frame — its
  // ResizeObserver handles the smooth resize. Commit to state on pointer up. ──
  const graphDrawerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const dragStart = useRef<{ y: number; h: number } | null>(null)
  const dragHeightRef = useRef(drawerH)
  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, h: drawerH }
    dragHeightRef.current = drawerH
    setResizing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    const next = Math.min(Math.max(dragStart.current.h + (dragStart.current.y - e.clientY), 220), window.innerHeight - 160)
    dragHeightRef.current = next
    if (graphDrawerRef.current) graphDrawerRef.current.style.height = `${next}px`
  }
  const onDragUp = () => {
    if (!dragStart.current) return
    dragStart.current = null
    setDrawerH(dragHeightRef.current)
    setResizing(false)
  }

  const presetGraph = SLOT_GRAPHS[activeSlot]

  // ── Dock tab definitions ── LEFT = styling (materials, scene look); RIGHT =
  // ingredients & output (assets in, render out).
  const leftTabs: DockTab[] = [
    {
      id: "materials",
      label: "Materials",
      icon: MaterialSphereIcon,
      content: (
        <MaterialsPanel
          materials={materials}
          assignments={assignments}
          selected={selected}
          activeSlot={activeSlot}
          onSelect={pick}
          onHover={(name) => highlight(name ?? selected)}
          onAssign={assign}
          onToggleVisible={toggleVisible}
          onEditGraph={() => setDrawerOpen(true)}
          slotGraphName={slotGraphName}
          onOpenLibrary={(role, material) => setLibrary({ open: true, role, material })}
        />
      ),
    },
    { id: "scene", label: "Scene", icon: Sun, content: <ScenePanel settings={sceneSettings} onChange={setSceneSettings} /> },
  ]

  const rightTabs: DockTab[] = [
    {
      id: "assets",
      label: "Assets",
      icon: Package,
      content: (
        <AssetsPanel
          modelFile={modelFile}
          animName={animName}
          audioName={audioName}
          modelMeta={`${modelStats.vertices.toLocaleString("en-US")} vertices · ${modelStats.bones} bones · ${modelStats.materials} materials${modelSize ? ` · ${fmtSize(modelSize)}` : ""}`}
          animMeta={
            animName
              ? [fmtDur(animDuration), animKeyframes ? `${animKeyframes.toLocaleString("en-US")} keyframes` : "", animSize ? fmtSize(animSize) : ""]
                  .filter(Boolean)
                  .join(" · ")
              : ""
          }
          audioMeta={audioName ? [fmtDur(audioDuration), audioSize ? fmtSize(audioSize) : ""].filter(Boolean).join(" · ") : ""}
          onUploadModel={() => folderInputRef.current?.click()}
          onUploadAnimation={() => vmdInputRef.current?.click()}
          onUploadMusic={() => audioInputRef.current?.click()}
          onRemoveAnimation={() => {
            stopAnimation()
            setAnimName(null)
          }}
        />
      ),
    },
    { id: "render", label: "Render", icon: Clapperboard, content: <RenderPanel /> },
  ]

  // The node-graph drawer opens ABOVE the persistent transport bar (when a clip
  // is loaded), independent of the docks — opening it never shrinks them.
  const graphBottom = animName ? 64 : 12
  // Drawer width: full-bleed when docks are hidden, else inset to clear both docks.
  const drawerWidth = docksOpen ? "max(360px, calc(100vw - 640px))" : "calc(100vw - 24px)"

  return (
    <div
      className="fixed inset-0 overflow-hidden text-sm text-foreground select-none"
      style={{ backgroundColor: sceneSettings.colors.background }}
      suppressHydrationWarning
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/60 px-4 py-2 text-xs text-muted-foreground backdrop-blur-sm">
            <span className="size-2 animate-pulse rounded-full bg-blue-400" />
            loading model…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-xs text-red-400 backdrop-blur-xl">
            Engine: {error}
          </div>
        </div>
      )}

      {/* ── Left column: full-height flush dock when expanded (brand pill is its
          header); a floating pill on its own when collapsed. ── */}
      {mounted &&
        (docksOpen ? (
          <div className="fixed inset-y-0 left-0 z-20 w-[296px]">
            <LeftDock
              railTop={<RailLogo />}
              header={<BrandPill sceneName="Untitled scene" docksOpen onToggleDocks={() => setDocksOpen(false)} asHeader />}
              tabs={leftTabs}
              active={leftTab}
              onActive={setLeftTab}
            />
          </div>
        ) : (
          <div className="fixed top-3 left-3 z-20">
            <BrandPill sceneName="Untitled scene" docksOpen={false} onToggleDocks={() => setDocksOpen(true)} />
          </div>
        ))}

      {/* ── Right column: full-height flush dock when expanded (account/play/share
          cluster is its header); floating pills when collapsed. ── */}
      {mounted &&
        (docksOpen ? (
          <div className="fixed inset-y-0 right-0 z-20 w-[296px]">
            <RightDock
              header={<TopRightCluster shareName="untitled-scene" asHeader />}
              tabs={rightTabs}
              active={rightTab}
              onActive={setRightTab}
            />
          </div>
        ) : (
          <div className="fixed top-3 right-3 z-20">
            <TopRightCluster shareName="untitled-scene" />
          </div>
        ))}

      {/* ── Node-graph editor drawer: opened from the Materials tab, expands up
          from the bottom (above the transport), independent of the docks. Kept
          mounted while closed (height 0) so edits/undo/live-compile survive.
          Client-only (React Flow isn't SSR-safe), so gated behind `mounted`. ── */}
      {mounted && (
      <div
        ref={graphDrawerRef}
        className={cn(
          "fixed left-1/2 z-20 -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-md",
          "transition-[height,opacity,bottom] duration-[420ms] ease-out-soft",
          resizing && "transition-none",
          !drawerOpen && "pointer-events-none",
        )}
        style={{
          width: drawerWidth,
          height: drawerOpen ? drawerH : 0,
          opacity: drawerOpen ? 1 : 0,
          bottom: graphBottom,
        }}
      >
        <div className="flex h-full flex-col">
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
              key={`${activeSlot}-${libVersion}`}
              slotLabel={SLOT_LABELS[activeSlot]}
              presetGraph={presetGraph}
              getInitialGraph={() => edited.current.get(activeSlot) ?? presetGraph}
              onGraphChange={(g) => edited.current.set(activeSlot, g)}
              onApplyStateChange={() => {}}
              engineRef={engineRef}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
            />
          ) : (
            <div className="relative flex flex-1 items-center justify-center text-xs text-muted-foreground">
              {SLOT_LABELS[activeSlot]} uses a built-in shader — no editable graph for this slot yet
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-2 size-7 text-muted-foreground hover:text-foreground"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Persistent transport bar (always visible while a clip is loaded, even
          when the docks are collapsed). ── */}
      {animName && (
        <div className="fixed bottom-3 left-1/2 z-20 -translate-x-1/2">
          <AnimPlayer engineRef={engineRef} modelName={modelName} clipName={animName} />
        </div>
      )}

      {/* ── Node-graph library popup ── */}
      <NodeLibrary
        open={library.open}
        onOpenChange={(o) => setLibrary((s) => ({ ...s, open: o }))}
        targetMaterial={library.material}
        canApply={library.role !== null}
        affects={library.role ? Object.values(assignments).filter((s) => s === library.role).length : 0}
        onApply={applyLibrary}
      />

      {/* ── Uploads ── */}
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
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            setAudioName(f.name)
            setAudioSize(f.size)
            setAudioSrc((prev) => {
              if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
              return URL.createObjectURL(f)
            })
          }
          e.target.value = ""
        }}
      />
      {/* Audio source — driven (play/pause/seek) by the animation-clock mirror above. */}
      <audio
        ref={audioElRef}
        src={audioSrc}
        preload="auto"
        playsInline
        className="hidden"
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
      />
      <Dialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)}>
        <DialogContent className="max-w-sm rounded-xl border-white/10 bg-zinc-950/90 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {upload?.kind === "pick" ? "Multiple models found — pick one" : "Can't load that folder"}
            </DialogTitle>
          </DialogHeader>
          {upload?.kind === "pick" ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {upload.paths.map((path) => (
                <button
                  key={path}
                  className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 hover:text-foreground"
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
            <p className="text-xs text-muted-foreground">{upload?.kind === "notice" ? upload.message : null}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
