"use client"

// Immersive editor (home). The WebGPU viewport is the page; a Figma-style shell
// floats over it: top-left brand pill + top-right account/play/share cluster
// stay put, while TWO docks — left (Materials / Scene / Assets via an icon rail)
// and right (Properties / Render tabs) — collapse together behind the brand
// pill's single toggle. The node-graph editor lives in a bottom drawer, narrowed
// to sit between the docks, and collapses on its own into a status pill.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  DEFAULT_GRAPH,
  parsePmxFolderInput,
  pmxFileAtRelativePath,
  type CompileOptions,
  type Diagnostic,
  type MaterialPreset,
  type ShaderGraph,
  type StyleGroup,
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
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
import { NodeLibrary } from "@/components/editor/node-library"
import { RenderPanel } from "@/components/editor/render-panel"
import { useEngine } from "@/hooks/use-engine"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { SLOT_GRAPHS } from "@/lib/materials"
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

// Unique kebab id for a new (peeled / created) style group. CJK material names
// slugify to empty → "group", which is fine (id is internal; label is shown).
const newGroupId = (material: string, groups: StyleGroup[]): string => {
  const base = material.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group"
  const ids = new Set(groups.map((g) => g.id))
  if (!ids.has(base)) return base
  let i = 1
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

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

// The graph editor is a free-floating window; its position/size persist across sessions.
const PANEL_KEY = "reze-design.graphPanel"
function loadPanelRect(): Rect | null {
  try {
    const raw = window.localStorage.getItem(PANEL_KEY)
    return raw ? (JSON.parse(raw) as Rect) : null
  } catch {
    return null
  }
}
function savePanelRect(r: Rect) {
  try {
    window.localStorage.setItem(PANEL_KEY, JSON.stringify(r))
  } catch {
    // non-fatal
  }
}
// First-open default: bottom-centered, roughly where the old docked drawer sat, clamped
// to the viewport so it always lands on-screen.
function defaultPanelRect(): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(360, Math.min(vw - 648, 1200, vw - 48))
  const h = Math.min(460, vh - 96)
  return { x: Math.round((vw - w) / 2), y: Math.max(8, vh - h - 76), w, h }
}

export default function Home() {
  // Which style group the node-graph editor is bound to.
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // Node-graph library popup, opened for a specific material.
  // The shader-graph library targets a style GROUP (the styling unit) — a group can be
  // empty (a freshly created one), so keying on a material would lock those out.
  const [library, setLibrary] = useState<{ open: boolean; groupId: string | null }>({ open: false, groupId: null })
  // Bumped on library-pick to remount the graph editor with the new graph.
  const [libVersion, setLibVersion] = useState(0)
  // The graph the editing session started from — restored on "Back to library"
  // so a fresh fork / new graph (which previews live) can be cleanly abandoned.
  const [editBaseline, setEditBaseline] = useState<{ groupId: string; graph: ShaderGraph; label?: string } | null>(null)

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
  const [drawerFull, setDrawerFull] = useState(false) // graph editor full-screen
  // Free-floating editor window rect (null until initialized post-mount from storage).
  const [panelRect, setPanelRect] = useState<Rect | null>(null)
  useEffect(() => {
    setPanelRect(loadPanelRect() ?? defaultPanelRect())
  }, [])
  const updatePanelRect = useCallback((r: Rect) => {
    setPanelRect(r)
    savePanelRect(r)
  }, [])
  // Keep the floating editor on-screen if the window shrinks (never lose it off-edge).
  useEffect(() => {
    const onResize = () =>
      setPanelRect((r) => {
        if (!r) return r
        const pad = 8
        const w = Math.min(r.w, window.innerWidth - 2 * pad)
        const h = Math.min(r.h, window.innerHeight - 2 * pad)
        const x = Math.min(Math.max(pad, r.x), window.innerWidth - w - pad)
        const y = Math.min(Math.max(pad, r.y), window.innerHeight - h - pad)
        return { x, y, w, h }
      })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
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
    groups,
    upsertGroup,
    applyGroups,
    highlight,
    toggleVisible,
    loadFromFiles,
    loadVmdFile,
    loadVmdUrl,
    stopAnimation,
  } = useEngine((m) => pickRef.current(m), sceneSettings)

  // material → its style group (a material is in at most one group; else ungrouped).
  const groupOfMaterial = useCallback(
    (name: string | null): StyleGroup | null => (name ? (groups.find((g) => g.materials.includes(name)) ?? null) : null),
    [groups],
  )

  // Clicking a material in the 3D scene highlights it and focuses its group (so the
  // editor targets that group). No persistent selection — the tree is hover + drag.
  const pick = (material: string | null) => {
    highlight(material)
    if (!material) return
    const g = groupOfMaterial(material)
    if (g) setActiveGroupId(g.id)
  }
  useEffect(() => {
    pickRef.current = pick
  })

  // Leaving the Materials tab clears any lingering hover/pick highlight.
  useEffect(() => {
    if (leftTab !== "materials") highlight(null)
  }, [leftTab, highlight])

  // Selection is explicit (single-click a group to select/deselect), so we don't
  // re-select on every null. But on the FIRST load, select the first non-empty group
  // (sidebar order = sorted by label/id) so the shader-graph inspector isn't empty.
  const didAutoSelect = useRef(false)
  useEffect(() => {
    if (didAutoSelect.current || !groups.length) return
    didAutoSelect.current = true
    const first = [...groups]
      .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id, undefined, { sensitivity: "base" }))
      .find((g) => g.materials.length > 0)
    if (first) setActiveGroupId(first.id)
  }, [groups])

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const libGroup = groups.find((g) => g.id === library.groupId) ?? null
  // Factory preset for the active group (for Reset) — auto-group ids are role keys.
  const presetGraph = (activeGroup && SLOT_GRAPHS[activeGroup.id as MaterialPreset]) || activeGroup?.graph || null

  // Graph editor's onApply: compile + swap the edited graph onto the active group.
  const applyActiveGraph = useCallback(
    (graph: ShaderGraph, opts?: CompileOptions): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> =>
      activeGroup ? upsertGroup({ ...activeGroup, graph }, opts) : Promise.resolve({ ok: false, diagnostics: [] }),
    [activeGroup, upsertGroup],
  )

  // Apply a library look to the target group (the styling unit). `edit` opens the
  // editor on the result and snapshots a baseline so the fork can be abandoned cleanly.
  const applyLibrary = (graph: ShaderGraph, name: string, edit = false) => {
    const group = groups.find((g) => g.id === library.groupId)
    if (!group) return
    const styled: ShaderGraph = { ...graph, name }
    if (edit) setEditBaseline({ groupId: group.id, graph: group.graph, label: group.label })
    const updated: StyleGroup = { ...group, graph: styled, label: name }
    // Empty groups can't compile — store via applyGroups (withheld from the engine)
    // until they gain materials; non-empty groups compile through upsertGroup.
    if (updated.materials.length) void upsertGroup(updated)
    else void applyGroups(groups.map((x) => (x.id === group.id ? updated : x)))
    setActiveGroupId(group.id)
    setLibVersion((v) => v + 1)
    if (edit) {
      setDrawerOpen(true) // pop the editor; keep the library open (independent panels)
    } else {
      setLibrary({ open: false, groupId: null })
    }
  }

  // ── Graph-editor session lifecycle ──
  // Edits preview live on the active group. Opening the editor snapshots the current
  // graph as the baseline; "Save & close" keeps the edits; "Back to library" restores
  // the baseline and returns to the picker (so a fresh fork/new graph can be undone).
  const saveGraphEdit = () => {
    setEditBaseline(null)
    setDrawerOpen(false)
    setDrawerFull(false)
  }
  // Close (discard): revert the live-previewed edits to the baseline and close —
  // no library navigation (you may have arrived via the group's Edit graph).
  const closeGraphEdit = () => {
    const baseline = editBaseline
    setEditBaseline(null)
    setDrawerOpen(false)
    setDrawerFull(false)
    if (baseline) {
      const g = groups.find((x) => x.id === baseline.groupId)
      if (g) void upsertGroup({ ...g, graph: baseline.graph, label: baseline.label })
      setLibVersion((v) => v + 1)
    }
  }

  // ── Group operations (structural edits go through applyGroups) ──
  const createGroup = () => {
    const id = newGroupId("group", groups)
    void applyGroups([
      ...groups,
      { id, label: "New group", materials: [], graph: structuredClone(DEFAULT_GRAPH), renderClass: "auto" },
    ])
    setActiveGroupId(id)
  }
  // Non-empty groups compile through upsertGroup (one group); empty folders exist
  // in UI state only, so their edits go through applyGroups (which withholds them
  // from the engine) rather than upsertGroup (which would compile an empty group).
  const patchGroup = (id: string, patch: Partial<StyleGroup>) => {
    const g = groups.find((x) => x.id === id)
    if (!g) return
    const updated = { ...g, ...patch }
    if (updated.materials.length) void upsertGroup(updated)
    else void applyGroups(groups.map((x) => (x.id === id ? updated : x)))
  }
  const renameGroup = (id: string, label: string) => patchGroup(id, { label: label.trim() || id })
  const deleteGroup = (id: string) => {
    const g = groups.find((x) => x.id === id)
    if (!g || g.renderClass === "eye" || g.renderClass === "hair") return // Eye/Hair are pinned
    void applyGroups(groups.filter((x) => x.id !== id)) // its materials fall back to hand-shaded
    if (activeGroupId === id) setActiveGroupId(null)
  }
  // Move a material into a group (target=null → ungroup). Removes it from wherever
  // it was first; each material lives in at most one group.
  const moveMaterial = (material: string, targetId: string | null) => {
    const next = groups.map((g) => ({ ...g, materials: g.materials.filter((m) => m !== material) }))
    if (targetId) {
      const t = next.find((g) => g.id === targetId)
      if (t) t.materials = [...t.materials, material]
    }
    void applyGroups(next)
  }
  // Focus a group and open the node-graph editor on it (snapshots a baseline).
  const editGroupGraph = (id: string) => {
    const g = groups.find((x) => x.id === id)
    if (!g) return
    setActiveGroupId(id)
    setEditBaseline({ groupId: id, graph: g.graph, label: g.label })
    setDrawerOpen(true)
  }

  // ── Model upload ──
  type UploadState = { kind: "pick"; files: File[]; paths: string[] } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const loadCustom = async (files: File[], pmxFile: File) => {
    setUpload(null)
    setActiveGroupId(null) // the new model brings a fresh group set (re-inited on load)
    setAnimName(null) // the new model starts in bind pose
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

  // ── Stage upload: a second model placed in the scene (0.22 multi-model). Loaded
  // ungrouped, so it renders the engine's neutral default rather than toon. ──
  const STAGE_ID = "stage"
  const stageInputRef = useRef<HTMLInputElement | null>(null)
  const [stageName, setStageName] = useState<string | null>(null)
  const [stageMeta, setStageMeta] = useState("")
  const loadStage = async (files: File[], pmxFile: File) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      if (engine.getModel(STAGE_ID)) engine.removeModel(STAGE_ID) // reload replaces
      const m = await engine.loadModel(STAGE_ID, { files, pmxFile })
      setStageName(pmxFile.name)
      setStageMeta(
        `${Math.round(m.getVertices().length / 8).toLocaleString("en-US")} vertices · ${m.getMaterials().length} materials · ${fmtSize(pmxFile.size)}`,
      )
    } catch (e) {
      setUpload({ kind: "notice", message: `Couldn't load that stage: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const onStagePicked = (fileList: FileList | null) => {
    const result = parsePmxFolderInput(fileList)
    if (result.status === "single") void loadStage(result.files, result.pmxFile)
    else if (result.status === "multiple") {
      const pmx = pmxFileAtRelativePath(result.files, result.pmxRelativePaths[0]) // stages are ~1 pmx; take the first
      if (pmx) void loadStage(result.files, pmx)
    } else if (result.status === "no_pmx") setUpload({ kind: "notice", message: "No .pmx file found in that folder." })
    else if (result.status === "not_directory")
      setUpload({ kind: "notice", message: "Please pick the stage's folder itself, textures included." })
  }
  const removeStage = () => {
    engineRef.current?.removeModel(STAGE_ID)
    setStageName(null)
    setStageMeta("")
  }

  // ── Camera VMD upload: drives the shot (target/rotation/distance/fov); default-on
  // once loaded, toggled Follow/Free from the transport. ──
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [cameraName, setCameraName] = useState<string | null>(null)
  const [cameraSize, setCameraSize] = useState<number | null>(null)
  const loadCameraBuffer = async (buffer: ArrayBuffer, name: string) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      await engine.loadCameraVmdFromBuffer(buffer)
      setCameraName(name)
      setCameraSize(buffer.byteLength)
    } catch (e) {
      setUpload({ kind: "notice", message: `Couldn't load that camera: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const onCameraPicked = async (file: File | undefined) => {
    if (file) await loadCameraBuffer(await file.arrayBuffer(), file.name)
  }
  const removeCamera = () => {
    engineRef.current?.clearCameraVmd()
    setCameraName(null)
    setCameraSize(null)
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
          groups={groups}
          activeGroupId={activeGroupId}
          onHover={(name) => highlight(name)}
          onToggleVisible={toggleVisible}
          onOpenLibrary={(groupId) => setLibrary({ open: true, groupId })}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onSetActiveGroup={setActiveGroupId}
          onEditGroupGraph={editGroupGraph}
          onMoveMaterial={moveMaterial}
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
          stageName={stageName}
          cameraName={cameraName}
          audioName={audioName}
          modelMeta={`${modelStats.vertices.toLocaleString("en-US")} vertices · ${modelStats.bones} bones · ${modelStats.materials} materials${modelSize ? ` · ${fmtSize(modelSize)}` : ""}`}
          animMeta={
            animName
              ? [fmtDur(animDuration), animKeyframes ? `${animKeyframes.toLocaleString("en-US")} keyframes` : "", animSize ? fmtSize(animSize) : ""]
                  .filter(Boolean)
                  .join(" · ")
              : ""
          }
          stageMeta={stageMeta}
          cameraMeta={cameraName && cameraSize != null ? fmtSize(cameraSize) : ""}
          audioMeta={audioName ? [fmtDur(audioDuration), audioSize ? fmtSize(audioSize) : ""].filter(Boolean).join(" · ") : ""}
          onUploadModel={() => folderInputRef.current?.click()}
          onUploadAnimation={() => vmdInputRef.current?.click()}
          onUploadStage={() => stageInputRef.current?.click()}
          onUploadCamera={() => cameraInputRef.current?.click()}
          onUploadMusic={() => audioInputRef.current?.click()}
          onRemoveAnimation={() => {
            stopAnimation()
            setAnimName(null)
          }}
          onRemoveStage={removeStage}
          onRemoveCamera={removeCamera}
        />
      ),
    },
    { id: "render", label: "Render", icon: Clapperboard, content: <RenderPanel /> },
  ]

  return (
    <div
      className="fixed inset-0 overflow-hidden text-sm text-foreground select-none"
      style={{ backgroundColor: sceneSettings.colors.background }}
      suppressHydrationWarning
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xs">
            <span className="size-2 animate-pulse rounded-full bg-blue-400" />
            loading model…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-xs text-red-400 backdrop-blur-xs">
            Engine: {error}
          </div>
        </div>
      )}

      {/* ── Left column: full-height flush dock when expanded (brand pill is its
          header); a floating pill on its own when collapsed. ── */}
      {mounted &&
        (docksOpen ? (
          <div className="fixed inset-y-0 left-0 z-20 w-[300px]">
            <LeftDock
              railTop={<RailLogo />}
              header={
                <BrandPill
                  sceneName="Untitled scene"
                  docksOpen
                  onToggleDocks={() => {
                    setDocksOpen(false)
                    setDrawerOpen(false) // collapsing the docks hides the graph editor too
                    setDrawerFull(false)
                  }}
                  asHeader
                />
              }
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
          <div className="fixed inset-y-0 right-0 z-20 w-[300px]">
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

      {/* ── Node-graph editor: a free-floating, draggable + resizable window (drag by
          the header grip; resize from any edge/corner). Position/size persist across
          sessions; first open lands bottom-centered. The editor only MOUNTS while OPEN
          — mounting it while closed made switching groups remount + auto-reapply the
          graph (a spurious second setGroups → minimap double-refresh). Edits are
          live-applied, so the graph persists on close. Client-only (React Flow isn't
          SSR-safe), so gated behind `mounted` + an initialized rect. ── */}
      {mounted && panelRect && (
        <FloatingPanel
          rect={panelRect}
          onRectChange={updatePanelRect}
          open={drawerOpen}
          fullscreen={drawerFull}
          className={cn(
            // z-50: above the docks/transport (z-20) and the non-modal library (z-40),
            // so editing from the library floats on top of it as an independent panel.
            "z-50 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-xs transition-opacity duration-300",
            !drawerOpen && "pointer-events-none opacity-0",
          )}
        >
          {!drawerOpen ? null : activeGroup && presetGraph ? (
            <GraphEditor
              key={`${activeGroup.id}-${libVersion}`}
              slotLabel={activeGroup.label ?? activeGroup.id}
              presetGraph={presetGraph}
              getInitialGraph={() => activeGroup.graph ?? presetGraph}
              onApply={applyActiveGraph}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onSave={saveGraphEdit}
              onClose={closeGraphEdit}
              fullscreen={drawerFull}
              onToggleFullscreen={() => setDrawerFull((v) => !v)}
            />
          ) : (
            <div className="relative flex h-full items-center justify-center text-xs text-muted-foreground">
              Select a material to edit its look
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
        </FloatingPanel>
      )}

      {/* ── Persistent transport bar (always visible while a clip is loaded, even
          when the docks are collapsed). ── */}
      {animName && !drawerFull && (
        <div className="fixed bottom-3 left-1/2 z-20 -translate-x-1/2">
          <AnimPlayer engineRef={engineRef} modelName={modelName} clipName={animName} hasCamera={cameraName !== null} />
        </div>
      )}

      {/* ── Shader-graph library popup ── */}
      <NodeLibrary
        open={library.open}
        onOpenChange={(o) => setLibrary((s) => ({ ...s, open: o }))}
        targetLabel={libGroup?.label ?? libGroup?.id ?? null}
        canApply={libGroup !== null}
        affects={libGroup?.materials.length ?? 0}
        currentGraphName={libGroup?.graph.name ?? null}
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
        ref={(el) => {
          stageInputRef.current = el
          el?.setAttribute("webkitdirectory", "")
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onStagePicked(e.target.files)
          e.target.value = ""
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept=".vmd"
        className="hidden"
        onChange={(e) => {
          void onCameraPicked(e.target.files?.[0])
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
        <DialogContent className="max-w-sm rounded-xl border-white/10 bg-zinc-950/95 backdrop-blur-xs">
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
