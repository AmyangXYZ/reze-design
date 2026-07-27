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
import { RenderPanel, type FramePreview } from "@/components/editor/render-panel"
import { useEngine } from "@/hooks/use-engine"
import { useHistory } from "@/hooks/use-history"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import { expandUploadFiles, readDroppedFiles } from "@/lib/uploads"
import { useT } from "@/lib/i18n"
import type { ExportAudioSource } from "@/lib/video-export"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import { SLOT_GRAPHS } from "@/lib/materials"
import { hydrateScene, saveSceneState } from "@/lib/scene"
import {
  azElToDirection,
  hexToLinearVec3,
  hexToSrgbVec3,
  type SceneSettings,
} from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

// Frame preview: how far the viewport's aspect may deviate from the export target
// before the canvas gets pinned / the frame border leaves the viewport edges. A
// desktop window is never EXACTLY 16:9 — within this band the true frame differs
// imperceptibly, so keep the scene untouched and the border flush.
const FRAME_ASPECT_TOL = 1.03

// How long edits settle before the working scene is written to localStorage.
// Deliberately much longer than the undo hook's 300ms: undo granularity wants to
// feel immediate, but an autosave doesn't, and a shorter window let a mid-drag
// pause fire the write *during* the drag.
const SAVE_SETTLE_MS = 1000

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
  // Mobile first-open: docks closed — two 300px docks bury a phone viewport; the
  // collapsed pills work fine there. (Stored per device, so a desktop stays open.)
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
  const def = { docks: !coarse, leftTab: "materials", rightTab: "assets" }
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
  const t = useT()
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
  // The boot document: the bundled demo with the user's stored values merged over
  // it. Read synchronously (SSR-safe: falls back to the demo) so the page
  // background AND the engine boot already match their config. Built once — it's
  // the STARTING point, not live state; everything below owns its slice from here.
  const [bootScene] = useState(() => hydrateScene(DEFAULT_SCENE))
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(bootScene.state.settings)
  // Undo/redo for the Scene panel. The graph editor runs its OWN history and only
  // yields ⌘Z while closed, so gate on the same `drawerOpen` it gates on —
  // whichever surface is open owns the shortcut, and neither double-handles it.
  const sceneHistory = useHistory(sceneSettings, setSceneSettings, { shortcutsEnabled: !drawerOpen })
  // suppressHydrationWarning makes React SKIP patching the server-rendered style
  // (SSR uses defaults; the client initializer read localStorage), and since the
  // state never changes after mount the stale server color stuck — a stored light
  // background rendered black after refresh. Sync the DOM imperatively instead.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.style.setProperty("background-color", sceneSettings.background.color)
  }, [sceneSettings.background.color])

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
  } = useEngine((m) => pickRef.current(m), bootScene)

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
    // Apply the look's graph but keep the group's own name — the group label and the
    // shader-graph name are separate (renaming the group here was the bug).
    const updated: StyleGroup = { ...group, graph: styled }
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

  const openLibrary = useCallback((groupId: string) => setLibrary({ open: true, groupId }), [])

  // ── Group operations (structural edits go through applyGroups) ──
  // Returns the new id — the materials panel drops it straight into rename mode.
  // The label is still made unique ("New group 2") for whoever Escapes out.
  // These are useCallback'd so MaterialsPanel (memoized) can skip re-rendering
  // while it's the HIDDEN dock tab — the dock keeps tabs mounted now, so an
  // unstable handler identity would re-render its ~39 context-menu trees on every
  // unrelated page render, e.g. each tick of a scene-settings slider drag. Every
  // one of them closes over `groups`, so identity changes exactly when the panel
  // genuinely needs to redraw.
  const createGroup = useCallback((): string => {
    const id = newGroupId("group", groups)
    const base = t.materials.newGroup
    const labels = new Set(groups.map((g) => g.label ?? g.id))
    let label = base
    for (let n = 2; labels.has(label); n++) label = `${base} ${n}`
    void applyGroups([
      ...groups,
      { id, label, materials: [], graph: structuredClone(DEFAULT_GRAPH), renderClass: "auto" },
    ])
    setActiveGroupId(id)
    return id
  }, [groups, t, applyGroups])
  // Non-empty groups compile through upsertGroup (one group); empty folders exist
  // in UI state only, so their edits go through applyGroups (which withholds them
  // from the engine) rather than upsertGroup (which would compile an empty group).
  const patchGroup = useCallback(
    (id: string, patch: Partial<StyleGroup>) => {
      const g = groups.find((x) => x.id === id)
      if (!g) return
      const updated = { ...g, ...patch }
      if (updated.materials.length) void upsertGroup(updated)
      else void applyGroups(groups.map((x) => (x.id === id ? updated : x)))
    },
    [groups, upsertGroup, applyGroups],
  )
  const renameGroup = useCallback(
    (id: string, label: string) => patchGroup(id, { label: label.trim() || id }),
    [patchGroup],
  )
  const deleteGroup = useCallback(
    (id: string) => {
      const g = groups.find((x) => x.id === id)
      if (!g || g.renderClass === "eye" || g.renderClass === "hair") return // Eye/Hair are pinned
      void applyGroups(groups.filter((x) => x.id !== id)) // its materials fall back to hand-shaded
      if (activeGroupId === id) setActiveGroupId(null)
    },
    [groups, applyGroups, activeGroupId],
  )
  // Move a material into a group (target=null → ungroup). Removes it from wherever
  // it was first; each material lives in at most one group.
  const moveMaterial = useCallback(
    (material: string, targetId: string | null) => {
      const next = groups.map((g) => ({ ...g, materials: g.materials.filter((m) => m !== material) }))
      if (targetId) {
        const t = next.find((g) => g.id === targetId)
        if (t) t.materials = [...t.materials, material]
      }
      void applyGroups(next)
    },
    [groups, applyGroups],
  )
  // Focus a group and open the node-graph editor on it (snapshots a baseline).
  const editGroupGraph = useCallback(
    (id: string) => {
      const g = groups.find((x) => x.id === id)
      if (!g) return
      setActiveGroupId(id)
      setEditBaseline({ groupId: id, graph: g.graph, label: g.label })
      setDrawerOpen(true)
    },
    [groups],
  )

  // ── Model upload ──
  type UploadState = { kind: "pick"; files: File[]; paths: string[] } | { kind: "notice"; message: string } | null
  const [upload, setUpload] = useState<UploadState>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  // Mobile: no folder pickers exist, so the model button is zip-only there.
  const [isMobile] = useState(() => typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent))

  const loadCustom = async (files: File[], pmxFile: File) => {
    setUpload(null)
    setActiveGroupId(null) // the new model brings a fresh group set (re-inited on load)
    setModelSize(pmxFile.size)
    await loadFromFiles(files, pmxFile)
    // The new model inherits the current animation (clips are per model instance,
    // so the retained source reloads into it; posed at frame 0, paused).
    const src = animSourceRef.current
    if (src) {
      const name = src.kind === "file" ? await loadVmdFile(src.file) : await loadVmdUrl(src.name, src.url)
      setAnimName(name)
    } else {
      setAnimName(null)
    }
  }

  // ── VMD animation upload ──
  const vmdInputRef = useRef<HTMLInputElement | null>(null)
  // The clip's SOURCE, retained so a newly uploaded model inherits the current
  // animation (clips live per model instance — the file/url must reload there).
  const animSourceRef = useRef<{ kind: "file"; file: File } | { kind: "url"; name: string; url: string } | null>(null)
  const onVmdPicked = async (file: File | undefined) => {
    if (!file) return
    setAnimSize(file.size)
    animSourceRef.current = { kind: "file", file }
    setAnimName(await loadVmdFile(file))
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
      setUpload({ kind: "notice", message: t.upload.cantLoadCamera(e instanceof Error ? e.message : String(e)) })
    }
  }
  const onCameraPicked = async (file: File | undefined) => {
    if (file) await loadCameraBuffer(await file.arrayBuffer(), file.name)
  }
  const removeCamera = useCallback(() => {
    engineRef.current?.clearCameraVmd()
    setCameraName(null)
    setCameraSize(null)
  }, [engineRef])

  // ── Backdrop: a static image behind the 3D scene. Lives as runtime state
  // (object URL; original File kept on the object). Mutually exclusive with the
  // 360 skybox — a flat layer behind an opaque skybox canvas would be invisible.
  const backdropInputRef = useRef<HTMLInputElement | null>(null)
  const [backdrop, setBackdrop] = useState<BackdropMedia | null>(null)
  // ── Skybox: a 360° equirect image rendered BY THE ENGINE (PhotoDome-style,
  // follows the camera; display-only, no lighting influence). ──
  const skyboxInputRef = useRef<HTMLInputElement | null>(null)
  const [skybox, setSkybox] = useState<BackdropMedia | null>(null)
  const onSkyboxPicked = async (file: File | undefined) => {
    if (!file) return
    try {
      const next = await probeBackdrop(file)
      engineRef.current?.setBackdropEquirect(await createImageBitmap(file))
      setSkybox((prev) => {
        releaseBackdrop(prev)
        return next
      })
      setBackdrop((prev) => {
        releaseBackdrop(prev)
        return null
      })
    } catch (e) {
      setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
    }
  }
  const removeSkybox = useCallback(() => {
    engineRef.current?.setBackdropEquirect(null)
    setSkybox((prev) => {
      releaseBackdrop(prev)
      return null
    })
  }, [engineRef])
  // Audio routing — one choice drives BOTH live playback and export (consistency):
  // "music" = the audio element, "none" = silent.
  const [audioSource, setAudioSource] = useState<ExportAudioSource>("music")
  // While an export runs it drives the same model clock the live mirrors watch —
  // suspend them (music + backdrop video) or they'd play, out of sync, during render.
  const [exporting, setExporting] = useState(false)
  // Green-screen (chroma-key) mode — LIVE, not export-only: the viewport previews
  // exactly what renders (pure green background; ground surface hidden, shadow per
  // the Ground > Shadow switch; backdrop/skybox suspended).
  const [greenScreen, setGreenScreen] = useState(false)
  // Live framing while the Render tab is open. The camera has a FIXED VERTICAL
  // FOV, so when the viewport is wider than the target aspect the export view is
  // exactly a center-crop of the normal render — the overlay's dimmed bars + border
  // mark that crop and the canvas is left completely untouched (nothing shifts).
  // Only when the viewport is NARROWER than the target (portrait phone, 16:9
  // target) does the export see more horizontally than the viewport can show —
  // then the canvas pins to the target aspect at screen scale and letterboxes
  // top/bottom via object-contain.
  const [framePreview, setFramePreview] = useState<FramePreview | null>(null)
  const [frameVp, setFrameVp] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!framePreview) {
      setFrameVp(null)
      return
    }
    const update = () => setFrameVp({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [framePreview])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (exporting) return // the export pins the full output resolution itself
    // Tolerance: a viewport a hair narrower than the target (browser chrome,
    // rounding) would otherwise pin and nudge the scene by a pixel or two for an
    // invisible accuracy gain. Only pin on a real mismatch (e.g. portrait phone).
    if (framePreview && frameVp && framePreview.aspect > (frameVp.w / frameVp.h) * FRAME_ASPECT_TOL) {
      const dpr = window.devicePixelRatio || 1
      engine.setRenderSize(Math.round(frameVp.w * dpr), Math.round((frameVp.w * dpr) / framePreview.aspect))
    } else {
      engine.setRenderSize(null)
    }
  }, [framePreview, frameVp, exporting, ready, engineRef])
  // Frame rect in CSS pixels (the canvas fills the window; object-contain centers).
  const frameRect =
    framePreview && frameVp
      ? (() => {
          const va = frameVp.w / frameVp.h
          const a = framePreview.aspect
          // Within tolerance the canvas isn't pinned and the frame IS the viewport
          // — snap to it, so a 16:9 target on a ~16:9 window hugs all four edges
          // exactly like 9:16 hugs top/bottom (no phantom 1–2px bars on one side).
          if (a <= va * FRAME_ASPECT_TOL && a >= va / FRAME_ASPECT_TOL) return { x: 0, y: 0, w: frameVp.w, h: frameVp.h }
          const w = a < va ? frameVp.h * a : frameVp.w
          const h = a < va ? frameVp.h : frameVp.w / a
          return { x: (frameVp.w - w) / 2, y: (frameVp.h - h) / 2, w, h }
        })()
      : null
  // Green mode suspends the skybox live (it renders inside the canvas and would
  // cover the green); leaving green mode restores it from the kept file.
  const skyboxRef = useRef(skybox)
  useEffect(() => {
    skyboxRef.current = skybox
  })
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (greenScreen) engine.setBackdropEquirect(null)
    else if (skyboxRef.current) {
      let stale = false
      void createImageBitmap(skyboxRef.current.file).then((b) => {
        if (!stale) engine.setBackdropEquirect(b)
      })
      return () => {
        stale = true
      }
    }
  }, [greenScreen, engineRef])
  const onBackdropPicked = async (file: File | undefined) => {
    if (!file) return
    try {
      const next = await probeBackdrop(file)
      setBackdrop((prev) => {
        releaseBackdrop(prev)
        return next
      })
      // Flat backdrop replaces the skybox (mutual exclusion, no layering surprises).
      engineRef.current?.setBackdropEquirect(null)
      setSkybox((prev) => {
        releaseBackdrop(prev)
        return null
      })
    } catch (e) {
      setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
    }
  }
  const removeBackdrop = useCallback(() => {
    setBackdrop((prev) => {
      releaseBackdrop(prev)
      return null
    })
  }, [])

  // ── Music: the scene's track, replaceable via upload. An <audio> element
  // (below) is the source; a rAF loop mirrors the model's animation clock onto it
  // so play/pause/seek/loop from the transport drive both. ──
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const [audioName, setAudioName] = useState<string | null>(bootScene.assets.audio?.name ?? null)
  const [audioSrc, setAudioSrc] = useState<string>(bootScene.assets.audio?.url ?? "")
  // High-level asset metadata (size for uploads; duration read from the engine /
  // audio element once available). Sizes are unknown for the bundled defaults.
  const [modelSize, setModelSize] = useState<number | null>(null)
  const [animDuration, setAnimDuration] = useState(0)
  const [animKeyframes, setAnimKeyframes] = useState(0)
  const [animSize, setAnimSize] = useState<number | null>(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [audioSize, setAudioSize] = useState<number | null>(null)

  const setMusicFile = (f: File) => {
    setAudioName(f.name)
    setAudioSize(f.size)
    setAudioSrc((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }
  const removeAudio = useCallback(() => {
    setAudioName(null)
    setAudioDuration(0)
    setAudioSize(null)
    // Revoke OUTSIDE the updater — a side effect inside setState's updater is
    // impure (updaters can re-run), and the compiler lint rejects memoizing it.
    if (audioSrc.startsWith("blob:")) URL.revokeObjectURL(audioSrc)
    setAudioSrc("")
    // No source left for the "music" audio option — exports fall back to silent.
    setAudioSource((s) => (s === "music" ? "none" : s))
  }, [audioSrc, setAudioName, setAudioDuration, setAudioSize, setAudioSrc, setAudioSource])


  // Animation duration + total bone keyframes appear whenever the async load
  // (VMD parse + setAnimation, or a fresh model the clip carries over to)
  // finishes — POLL until the engine reports them. A single deferred read raced
  // the load: losing left animDuration stuck at 0, which disabled the Render
  // button and made the range end clamp everything to 0:00.
  useEffect(() => {
    if (!animName) {
      setAnimDuration(0)
      setAnimKeyframes(0)
      return
    }
    let raf = 0
    const poll = () => {
      const model = engineRef.current?.getModel(modelName)
      const duration = model?.getAnimationProgress().duration ?? 0
      const clip = model?.getClip(animName) ?? null
      if (duration > 0 && clip) {
        setAnimDuration(duration)
        let kf = 0
        for (const track of clip.boneTracks.values()) kf += track.length
        setAnimKeyframes(kf)
        return
      }
      raf = requestAnimationFrame(poll)
    }
    raf = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(raf)
  }, [animName, modelName, engineRef])

  // Browsers block audio until the user interacts — start the track on the first
  // gesture, synced to wherever the animation already is. Keydown counts too:
  // a Space-press IS a valid user activation (autoplay-wise), and gating on
  // pointerdown alone left Space-started playback silent until the first click.
  const userInteracted = useRef(false)
  useEffect(() => {
    const on = () => {
      userInteracted.current = true
      window.removeEventListener("pointerdown", on)
      window.removeEventListener("keydown", on)
    }
    window.addEventListener("pointerdown", on)
    window.addEventListener("keydown", on)
    return () => {
      window.removeEventListener("pointerdown", on)
      window.removeEventListener("keydown", on)
    }
  }, [])

  // Load the scene's motion once its model is ready (custom uploads don't
  // re-trigger `ready`, so this runs for the booted scene only).
  const sceneAnimLoaded = useRef(false)
  useEffect(() => {
    const clip = bootScene.assets.animation
    if (!ready || !clip || sceneAnimLoaded.current) return
    sceneAnimLoaded.current = true
    animSourceRef.current = { kind: "url", name: clip.name, url: clip.url }
    void loadVmdUrl(clip.name, clip.url).then((n) => {
      if (n) setAnimName(n)
    })
  }, [ready, loadVmdUrl, bootScene])

  // Mirror the animation clock onto the audio element (model is the master).
  // Audio FREE-RUNS while playing — currentTime is written only at discrete
  // events: play start, a master-clock jump (scrub while playing / transport
  // loop restart), or drift beyond 0.5s. Per-frame drift-threshold seeking
  // (the old 0.2s check) was a seek storm on iOS, where currentTime is coarse
  // and the audio pipeline laggy — audible flicker/jitter. Same policy that
  // fixed the video backdrop; also how the engine's web preview stays smooth.
  useEffect(() => {
    const audio = audioElRef.current
    if (!audio) return
    if (!animName || exporting) {
      audio.pause()
      return
    }
    let raf = 0
    let wasPlaying = false
    let lastModelTime = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(modelName)?.getAnimationProgress()
      if (!p) return
      const playing = p.playing && userInteracted.current
      // A frame advances the clock ≤ ~0.05s — anything bigger is a discrete jump.
      const jumped = lastModelTime >= 0 && Math.abs(p.current - lastModelTime) > 0.35
      lastModelTime = p.current
      if (playing) {
        if (!wasPlaying) {
          audio.currentTime = p.current
          void audio.play().catch(() => {})
        } else if (!audio.seeking && (jumped || Math.abs(audio.currentTime - p.current) > 0.5)) {
          audio.currentTime = p.current
        }
      } else if (!audio.paused) {
        audio.pause()
      }
      wasPlaying = playing
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animName, modelName, engineRef, exporting])

  // The file's path: folder picks carry webkitRelativePath; zip-expanded /
  // dropped / flat files carry the path (or bare name) in `name`.
  const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name

  // ONE model pipeline for every source — folder pick (desktop dialog), flat
  // multi-select (mobile), .zip (mobile's sane path: models ship as zips, and a
  // zip preserves the subfolder structure a flat pick can't), and drag & drop.
  const handleModelFiles = async (list: File[]) => {
    if (!list.length) return
    let files: File[]
    try {
      files = await expandUploadFiles(list)
    } catch (e) {
      setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
      return
    }
    const pmxs = files.filter((f) => f.name.toLowerCase().endsWith(".pmx"))
    if (pmxs.length === 0) setUpload({ kind: "notice", message: t.upload.noPmx })
    else if (pmxs.length === 1) await loadCustom(files, pmxs[0])
    else setUpload({ kind: "pick", files, paths: pmxs.map(relPath).sort((a, b) => a.localeCompare(b)) })
  }

  // ── Scene settings → engine, guarded PER SECTION by object identity. patch()
  // in the Scene panel replaces only the edited section, so untouched sections
  // keep their identity and their pushes are skipped. This is not a micro-opt:
  // setSun marks the shadow map dirty (an extra full scene pass per frame), so
  // the old unguarded push re-rendered shadows on every tick of ANY slider —
  // bloom included. First run after `ready` pushes everything (prev starts null).
  const prevPushed = useRef<{ settings: SceneSettings; backdrop: boolean; greenScreen: boolean } | null>(null)
  // addGround has no light-update path — it recreates GPU buffers + a bind group
  // per call — so ground edits coalesce to at most one rebuild per frame, applied
  // from the latest options at frame time (a drag can tick faster than rAF).
  const groundOptsRef = useRef<Parameters<NonNullable<typeof engineRef.current>["addGround"]>[0] | null>(null)
  const groundRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(groundRaf.current), [])
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current
    if (!engine) return
    const { world, sun, bloom, background, ground } = sceneSettings
    const prev = prevPushed.current
    const modeChanged = !prev || prev.backdrop !== !!backdrop || prev.greenScreen !== greenScreen
    // The engine paints the background (post-tonemap, exact CSS-hex match) — except
    // while a backdrop image is set, where the canvas must stay transparent so the
    // DOM image layer behind it shows through. Green-screen mode overrides both.
    if (modeChanged || prev.settings.background !== background) {
      engine.setBackgroundColor(
        greenScreen ? hexToSrgbVec3("#00ff00") : backdrop ? null : hexToSrgbVec3(background.color),
      )
    }
    if (!prev || prev.settings.world !== world) {
      engine.setWorld({ color: hexToLinearVec3(world.color), strength: world.strength })
    }
    if (!prev || prev.settings.sun !== sun) {
      engine.setSun({
        color: hexToLinearVec3(sun.color),
        strength: sun.strength,
        direction: azElToDirection(sun.azimuth, sun.elevation),
      })
    }
    if (!prev || prev.settings.bloom !== bloom) {
      engine.setBloomOptions({
        enabled: bloom.enabled,
        threshold: bloom.threshold,
        knee: bloom.knee,
        radius: bloom.radius,
        intensity: bloom.intensity,
        color: hexToLinearVec3(bloom.color),
      })
    }
    // Green mode hides the ground SURFACE (it would occlude the key) but keeps the
    // shadow-catcher shadow per the user's Shadow switch.
    if (modeChanged || prev.settings.ground !== ground) {
      groundOptsRef.current = {
        diffuseColor: hexToLinearVec3(ground.color),
        gridLineColor: hexToLinearVec3(ground.grid),
        opacity: greenScreen ? 0 : ground.opacity,
        shadowStrength: ground.shadow ? 1 : 0,
        gridLineOpacity: greenScreen || !ground.gridEnabled ? 0 : 0.4,
      }
      if (!groundRaf.current) {
        groundRaf.current = requestAnimationFrame(() => {
          groundRaf.current = 0
          if (groundOptsRef.current) engineRef.current?.addGround(groundOptsRef.current)
        })
      }
    }
    prevPushed.current = { settings: sceneSettings, backdrop: !!backdrop, greenScreen }
  }, [sceneSettings, ready, engineRef, backdrop, greenScreen])

  // ── Working scene → localStorage. The `state` half only: assets are blob: URLs
  // backed by File objects and would restore dead, so lib/scene.ts keeps them out
  // structurally (and SceneState being a total type means adding a field breaks
  // this call site rather than silently dropping it).
  //
  // Gated on `ready` because `groups` is [] until the engine finishes booting —
  // saving that would clobber a stored group list with an empty one before the
  // restore ever lands. `groupsFor` records which model the graphs were authored
  // against, so a reload after a model upload falls back to auto-grouping instead
  // of restoring groups naming materials this model doesn't have.
  // (`camera` is authored framing, not live orbit — the engine exposes distance
  // but no target getter, so orbiting still isn't captured.)
  //
  // DEBOUNCED *and* deferred to idle, because this write is genuinely expensive:
  // the payload carries every group's shader graph (~30 KB serialized) and
  // localStorage.setItem is synchronous, so it blocks whatever frame it lands in.
  // Debouncing alone wasn't enough — a pause mid-drag outlasted the window and
  // fired the write while the user was still dragging. requestIdleCallback makes
  // that impossible: the write waits for a free main thread no matter when the
  // timer elapses. The timeout bounds the wait so a busy tab still saves.
  useEffect(() => {
    if (!ready) return
    let idle = 0
    const timer = setTimeout(() => {
      const write = () =>
        saveSceneState({
          name: bootScene.state.name,
          camera: bootScene.state.camera,
          settings: sceneSettings,
          groups,
          groupsFor: modelName,
        })
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(write, { timeout: 2000 })
          : (setTimeout(write, 0) as unknown as number)
    }, SAVE_SETTLE_MS)
    return () => {
      clearTimeout(timer)
      if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle)
    }
  }, [ready, sceneSettings, groups, modelName, bootScene])

  // Stable handlers for the memoized AssetsPanel. These were inline arrows on
  // the JSX — new identity every render, which defeats memo, and with keep-alive
  // docks a defeated memo means the HIDDEN Assets tab re-rendered on every page
  // render (each tick of a settings slider drag included). They only touch refs
  // and setters, so identity never needs to change.
  const pickModel = useCallback(() => (isMobile ? zipInputRef.current : folderInputRef.current)?.click(), [isMobile])
  const pickModelZip = useCallback(() => zipInputRef.current?.click(), [])
  const pickAnimation = useCallback(() => vmdInputRef.current?.click(), [])
  const pickCamera = useCallback(() => cameraInputRef.current?.click(), [])
  const pickMusic = useCallback(() => audioInputRef.current?.click(), [])
  const pickBackdrop = useCallback(() => backdropInputRef.current?.click(), [])
  const pickSkybox = useCallback(() => skyboxInputRef.current?.click(), [])
  const removeAnimation = useCallback(() => {
    stopAnimation()
    setAnimName(null)
    animSourceRef.current = null // don't resurrect it on the next model upload
  }, [stopAnimation])

  // ── Dock tab definitions ── LEFT = styling (materials, scene look); RIGHT =
  // ingredients & output (assets in, render out).
  const leftTabs: DockTab[] = [
    {
      id: "materials",
      label: t.tabs.materials,
      icon: MaterialSphereIcon,
      content: (
        <MaterialsPanel
          materials={materials}
          groups={groups}
          activeGroupId={activeGroupId}
          onHover={highlight}
          onToggleVisible={toggleVisible}
          onOpenLibrary={openLibrary}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onSetActiveGroup={setActiveGroupId}
          onEditGroupGraph={editGroupGraph}
          onMoveMaterial={moveMaterial}
        />
      ),
    },
    { id: "scene", label: t.tabs.scene, icon: Sun, content: <ScenePanel
          settings={sceneSettings}
          onChange={setSceneSettings}
          onUndo={sceneHistory.undo}
          onRedo={sceneHistory.redo}
          canUndo={sceneHistory.canUndo}
          canRedo={sceneHistory.canRedo}
        /> },
  ]

  const rightTabs: DockTab[] = [
    {
      id: "assets",
      label: t.tabs.assets,
      icon: Package,
      content: (
        <AssetsPanel
          modelFile={modelFile}
          animName={animName}
          cameraName={cameraName}
          audioName={audioName}
          modelMeta={`${t.assets.metaModel(modelStats.vertices.toLocaleString("en-US"), modelStats.bones, modelStats.materials)}${modelSize ? ` · ${fmtSize(modelSize)}` : ""}`}
          animMeta={
            animName
              ? [fmtDur(animDuration), animKeyframes ? t.assets.metaKeyframes(animKeyframes.toLocaleString("en-US")) : "", animSize ? fmtSize(animSize) : ""]
                  .filter(Boolean)
                  .join(" · ")
              : ""
          }
          cameraMeta={cameraName && cameraSize != null ? fmtSize(cameraSize) : ""}
          audioMeta={audioName ? [fmtDur(audioDuration), audioSize ? fmtSize(audioSize) : ""].filter(Boolean).join(" · ") : ""}
          backdropName={backdrop?.name ?? null}
          backdropMeta={backdrop ? `${backdrop.width}×${backdrop.height}` : ""}
          skyboxName={skybox?.name ?? null}
          skyboxMeta={skybox ? `${skybox.width}×${skybox.height} · 360°` : ""}
          modelUploadLabel={isMobile ? t.assets.uploadModelZip : t.assets.uploadModelFolder}
          onUploadModel={pickModel}
          onUploadModelZip={isMobile ? undefined : pickModelZip}
          onUploadAnimation={pickAnimation}
          onUploadCamera={pickCamera}
          onUploadMusic={pickMusic}
          onRemoveMusic={removeAudio}
          onUploadBackdrop={pickBackdrop}
          onUploadSkybox={pickSkybox}
          onRemoveAnimation={removeAnimation}
          onRemoveCamera={removeCamera}
          onRemoveBackdrop={removeBackdrop}
          onRemoveSkybox={removeSkybox}
        />
      ),
    },
    {
      id: "render",
      label: t.tabs.render,
      icon: Clapperboard,
      content: (
        <RenderPanel
          active={rightTab === "render"}
          engineRef={engineRef}
          canvasRef={canvasRef}
          modelName={modelName}
          sceneName={t.brand.untitledScene}
          animName={animName}
          animDuration={animDuration}
          backdrop={backdrop}
          backgroundColor={sceneSettings.background.color}
          musicUrl={audioSrc || null}
          audioSource={audioSource}
          onAudioSourceChange={setAudioSource}
          greenScreen={greenScreen}
          onGreenScreenChange={setGreenScreen}
          onExportingChange={setExporting}
          onFramePreviewChange={setFramePreview}
        />
      ),
    },
  ]

  // Drag & drop anywhere: a single .vmd routes to the animation, audio to music,
  // an image to the backdrop; anything else (folder, zip, file set) is a model.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dt = e.dataTransfer
    void (async () => {
      const files = dt.items?.length ? await readDroppedFiles(dt.items) : Array.from(dt.files ?? [])
      if (!files.length) return
      if (files.length === 1) {
        const f = files[0]
        const n = f.name.toLowerCase()
        if (n.endsWith(".vmd")) {
          setAnimSize(f.size)
          animSourceRef.current = { kind: "file", file: f }
          setAnimName(await loadVmdFile(f))
          return
        }
        if (f.type.startsWith("audio/")) {
          setMusicFile(f)
          return
        }
        if (f.type.startsWith("image/")) {
          await onBackdropPicked(f)
          return
        }
      }
      await handleModelFiles(files)
    })()
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 overflow-hidden text-sm text-foreground select-none"
      style={{ backgroundColor: sceneSettings.background.color }}
      suppressHydrationWarning
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* ── Backdrop layer: page bg color → image (cover) → transparent canvas.
          Export composites the SAME stack (lib/video-export), so live and
          rendered output match. ── */}
      {backdrop && !greenScreen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backdrop.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* object-contain: normally a no-op (buffer aspect ≡ box aspect), but during
          video export the buffer is pinned to the OUTPUT aspect (e.g. 9:16 on a wide
          screen) — contain letterboxes it instead of stretching. */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {/* ── Video-frame overlay (Render tab open / exporting): dimmed bars outside
          the letterboxed frame, a border at its edge, and the watermark previewed
          exactly where the export draws it. Pure DOM — pointer-events-none. ── */}
      {frameRect && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute bg-black/45" style={{ left: 0, right: 0, top: 0, height: frameRect.y }} />
          <div className="absolute bg-black/45" style={{ left: 0, right: 0, bottom: 0, height: frameRect.y }} />
          <div className="absolute bg-black/45" style={{ left: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }} />
          <div className="absolute bg-black/45" style={{ right: 0, top: frameRect.y, width: frameRect.x, height: frameRect.h }} />
          {/* Capture-tool convention: amber = framed (composing), red = recording. */}
          <div
            className={cn(
              "absolute rounded-sm border",
              exporting ? "border-red-500/90" : "border-amber-400/80",
            )}
            style={{ left: frameRect.x, top: frameRect.y, width: frameRect.w, height: frameRect.h }}
          />
          {framePreview?.watermark &&
            (() => {
              // Mirrors drawWatermark's metrics (lib/video-export.ts): 2.8%-height
              // Geist Medium, wide tracking, soft shadow, 2.2% padding, top-left.
              const size = Math.max(14, frameRect.h * 0.028)
              const pad = frameRect.h * 0.022
              return (
                <div
                  className="absolute font-medium"
                  style={{
                    left: frameRect.x + pad,
                    top: frameRect.y + pad,
                    fontSize: size,
                    letterSpacing: size * 0.22,
                    color: "rgba(255,255,255,0.88)",
                    textShadow: `0 ${size * 0.08}px ${size * 0.6}px rgba(0,0,0,0.5)`,
                  }}
                >
                  REZE DESIGN
                </div>
              )
            })()}
        </div>
      )}

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xs">
            <span className="size-2 animate-pulse rounded-full bg-blue-400" />
            {t.editor.loadingModel}
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-xs text-red-400 backdrop-blur-xs">
            {t.editor.engineError(error)}
          </div>
        </div>
      )}

      {/* ── Left column: full-height flush dock when expanded (brand pill is its
          header); a floating pill on its own when collapsed. ── */}
      {mounted &&
        (docksOpen ? (
          <div className="fixed inset-y-0 left-0 z-20 w-[min(300px,88vw)]">
            <LeftDock
              railTop={<RailLogo />}
              header={
                <BrandPill
                  sceneName={t.brand.untitledScene}
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
            <BrandPill sceneName={t.brand.untitledScene} docksOpen={false} onToggleDocks={() => setDocksOpen(true)} />
          </div>
        ))}

      {/* ── Right column: full-height flush dock when expanded (account/play/share
          cluster is its header); floating pills when collapsed. ── */}
      {mounted &&
        (docksOpen ? (
          <div className="fixed inset-y-0 right-0 z-20 w-[min(300px,88vw)]">
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
              {t.editor.selectMaterial}
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

      {/* ── Persistent transport bar — always present (inert with no clip, so
          removing the animation doesn't blink the UI away). ── */}
      {mounted && !drawerFull && (
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
      {/* Model upload — two COMPLETE paths only (flat multi-select was dropped:
          it can't carry subfolders). Desktop: folder picker; a .zip also works
          via drag & drop. Mobile: the model's .zip (extracted in-app, subfolders
          preserved — models are distributed as zips anyway). */}
      <input
        ref={(el) => {
          folderInputRef.current = el
          el?.setAttribute("webkitdirectory", "")
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleModelFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
      {/* Model .zip picker — the mobile primary, and desktop's ZIP button (a
          folder dialog can't pick files, hence the separate input). */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          void handleModelFiles(Array.from(e.target.files ?? []))
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
        ref={backdropInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onBackdropPicked(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <input
        ref={skyboxInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onSkyboxPicked(e.target.files?.[0])
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
          if (f) setMusicFile(f)
          e.target.value = ""
        }}
      />
      {/* Audio source — driven (play/pause/seek) by the animation-clock mirror above.
          Muted when audio is set to None — same routing the export uses, so what
          you hear is what renders. */}
      <audio
        ref={audioElRef}
        src={audioSrc || undefined}
        preload="auto"
        playsInline
        muted={audioSource !== "music"}
        className="hidden"
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
      />
      <Dialog open={upload !== null} onOpenChange={(o) => !o && setUpload(null)}>
        <DialogContent className="max-w-sm rounded-xl border-white/10 bg-zinc-950/95 backdrop-blur-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {upload?.kind === "pick" ? t.upload.pickModel : t.upload.cantLoad}
            </DialogTitle>
          </DialogHeader>
          {upload?.kind === "pick" ? (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {upload.paths.map((path) => (
                <button
                  key={path}
                  className="block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 hover:text-foreground"
                  onClick={() => {
                    const pmx = upload.files.find((f) => relPath(f) === path)
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
