"use client"

// Immersive editor (home).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  DEFAULT_GRAPH,
  compileGraph,
  type CompileOptions,
  type Diagnostic,
  type MaterialPreset,
  type ShaderGraph,
  type StyleGroup,
} from "reze-engine"
import { BookOpen, Clapperboard, GalleryThumbnails, Package, Sun, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { GraphEditor } from "@/components/graph/graph-editor"
import { AnimPlayer } from "@/components/scene/anim-player"
import { MaterialsPanel } from "@/components/scene/material-sidebar"
import { ScenePanel } from "@/components/scene/scene-sidebar"
import { AssetsPanel, type CharacterCardData } from "@/components/editor/assets-panel"
import { BrandPill, RailLogo, TopRightCluster } from "@/components/editor/editor-chrome"
import { LeftDock, RightDock, type DockTab } from "@/components/editor/dock"
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
import { BackgroundLibrary } from "@/components/editor/background-library"
import { WgslEditorPanel } from "@/components/editor/wgsl-editor"
import { NodeLibrary } from "@/components/editor/node-library"
import { RenderPanel, type FramePreview } from "@/components/editor/render-panel"
import { useEngine } from "@/hooks/use-engine"
import { useSceneSync } from "@/hooks/use-scene-sync"
import { RaisableLayer } from "@/components/editor/raisable-layer"
import { useHistory } from "@/hooks/use-history"
import { probeBackdrop, releaseBackdrop, type BackdropMedia } from "@/lib/backdrop"
import { expandUploadFiles, readDroppedFiles } from "@/lib/uploads"
import { useT } from "@/lib/i18n"
import type { ExportAudioSource } from "@/lib/video-export"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { DEFAULT_SCENE } from "@/lib/default-scene"
import { groupLabel, GRAPH_LIBRARY, libraryGraph, SLOT_GRAPHS } from "@/lib/materials"
import type { AppliedBackgroundEffect } from "@/lib/background-effects"
import { GRADE_PRESETS, NEUTRAL_SPEC, gradeSpec, recallIntensity, specOf } from "@/lib/grade"
import {
  quickPickItems,
  type EffectItem,
  type GradeItem,
  type GraphItem,
  type LibraryFacet,
  type ScenePayload,
} from "@/lib/library"
import { communityItems, useCommunity } from "@/hooks/use-community"
import { prefetchLibraryStats } from "@/hooks/use-library-stats"
import { forkTarget } from "@/lib/fork"
import { resolveSceneRefs } from "@/lib/resolve-refs"
import { effectRef, gradeRef, graphRef } from "@/lib/refs"
import { useDrafts } from "@/hooks/use-drafts"
import { useSession } from "@/lib/auth-client"
import { createDraft, isDraft, loadDrafts, nextDraftName, updateDraft } from "@/lib/drafts"
import { applyDefaults, BACKGROUND_EFFECTS, builtinEffect } from "@/lib/background-effects"
import { GradeLibrary } from "@/components/editor/grade-library"
import { GradeEditorPanel, type GradeEditorSubject } from "@/components/editor/grade-editor"
import { SaveCloseDialog } from "@/components/editor/save-close"
import { captureScene } from "@/components/editor/grade-preview"
import {
  hydrateScene,
  newSceneId,
  parseSceneDoc,
  saveSceneState,
  serializeSceneDoc,
  type Scene,
  type AssetRef,
  type ModelSource,
  type SceneBackground,
  type SceneCamera,
  type SceneModel,
} from "@/lib/scene"
import { modelFilePaths, sceneFiles } from "@/lib/scene-files"
import type { BundleEntry } from "@/lib/bundle"
import { ShareSceneDialog, type ScenePublishSource } from "@/components/editor/share-scene"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HandleDialog } from "@/components/editor/account-panel"
import { LoadingPill } from "@/components/editor/loading-pill"
import { SceneGallery, prefetchGallery } from "@/components/editor/scene-gallery"
import type { SceneSettings } from "@/lib/scene-settings"
import { cn } from "@/lib/utils"

// The manual lives in the repo, not in a dialog: it is going to grow past what a
// popup can hold, it wants images and cross-links, and keeping it beside the code
// means it can be read, corrected and translated by anyone who can open a PR.
const MANUAL_URL = "https://github.com/AmyangXYZ/reze-design/blob/main/docs/manual/en.md"

// Frame preview: how far the viewport's aspect may deviate from the export target before
const FRAME_ASPECT_TOL = 1.03

// How long edits settle before the working scene is written to localStorage.
const SAVE_SETTLE_MS = 1000

/** Appended when someone's scene is opened in your editor, so the two are never
 *  confused for each other in the title bar or in the publish dialog. */
const FORK_SUFFIX = " - fork"

/** A rail entry that opens a surface. Shaped like a tab so the rail reads as one
 *  column, but it never becomes the active tab — it opens something over it. */
function RailAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full cursor-pointer flex-col items-center gap-1.5 py-0.5">
      <span className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-white/[0.05]">
        <Icon className="size-4.5" />
      </span>
      <span className="text-[9px] leading-none font-medium text-muted-foreground">{label}</span>
    </button>
  )
}

/** Bottom-cluster utility: icon only, like the language and GitHub buttons. */
function RailUtility({
  icon: Icon,
  label,
  onClick,
  href,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  /** Opens elsewhere instead of acting here — a new tab, like the GitHub mark below. */
  href?: string
}) {
  const cls =
    "flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" aria-label={label} className={cls}>
            <Icon className="size-4.5" />
          </a>
        ) : (
          <button onClick={onClick} aria-label={label} className={cls}>
            <Icon className="size-4.5" />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Community rows for a quick-pick: a few, plus whatever is applied. */
function communityQuickPick(items: { name: string }[], applied: string | null) {
  const shown = items.slice(0, 3)
  if (applied && !shown.some((i) => i.name === applied)) {
    const hit = items.find((i) => i.name === applied)
    if (hit) shown.push(hit)
  }
  return shown.map((i) => ({ id: i.name, label: i.name, section: "community" as const }))
}

/**
 * How a new draft relates to whatever it was edited from: your own published item
 * (publishing updates it) or someone else's (publishing forks it). Neither, for
 * a built-in or a from-scratch creation — those simply become new items.
 */
function origin(community: { id: string; mine: boolean }[], editedId: string) {
  const hit = community.find((i) => i.id === editedId)
  if (!hit) return {}
  return hit.mine ? { sourceId: hit.id } : { forkedFromId: hit.id }
}

// Unique kebab id for a new (peeled / created) style group.
const newGroupId = (material: string, groups: StyleGroup[]): string => {
  const base = material.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group"
  const ids = new Set(groups.map((g) => g.id))
  if (!ids.has(base)) return base
  let i = 1
  while (ids.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

const UI_KEY = "reze-design.ui"
function loadUiState(): { docks: boolean; leftTab: string; rightTab: string } {
  // Mobile first-open: docks closed — two 300px docks bury a phone viewport
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
// The WGSL editor floats like the graph editor; its rect persists the same way.
const GRADE_PANEL_KEY = "reze-design.gradePanel"
function loadGradePanelRect(): Rect | null {
  try {
    const raw = window.localStorage.getItem(GRADE_PANEL_KEY)
    return raw ? (JSON.parse(raw) as Rect) : null
  } catch {
    return null
  }
}

const WGSL_PANEL_KEY = "reze-design.wgslPanel"
function loadWgslPanelRect(): Rect | null {
  try {
    const raw = window.localStorage.getItem(WGSL_PANEL_KEY)
    return raw ? (JSON.parse(raw) as Rect) : null
  } catch {
    return null
  }
}
// Default: the same bottom-centered rect the graph editor opens
function defaultWgslPanelRect(): Rect {
  return defaultPanelRect()
}

// First-open default: bottom-centered, roughly where the old docked drawer sat, clamped
function defaultPanelRect(): Rect {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(360, Math.min(vw - 648, 1200, vw - 48))
  const h = Math.min(460, vh - 96)
  return { x: Math.round((vw - w) / 2), y: Math.max(8, vh - h - 76), w, h }
}

/**
 * The editor. Normally opens on the bundled demo merged with your stored edits;
 * given a scene it opens on that instead — which is what Fork does, so a forked
 * scene lands in the same tool rather than a second, lesser one.
 */
function Editor({ initialScene, forkedFrom }: { initialScene?: Scene; forkedFrom?: string }) {
  const t = useT()
  // Which style group the node-graph editor is bound to.
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // Node-graph library popup, opened for a specific material.
  const [library, setLibrary] = useState<{ open: boolean; groupId: string | null }>({ open: false, groupId: null })
  // Bumped on library-pick to remount the graph editor with the new graph.
  const [libVersion, setLibVersion] = useState(0)
  // The graph the editing session started

  // Dock + tab state persists
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

  // Docks join the same stacking order as the floating panels, so clicking one raises it over

  const [drawerOpen, setDrawerOpen] = useState(false)
  // Bumped per open so the panel RAISES each time — it stays mounted while closed,
  // so without this bringToFront only ever ran on first mount and opening the
  // editor from a library left the library stacked on top.
  const [graphSession, setGraphSession] = useState(0)
  // Standalone graph-editing session (library act, no group) — state lives up
  // here because opening the group editor must end it; handlers live with the
  // other library-editing flows below.
  const [graphLibEdit, setGraphLibEdit] = useState<{
    sessionId: number
    id: string
    name: string
    opened: ShaderGraph
    savePrompt: boolean
  } | null>(null)
  const graphLibLatest = useRef<ShaderGraph | null>(null)
  const openGraphEditor = useCallback(() => {
    setGraphLibEdit(null)
    setGraphSession((v) => v + 1)
    setDrawerOpen(true)
  }, [])
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
  // Per-model animation: each model owns its clip (engine clips are per instance).
  type AnimSource = { kind: "file"; file: File } | { kind: "url"; name: string; url: string }
  type AnimEntry = { name: string; size: number | null; source: AnimSource }
  // Where an upload routes: a new cast member, or swapping one out in place.
  type ModelTarget = { mode: "add" } | { mode: "replace"; id: string }
  const [animByModel, setAnimByModel] = useState<Record<string, AnimEntry>>({})
  const [animMetaByModel, setAnimMetaByModel] = useState<Record<string, { duration: number; keyframes: number }>>({})
  // The boot document: the bundled demo with the user's stored values merged over it.
  // A forked scene boots as published — NOT merged with your stored state, which
  // belongs to whatever you were working on before.
  const [bootScene] = useState(() => initialScene ?? hydrateScene(DEFAULT_SCENE))
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(bootScene.state.settings)
  const [sceneCamera, setSceneCamera] = useState<SceneCamera>(bootScene.state.camera)
  const [sceneName, setSceneName] = useState(bootScene.state.name)
  // Undo/redo for the Scene panel — also the fallback scope, so ⌘Z with nothing
  // focused still edits the scene the way it always has.
  useHistory(sceneSettings, setSceneSettings, { scope: "scene", fallback: true })
  // suppressHydrationWarning makes React SKIP patching the server-rendered style (SSR uses
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.style.setProperty("background-color", sceneSettings.background.color)
  }, [sceneSettings.background.color])

  const {
    canvasRef,
    engineRef,
    ready,
    error,
    models,
    groupsByModel,
    upsertGroup: upsertGroupFor,
    applyGroups: applyGroupsFor,
    resetStyleGroups,
    bundleFiles,
    setCameraView,
    highlight: highlightFor,
    toggleVisible: toggleVisibleFor,
    addModelFromFiles,
    replaceModelFromFiles,
    removeModelById,
    loadVmdFile,
    loadVmdUrl,
    stopAnimation,
  } = useEngine(bootScene)

  // Active model: the one the Materials tab + graph editor edit.
  const [activeModelId, setActiveModelId] = useState(bootScene.assets.models[0].model.id)
  const activeModel = models.find((m) => m.id === activeModelId) ?? models[0] ?? null
  const activeId = activeModel?.id ?? activeModelId
  // The EFFECTIVE id (falls back to models[0] after a removal)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])
  const materials = activeModel?.materials ?? []
  const groups = useMemo(() => groupsByModel[activeId] ?? [], [groupsByModel, activeId])
  // Single-model signatures over the ACTIVE model
  const upsertGroup = useCallback(
    (group: StyleGroup, opts?: CompileOptions) => upsertGroupFor(activeIdRef.current, group, opts),
    [upsertGroupFor],
  )
  const applyGroups = useCallback((next: StyleGroup[]) => applyGroupsFor(activeIdRef.current, next), [applyGroupsFor])
  // Undo for the Materials panel. Restoring re-applies through the engine, so an
  // undone grouping recompiles exactly like a hand-made one.
  useHistory(groups, applyGroups, { scope: "materials", resetKey: activeId })
  const highlight = useCallback((m: string | null) => highlightFor(activeIdRef.current, m), [highlightFor])
  const toggleVisible = useCallback((name: string) => toggleVisibleFor(activeIdRef.current, name), [toggleVisibleFor])
  const selectModel = useCallback((id: string) => setActiveModelId(id), [])

  // Leaving the Materials tab clears any lingering hover/pick highlight.
  useEffect(() => {
    if (leftTab !== "materials") highlight(null)
  }, [leftTab, highlight])


  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null
  const libGroup = groups.find((g) => g.id === library.groupId) ?? null
  // Factory preset for the active group (for Reset). Resolves the LIBRARY entry the
  // group's graph came from — never the group's live graph, which made Reset restore
  // the current state for any group whose id isn't a built-in role key.
  const presetGraph = activeGroup
    ? (GRAPH_LIBRARY.find((e) => e.name === activeGroup.graph?.name)?.payload.graph ??
      SLOT_GRAPHS[activeGroup.id as MaterialPreset] ??
      DEFAULT_GRAPH)
    : null

  // Graph editor's onApply: compile + swap the edited graph onto the active group.
  const applyActiveGraph = useCallback(
    (graph: ShaderGraph, opts?: CompileOptions): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> =>
      activeGroup ? upsertGroup({ ...activeGroup, graph }, opts) : Promise.resolve({ ok: false, diagnostics: [] }),
    [activeGroup, upsertGroup],
  )

  // Apply a library shader graph to the target style group.
  const applyLibrary = (graph: ShaderGraph, name: string) => {
    const group = groups.find((g) => g.id === library.groupId)
    if (!group) return
    const styled: ShaderGraph = { ...graph, name }
    // Apply the library graph but keep the group's own name
    const updated: StyleGroup = { ...group, graph: styled }
    // Empty groups can't compile
    if (updated.materials.length) void upsertGroup(updated)
    else void applyGroups(groups.map((x) => (x.id === group.id ? updated : x)))
    setActiveGroupId(group.id)
    setLibVersion((v) => v + 1)
    setLibrary({ open: false, groupId: null })
  }

  // Graph-editor session lifecycle ── Edits preview live on the active group.
  // Close keeps the edits, like the other two editors. Undoing is ⌘Z, and the
  // header's reset-to-preset covers starting over.
  const closeGraphEdit = () => setDrawerOpen(false)

  // Standalone graph editing: same scratchpad contract as the grade/effect
  // editors — edits compile purely (compileGraph needs no engine), and only
  // save-on-close writes a draft.
  const openGraphLibEdit = (id: string, name: string, graph: ShaderGraph) => {
    graphLibLatest.current = null
    setGraphLibEdit((prev) => ({ sessionId: (prev?.sessionId ?? 0) + 1, id, name, opened: graph, savePrompt: false }))
    setGraphSession((v) => v + 1) // raiseKey: the drawer must surface above the library
    setDrawerOpen(true)
  }
  const compileStandalone = (graph: ShaderGraph): Promise<{ ok: boolean; diagnostics: Diagnostic[] }> => {
    graphLibLatest.current = graph
    const r = compileGraph(graph)
    return Promise.resolve({ ok: r.ok, diagnostics: r.diagnostics })
  }
  const freeGraphName = (wanted: string, keepId?: string) =>
    nextDraftName(wanted, [
      ...GRAPH_LIBRARY.map((g) => g.name),
      ...loadDrafts().graph.filter((d) => d.id !== keepId).map((d) => d.name),
    ])
  const requestCloseGraphDrawer = () => {
    if (!graphLibEdit) {
      setDrawerOpen(false)
      return
    }
    const latest = graphLibLatest.current ?? graphLibEdit.opened
    if (JSON.stringify(latest) === JSON.stringify(graphLibEdit.opened)) {
      setGraphLibEdit(null)
      setDrawerOpen(false)
      return
    }
    // An existing draft saves in place — unless it stopped compiling, in which
    // case the dialog surfaces the refusal instead of silently keeping a dud.
    if (isDraft("graph", graphLibEdit.id) && saveGraphLibEdit(graphLibEdit.name) === null) return
    setGraphLibEdit({ ...graphLibEdit, savePrompt: true })
  }
  const saveGraphLibEdit = (wanted: string): string | null => {
    if (!graphLibEdit) return null
    const keep = isDraft("graph", graphLibEdit.id) ? graphLibEdit.id : undefined
    const name = freeGraphName(wanted, keep)
    const graph = { ...(graphLibLatest.current ?? graphLibEdit.opened), name }
    // Same rule as effects: a graph that doesn't compile doesn't get saved.
    const r = compileGraph(graph)
    if (!r.ok) {
      const err = r.diagnostics.find((d) => d.severity === "error")
      return err?.message ?? "compile failed"
    }
    if (keep) updateDraft("graph", keep, { name, payload: { graph } })
    else
      createDraft("graph", {
        name,
        payload: { graph },
        author: authorName,
        ...origin(communityGraphs, graphLibEdit.id),
      })
    setGraphLibEdit(null)
    setDrawerOpen(false)
    return null
  }
  const discardGraphLibEdit = () => {
    setGraphLibEdit(null)
    setDrawerOpen(false)
  }


  // Group operations (structural edits go through applyGroups) ── Returns the new id
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
  // Non-empty groups compile through upsertGroup (one group)
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
  // Move a material into a group (target=null → ungroup).
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
      openGraphEditor()
    },
    [groups, openGraphEditor],
  )

  // ── Model upload ──
  type UploadState =
    | { kind: "pick"; files: File[]; paths: string[]; target: ModelTarget }
    | { kind: "notice"; message: string }
    | null
  const [upload, setUpload] = useState<UploadState>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  // Where the folder/zip inputs route their pick (set before opening the dialog).
  const modelTargetRef = useRef<ModelTarget>({ mode: "add" })
  // Mobile: no folder pickers exist, so the model button is zip-only there.
  const [isMobile] = useState(() => typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent))

  const loadCustom = async (files: File[], pmxFile: File, target: ModelTarget) => {
    setUpload(null)
    try {
      if (target.mode === "add") {
        const id = await addModelFromFiles(files, pmxFile)
        setActiveModelId(id)
        setPendingSlot(false)
      } else {
        const oldId = target.id
        const prevAnim = animByModel[oldId] ?? null
        const id = await replaceModelFromFiles(oldId, files, pmxFile)
        // Same-id replacement (same .pmx name) won't change activeId
          setActiveGroupId(null)
        setActiveModelId(id)
        // The replacement inherits the slot's animation (clips are per model instance
        clearAnimMeta(oldId)
        clearAnimMeta(id)
        setAnimByModel((prev) => {
          const n = { ...prev }
          delete n[oldId]
          return n
        })
        if (prevAnim) {
          const src = prevAnim.source
          const name = src.kind === "file" ? await loadVmdFile(id, src.file) : await loadVmdUrl(id, src.name, src.url)
          if (name) setAnimByModel((prev) => ({ ...prev, [id]: { ...prevAnim, name } }))
        }
      }
    } catch (e) {
      setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── VMD animation upload (per model) ──
  const vmdInputRef = useRef<HTMLInputElement | null>(null)
  // Which model the next VMD pick applies to — set before opening the dialog.
  const animTargetRef = useRef<string | null>(null)
  // Meta (duration/keyframes) is derived by polling
  const clearAnimMeta = (modelId: string) =>
    setAnimMetaByModel((prev) => {
      const n = { ...prev }
      delete n[modelId]
      return n
    })
  const loadAnimFor = async (modelId: string, file: File) => {
    const name = await loadVmdFile(modelId, file)
    clearAnimMeta(modelId)
    setAnimByModel((prev) => {
      const next = { ...prev }
      if (name) next[modelId] = { name, size: file.size, source: { kind: "file", file } }
      else delete next[modelId]
      return next
    })
  }
  const onVmdPicked = async (file: File | undefined) => {
    if (!file) return
    const target = animTargetRef.current ?? activeIdRef.current
    animTargetRef.current = null
    await loadAnimFor(target, file)
  }

  // Camera VMD upload: drives the shot (target/rotation/distance/fov)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [cameraName, setCameraName] = useState<string | null>(null)
  const loadCameraBuffer = async (buffer: ArrayBuffer, name: string) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      await engine.loadCameraVmdFromBuffer(buffer)
      setCameraName(name)
    } catch (e) {
      setUpload({ kind: "notice", message: t.upload.cantLoadCamera(e instanceof Error ? e.message : String(e)) })
    }
  }
  const onCameraPicked = async (file: File | undefined) => {
    if (!file) return
    sceneFiles.camera = file
    await loadCameraBuffer(await file.arrayBuffer(), file.name)
  }
  const removeCamera = useCallback(() => {
    sceneFiles.camera = null
    engineRef.current?.clearCameraVmd()
    setCameraName(null)
  }, [engineRef])

  // Backdrop: a static image behind the 3D scene.
  const backdropInputRef = useRef<HTMLInputElement | null>(null)
  const [backdrop, setBackdrop] = useState<BackdropMedia | null>(null)
  // Skybox: a 360° equirect image rendered BY THE ENGINE (PhotoDome-style, follows the camera
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
  // Audio routing — one choice drives BOTH live playback and export (consistency)
  const [audioSource, setAudioSource] = useState<ExportAudioSource>("music")
  // While an export runs it drives the same model clock the live mirrors watch
  const [exporting, setExporting] = useState(false)
  // Green-screen (chroma-key) mode — LIVE, not export-only
  const [greenScreen, setGreenScreen] = useState(false)
  // Live framing while the Render tab is open.
  const [framePreview, setFramePreview] = useState<FramePreview | null>(null)
  // Collapsing the docks UNMOUNTS the Render panel (the dock's keep-alive covers tab switches
  const [lastFrame, setLastFrame] = useState<FramePreview | null>(null)
  const handleFramePreview = useCallback((p: FramePreview | null) => {
    setFramePreview(p)
    if (p) setLastFrame(p)
  }, [])
  const activeFrame = framePreview ?? (exporting ? lastFrame : null)
  // Green screen is a RENDER-TAB PREVIEW, not a scene mode
  const liveGreenScreen = greenScreen && activeFrame !== null
  const [frameVp, setFrameVp] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!activeFrame) {
      setFrameVp(null)
      return
    }
    const update = () => setFrameVp({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [activeFrame])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (exporting) return // the export pins the full output resolution itself
    // Tolerance: a viewport a hair narrower than the target (browser chrome, rounding)
    if (activeFrame && frameVp && activeFrame.aspect > (frameVp.w / frameVp.h) * FRAME_ASPECT_TOL) {
      const dpr = window.devicePixelRatio || 1
      engine.setRenderSize(Math.round(frameVp.w * dpr), Math.round((frameVp.w * dpr) / activeFrame.aspect))
    } else {
      engine.setRenderSize(null)
    }
  }, [activeFrame, frameVp, exporting, ready, engineRef])
  // Frame rect in CSS pixels (the canvas fills the window; object-contain centers).
  const frameRect =
    activeFrame && frameVp
      ? (() => {
          const va = frameVp.w / frameVp.h
          const a = activeFrame.aspect
          // Within tolerance the canvas isn't pinned and the frame IS the viewport
          if (a <= va * FRAME_ASPECT_TOL && a >= va / FRAME_ASPECT_TOL) return { x: 0, y: 0, w: frameVp.w, h: frameVp.h }
          const w = a < va ? frameVp.h * a : frameVp.w
          const h = a < va ? frameVp.h : frameVp.w / a
          return { x: (frameVp.w - w) / 2, y: (frameVp.h - h) / 2, w, h }
        })()
      : null

  // Background effect layer (WGSL, engine 0.25)
  const [bgEffect, setBgEffect] = useState<AppliedBackgroundEffect | null>(bootScene.state.backgroundEffect)

  // Everything a published scene needs pushed at the engine — the viewer will
  // call this same hook with a fetched document and no editing around it.
  const { drafts: gradeDrafts } = useDrafts<GradeItem>("grade")
  // Community rows join name resolution and the quick-picks — same names, same
  // rules, different provenance.
  const communityGrades = useCommunity<GradeItem>("grade")
  const communityEffects = useCommunity<EffectItem>("effect")
  const communityGraphs = useCommunity<GraphItem>("graph")
  // Floating grade editor — an independent panel like the graph/WGSL editors, opened
  // per subject. The editor is a SCRATCHPAD: `subject` is the working copy, live on
  // the render but written nowhere. Only the save-on-close dialog creates or
  // updates a draft — closing clean, or discarding, leaves no trace.
  const [gradeEditor, setGradeEditor] = useState<{
    sessionId: number
    subject: GradeEditorSubject
    opened: GradeEditorSubject
    savePrompt: boolean
  } | null>(null)
  // Like counts and the gallery's first page, warmed during idle time after boot
  // — opening a library should be a render, not a fetch. (Community rows need no
  // warming here: useCommunity above already fetched them on mount.)
  useEffect(() => {
    const warm = () => {
      prefetchLibraryStats()
      prefetchGallery()
    }
    // A short timeout, because the editor's render loop keeps the main thread busy
    // enough that idle may never arrive on its own — and these are three GETs whose
    // cost to the frame is starting them.
    const idle =
      typeof requestIdleCallback === "function" ? requestIdleCallback(warm, { timeout: 1000 }) : window.setTimeout(warm, 800)
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle)
      else clearTimeout(idle)
    }
  }, [])

  // The scene stores the grade NAME; the spec resolves against built-ins and the
  // reactive drafts store, so editing a draft live-updates the render.
  const appliedGradeSpec = useMemo(
    () =>
      gradeEditor ? gradeEditor.subject.spec : specOf(sceneSettings.grade, [...gradeDrafts, ...communityGrades]),
    [gradeEditor, sceneSettings.grade, gradeDrafts, communityGrades],
  )
  const { noteAppliedWgsl } = useSceneSync({
    engineRef,
    ready,
    settings: sceneSettings,
    gradeSpec: appliedGradeSpec,
    backgroundEffect: bgEffect,
    hasBackdrop: !!backdrop,
    skybox: skybox?.file ?? null,
    greenScreen: liveGreenScreen,
  })
  const [effectsOpen, setEffectsOpen] = useState(false)

  const { data: authSession } = useSession()
  const authorName = authSession?.user.username ?? t.bgLibrary.you

  // Grades library ── User grades live in localStorage (pre-accounts), while the APPLIED
  const [gradesOpen, setGradesOpen] = useState(false)
  const [libraryFacet, setLibraryFacet] = useState<LibraryFacet>("all")
  const [galleryOpen, setGalleryOpen] = useState(false)
  // Lazy initializer, not an effect
  const showGrades = useCallback((facet: LibraryFacet) => {
    setLibraryFacet(facet)
    setGalleryOpen(false)
    // Snapshot the viewport first
    captureScene(canvasRef.current)
    setLibrary((s) => ({ ...s, open: false }))
    setEffectsOpen(false)
    setGradesOpen(true)
    // Refs are stable by contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLibrary, setEffectsOpen, setGradesOpen, setGalleryOpen])
  // Applying restores the strength you last used this grade at — that memory is
  // UX, so it lives in localStorage rather than the scene.
  const applyGradePreset = useCallback(
    (name: string) =>
      setSceneSettings((s) => ({ ...s, grade: { preset: name, intensity: recallIntensity(name) } })),
    [],
  )

  const [gradePanelRect, setGradePanelRect] = useState<Rect | null>(null)
  const updateGradePanelRect = useCallback((r: Rect) => {
    setGradePanelRect(r)
    try {
      window.localStorage.setItem(GRADE_PANEL_KEY, JSON.stringify(r))
    } catch {
      // non-fatal
    }
  }, [])
  // Plain function, not useCallback
  const openGradeEditor = (subject: GradeEditorSubject) => {
    const fallback = loadGradePanelRect() ?? defaultPanelRect()
    setGradePanelRect((r) => r ?? fallback)
    setGradeEditor((prev) => ({ sessionId: (prev?.sessionId ?? 0) + 1, subject, opened: subject, savePrompt: false }))
  }
  // Plain function for the same reason as openGradeEditor above
  const editGrade = (next: GradeEditorSubject) =>
    setGradeEditor((prev) => (prev ? { ...prev, subject: next } : prev))
  /** A name no other grade holds — builtins and drafts alike (minus the one being renamed). */
  const freeGradeName = (wanted: string, keepId?: string) =>
    nextDraftName(wanted, [
      ...GRADE_PRESETS.map((g) => g.name),
      ...loadDrafts().grade.filter((d) => d.id !== keepId).map((d) => d.name),
    ])
  const requestCloseGradeEditor = () => {
    if (!gradeEditor) return
    const { subject, opened } = gradeEditor
    const dirty = subject.name !== opened.name || JSON.stringify(subject.spec) !== JSON.stringify(opened.spec)
    if (!dirty) {
      setGradeEditor(null)
      return
    }
    // An existing draft has a home — save in place, no questions.
    if (isDraft("grade", subject.id)) {
      updateDraft("grade", subject.id, { payload: { spec: subject.spec } })
      setGradeEditor(null)
      return
    }
    setGradeEditor({ ...gradeEditor, savePrompt: true })
  }
  const saveGradeEdit = (wanted: string) => {
    if (!gradeEditor) return
    const { subject } = gradeEditor
    const keep = isDraft("grade", subject.id) ? subject.id : undefined
    const name = freeGradeName(wanted, keep)
    if (keep) updateDraft("grade", keep, { name, payload: { spec: subject.spec } })
    else
      createDraft("grade", {
        name,
        payload: { spec: subject.spec },
        author: authorName,
        // Editing your OWN published preset makes a working copy of it, so
        // publishing writes that item's next version instead of a second item.
        ...origin(communityGrades, subject.id),
      })
    applyGradePreset(name)
    setGradeEditor(null)
  }
  // The three libraries are non-modal and share a z-index, so two open at once simply occlude
  const applyGraphToGroup = useCallback(
    (groupId: string, graphName: string) => {
      const entry = [...loadDrafts().graph, ...communityItems("graph"), ...GRAPH_LIBRARY].find(
        (e) => e.name === graphName,
      ) as GraphItem | undefined
      const group = groups.find((g) => g.id === groupId)
      if (!entry || !group) return
      const updated: StyleGroup = { ...group, graph: { ...entry.payload.graph, name: entry.name } }
      if (updated.materials.length) void upsertGroup(updated)
      else void applyGroups(groups.map((x) => (x.id === groupId ? updated : x)))
      setLibVersion((v) => v + 1)
    },
    [groups, upsertGroup, applyGroups],
  )

  // Restore the active model's grouping from the pristine scene document — not the
  // hydrated boot state, which already carries the user's stored edits.
  const resetGroupsForActive = useCallback(() => {
    const id = activeIdRef.current
    setActiveGroupId(null)
    void resetStyleGroups(id, DEFAULT_SCENE.state.groups?.[id])
  }, [resetStyleGroups])

  const showLibrary = useCallback((groupId: string | null, facet: LibraryFacet) => {
    setLibraryFacet(facet)
    setGalleryOpen(false)
    setEffectsOpen(false)
    setGradesOpen(false)
    setLibrary({ open: true, groupId })
  }, [setEffectsOpen, setGradesOpen, setLibrary, setGalleryOpen])
  const showEffects = useCallback((facet: LibraryFacet) => {
    setLibraryFacet(facet)
    setGalleryOpen(false)
    setLibrary((s) => ({ ...s, open: false }))
    setGradesOpen(false)
    setEffectsOpen(true)
  }, [setLibrary, setGradesOpen, setEffectsOpen, setGalleryOpen])
  // Zero-argument handlers: these are wired straight to onClick, and an optional
  // parameter there would be filled with the click event.
  const openGrades = useCallback(() => showGrades("all"), [showGrades])
  const openEffects = useCallback(() => showEffects("all"), [showEffects])
  const openLibrary = useCallback((groupId: string | null) => showLibrary(groupId, "all"), [showLibrary])
  /** Account-tab stat numbers: the matching library, filtered to your work. */
  const openGallery = useCallback(() => {
    setLibrary((s) => ({ ...s, open: false }))
    setGradesOpen(false)
    setEffectsOpen(false)
    setGalleryOpen(true)
  }, [setLibrary, setGradesOpen, setEffectsOpen, setGalleryOpen])
  const openLibraryForAccount = useCallback(
    (kind: "grade" | "effect" | "graph" | "scene") => {
      if (kind === "scene") openGallery()
      else if (kind === "grade") showGrades("yours")
      else if (kind === "effect") showEffects("yours")
      else showLibrary(null, "yours")
    },
    [showGrades, showEffects, showLibrary, openGallery],
  )
  // Library callbacks — stable so the (memoizable) dialog doesn't re-render idly.
  const applyBgEffect = useCallback((effect: AppliedBackgroundEffect) => setBgEffect(effect), [setBgEffect])
  const removeBgEffect = useCallback(() => setBgEffect(null), [setBgEffect])
  // Floating WGSL editor (page-owned, like the graph editor's panel
  // Scratchpad, like the grade editor: `subject` is what opened (its wgsl is the
  // dirty baseline), `prior` is what the scene showed before — restored on discard,
  // and on any close that saved nothing. Compiles preview live; drafts are written
  // only by the save-on-close dialog.
  const [effectEditor, setEffectEditor] = useState<{
    sessionId: number
    subject: AppliedBackgroundEffect
    prior: AppliedBackgroundEffect | null
    savePrompt: string | null
  } | null>(null)
  const effectSessionRef = useRef(0)
  // Rect initializes lazily on first OPEN (an event handler, so no setState-in-effect)
  const [effectPanelRect, setEffectPanelRect] = useState<Rect | null>(null)
  const updateEffectPanelRect = useCallback((r: Rect) => {
    setEffectPanelRect(r)
    try {
      window.localStorage.setItem(WGSL_PANEL_KEY, JSON.stringify(r))
    } catch {
      // non-fatal
    }
  }, [])
  // Compile + apply in one step
  // Only the LISTS come from the hook. Writes go through the plain functions in
  // lib/drafts.ts — a hook-returned callback in a dependency array defeats the
  // React Compiler's memoization, and these writes need no React state.
  const { drafts: effectDrafts } = useDrafts<EffectItem>("effect")

  const commitEffectCode = useCallback(
    async (subject: AppliedBackgroundEffect, wgsl: string) => {
      const engine = engineRef.current
      if (!engine) return { ok: false, diagnostics: ["engine not ready"] }
      const r = await engine.setBackgroundEffect(wgsl)
      if (r.ok) {
        noteAppliedWgsl(wgsl)
        setBgEffect({ ...subject, wgsl })
      }
      return r
    },
    [engineRef, setBgEffect, noteAppliedWgsl],
  )
  // Opening auto-applies the subject. Plain functions, like the grade editor's —
  // they feed non-memoized dialogs, so memoizing buys nothing.
  const openEffectEditor = (subject: AppliedBackgroundEffect) => {
    effectSessionRef.current += 1
    setEffectEditor({ sessionId: effectSessionRef.current, subject, prior: bgEffect, savePrompt: null })
    setEffectPanelRect((r) => r ?? loadWgslPanelRect() ?? defaultWgslPanelRect())
    void commitEffectCode(subject, subject.wgsl)
  }
  /** Close request from the editor. Dirty → prompt; clean → the preview simply
   *  ends, and whatever was applied before the session comes back. */
  const requestCloseEffectEditor = async (code: string) => {
    if (!effectEditor) return
    if (code === effectEditor.subject.wgsl) {
      setBgEffect(effectEditor.prior)
      setEffectEditor(null)
      return
    }
    // An existing draft saves in place when it compiles; a refusal (or a nameless
    // new effect) goes through the dialog.
    if (isDraft("effect", effectEditor.subject.id)) {
      const engine = engineRef.current
      const r = engine ? await engine.setBackgroundEffect(code) : { ok: false }
      if (r.ok) {
        noteAppliedWgsl(code)
        const { id, name } = effectEditor.subject
        updateDraft("effect", id, { payload: { wgsl: code } })
        setBgEffect({ id, name, wgsl: code })
        setEffectEditor(null)
        return
      }
    }
    setEffectEditor({ ...effectEditor, savePrompt: code })
  }
  const discardEffectEdit = () => {
    if (!effectEditor) return
    setBgEffect(effectEditor.prior)
    setEffectEditor(null)
  }
  /** A name no other effect holds — builtins and drafts alike (minus the one being renamed). */
  const freeEffectName = (wanted: string, keepId?: string) =>
    nextDraftName(wanted, [
      ...BACKGROUND_EFFECTS.map((e) => e.name),
      ...loadDrafts().effect.filter((d) => d.id !== keepId).map((d) => d.name),
    ])
  const saveEffectEdit = async (wanted: string): Promise<string | null> => {
    if (!effectEditor?.savePrompt) return null
    const { subject, savePrompt: code } = effectEditor
    // A broken shader must not land in the library — it would be auto-applied on
    // every future pick. Compiling IS applying, which is also what save wants.
    const isExisting = isDraft("effect", subject.id)
    const engine = engineRef.current
    const r = engine ? await engine.setBackgroundEffect(code) : { ok: false, diagnostics: ["engine not ready"] }
    if (!r.ok) return r.diagnostics[0] ?? "compile failed"
    noteAppliedWgsl(code)
    const keep = isExisting ? subject.id : undefined
    const name = freeEffectName(wanted, keep)
    let id = keep
    if (keep) updateDraft("effect", keep, { name, payload: { wgsl: code } })
    else
      id = createDraft("effect", {
        name,
        payload: { wgsl: code },
        author: authorName,
        ...origin(communityEffects, subject.id),
      }).id
    setBgEffect({ id: id!, name, wgsl: code })
    setEffectEditor(null)
    return null
  }
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

  // Music: the scene's track, replaceable via upload.
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const [audioName, setAudioName] = useState<string | null>(bootScene.assets.audio?.name ?? null)
  const [audioSrc, setAudioSrc] = useState<string>(bootScene.assets.audio?.url ?? "")
  // High-level asset metadata (size for uploads

  const setMusicFile = (f: File) => {
    sceneFiles.audio = f
    setAudioName(f.name)
    setAudioSrc((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
    // Removing audio routes audioSource to "none" — which also MUTES the <audio> element.
    setAudioSource((s) => (s === "none" ? "music" : s))
  }
  const removeAudio = useCallback(() => {
    sceneFiles.audio = null
    setAudioName(null)
    // Revoke OUTSIDE the updater
    if (audioSrc.startsWith("blob:")) URL.revokeObjectURL(audioSrc)
    setAudioSrc("")
    // No source left for the "music" audio option — exports fall back to silent.
    setAudioSource((s) => (s === "music" ? "none" : s))
  }, [audioSrc, setAudioName, setAudioSrc, setAudioSource])


  // Animation duration + total bone keyframes appear whenever an async load (VMD parse +
  useEffect(() => {
    const pending = Object.entries(animByModel).filter(([id]) => !animMetaByModel[id])
    if (!pending.length) return
    let raf = 0
    const poll = () => {
      raf = requestAnimationFrame(poll)
      for (const [id, entry] of pending) {
        const model = engineRef.current?.getModel(id)
        const duration = model?.getAnimationProgress().duration ?? 0
        const clip = model?.getClip(entry.name) ?? null
        if (duration > 0 && clip) {
          let kf = 0
          for (const track of clip.boneTracks.values()) kf += track.length
          setAnimMetaByModel((prev) => ({ ...prev, [id]: { duration, keyframes: kf } }))
        }
      }
    }
    raf = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(raf)
  }, [animByModel, animMetaByModel, engineRef])

  // Master clock: the animated model with the longest clip leads
  const animatedIds = useMemo(
    () =>
      models
        .filter((m) => animByModel[m.id])
        .map((m) => m.id)
        .sort((a, b) => (animMetaByModel[b]?.duration ?? 0) - (animMetaByModel[a]?.duration ?? 0)),
    [models, animByModel, animMetaByModel],
  )
  const masterId = animatedIds[0] ?? null
  const masterDuration = masterId ? (animMetaByModel[masterId]?.duration ?? 0) : 0
  const extraModelNames = useMemo(() => animatedIds.slice(1), [animatedIds])

  // Browsers block audio until the user interacts
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

  // Load each scene model's motion once the cast is ready (custom uploads don't re-trigger
  const sceneAnimLoaded = useRef(false)
  useEffect(() => {
    if (!ready || sceneAnimLoaded.current) return
    sceneAnimLoaded.current = true
    for (const entry of bootScene.assets.models) {
      const clip = entry.animation
      if (!clip) continue
      const id = entry.model.id
      void loadVmdUrl(id, clip.name, clip.url).then((n) => {
        if (n)
          setAnimByModel((prev) => ({
            ...prev,
            [id]: { name: n, size: null, source: { kind: "url", name: clip.name, url: clip.url } },
          }))
      })
    }
  }, [ready, loadVmdUrl, bootScene])

  // Mirror the animation clock onto the audio element (model is the master).
  useEffect(() => {
    const audio = audioElRef.current
    if (!audio) return
    if (!masterId || exporting) {
      audio.pause()
      return
    }
    let raf = 0
    let wasPlaying = false
    let lastModelTime = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
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
  }, [masterId, engineRef, exporting])

  // The file's path: folder picks carry webkitRelativePath
  const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name

  // ONE model pipeline for every source
  const handleModelFiles = async (list: File[], target?: ModelTarget) => {
    if (!list.length) return
    const t2 = target ?? modelTargetRef.current
    let files: File[]
    try {
      files = await expandUploadFiles(list)
    } catch (e) {
      setUpload({ kind: "notice", message: e instanceof Error ? e.message : String(e) })
      return
    }
    const pmxs = files.filter((f) => f.name.toLowerCase().endsWith(".pmx"))
    if (pmxs.length === 0) setUpload({ kind: "notice", message: t.upload.noPmx })
    else if (pmxs.length === 1) await loadCustom(files, pmxs[0], t2)
    else setUpload({ kind: "pick", files, paths: pmxs.map(relPath).sort((a, b) => a.localeCompare(b)), target: t2 })
  }


  // Working scene → localStorage.
  const pendingSave = useRef<Parameters<typeof saveSceneState>[0] | null>(null)
  useEffect(() => {
    const flush = () => {
      if (!pendingSave.current) return
      saveSceneState(pendingSave.current)
      pendingSave.current = null
    }
    const onHidden = () => document.visibilityState === "hidden" && flush()
    // pagehide covers reload/navigation
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", onHidden)
    return () => {
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", onHidden)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    let idle = 0
    const payload = {
      id: bootScene.state.id,
      name: sceneName,
      camera: sceneCamera,
      settings: sceneSettings,
      backgroundEffect: bgEffect,
      // The whole per-model record
      groups: groupsByModel,
      // DERIVED from the live model list rather than tracked separately
      hidden: Object.fromEntries(
        models.map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)]).filter(([, names]) => names.length),
      ),
    }
    // Held for the exit flush until it's actually written.
    pendingSave.current = payload
    const timer = setTimeout(() => {
      const write = () => {
        saveSceneState(payload)
        pendingSave.current = null
      }
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(write, { timeout: 2000 })
          : (setTimeout(write, 0) as unknown as number)
    }, SAVE_SETTLE_MS)
    return () => {
      clearTimeout(timer)
      if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle)
    }
  }, [ready, sceneName, sceneSettings, sceneCamera, bgEffect, groupsByModel, models, bootScene])

  // Stable handlers for the memoized AssetsPanel.
  // Back to the scene DOCUMENT — sliders, colours, and which grade/effect is picked.
  // A picked preset is document state and reverts; an EDITED one is content, and an
  // in-place edit lives nowhere but here, so resetting would destroy it outright.
  // Framing is pushed on change rather than through an effect, so dragging a slider
  // moves the camera on the same tick as the value updates.
  const changeCamera = useCallback(
    (c: SceneCamera) => {
      setSceneCamera(c)
      setCameraView(c)
    },
    [setCameraView],
  )

  // ── Publish-scene collection: the live editor as ONE document + the files its
  // uploaded assets need. Demo assets keep site paths; uploads become
  // bundle-relative paths backed by zip entries.
  const [shareOpen, setShareOpen] = useState(false)
  const collectScenePublish = (): ScenePublishSource => {
    const entries: BundleEntry[] = []
    const liveModels: SceneModel[] = models.map((m) => {
      const kept = sceneFiles.models.get(m.id)
      const booted = bootScene.assets.models.find((d) => d.model.id === m.id)?.model.source ?? null
      let source: ModelSource | null = null
      if (kept) {
        // Uploaded here: pack the files we were given.
        const base = `models/${m.id}`
        const paths = modelFilePaths(kept.files)
        for (const f of kept.files) entries.push({ path: `${base}/${paths.get(f)!}`, file: f })
        source = { kind: "bundle", path: `${base}/${paths.get(kept.pmx)!}` }
      } else if (booted?.kind === "bundle") {
        // Came out of a bundle (a forked scene): re-pack the files already
        // unzipped in memory, so this scene owns its assets rather than pointing
        // at someone else's — theirs can be deleted, and the bytes should be
        // counted against whoever published them.
        const dir = booted.path.slice(0, booted.path.lastIndexOf("/") + 1)
        for (const f of bundleFiles()) {
          if (f.name.startsWith(dir)) entries.push({ path: f.name, file: f })
        }
        source = booted
      } else {
        source = booted
      }
      const anim = animByModel[m.id]
      let animation: AssetRef | null = null
      if (anim?.source.kind === "file") {
        const path = `motions/${m.id}/${anim.source.file.name}`
        entries.push({ path, file: anim.source.file })
        animation = { name: anim.name, url: path }
      } else if (anim?.source.kind === "url") {
        animation = { name: anim.name, url: anim.source.url }
      }
      return { model: { id: m.id, file: m.file, source: source! }, animation }
    })
    let cameraAnimation: AssetRef | null = null
    if (cameraName && sceneFiles.camera) {
      const path = `camera/${sceneFiles.camera.name}`
      entries.push({ path, file: sceneFiles.camera })
      cameraAnimation = { name: cameraName, url: path }
    } else if (cameraName && bootScene.assets.cameraAnimation?.name === cameraName) {
      cameraAnimation = bootScene.assets.cameraAnimation
    }
    let audio: AssetRef | null = null
    if (audioName && sceneFiles.audio) {
      const path = `audio/${sceneFiles.audio.name}`
      entries.push({ path, file: sceneFiles.audio })
      audio = { name: audioName, url: path }
    } else if (audioName && audioSrc && !audioSrc.startsWith("blob:")) {
      audio = { name: audioName, url: audioSrc }
    }
    let background: SceneBackground = null
    if (backdrop) {
      const path = `backdrop/${backdrop.name}`
      entries.push({ path, file: backdrop.file })
      background = { kind: "backdrop", asset: { name: backdrop.name, url: path } }
    } else if (skybox) {
      const path = `skybox/${skybox.name}`
      entries.push({ path, file: skybox.file })
      background = { kind: "skybox", asset: { name: skybox.name, url: path } }
    }
    const hidden = Object.fromEntries(
      models
        .map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)] as const)
        .filter(([, names]) => names.length),
    )
    return {
      entries,
      makeDoc: (bundle) =>
        serializeSceneDoc(
          {
            models: liveModels,
            cameraAnimation,
            audio,
            background,
            bundle,
            name: sceneName,
            camera: sceneCamera,
            // A published grade pins; anything else carries its spec. `preset`
            // is the label either way.
            settings: {
              ...sceneSettings,
              grade: (() => {
                const ref = gradeRef(appliedGradeSpec)
                return ref
                  ? { preset: sceneSettings.grade.preset, intensity: sceneSettings.grade.intensity, from: ref }
                  : { ...sceneSettings.grade, spec: appliedGradeSpec }
              })(),
            },
            backgroundEffect: bgEffect,
            groups: groupsByModel,
            hidden,
          },
          { graph: graphRef, effect: effectRef },
        ),
    }
  }

  const resetSceneDefaults = useCallback(() => {
    setSceneSettings(DEFAULT_SCENE.state.settings)
    setBgEffect(DEFAULT_SCENE.state.backgroundEffect)
    setSceneName(DEFAULT_SCENE.state.name)
    changeCamera(DEFAULT_SCENE.state.camera)
  }, [setSceneSettings, setBgEffect, changeCamera])

  const openModelDialog = useCallback(
    (target: ModelTarget) => {
      modelTargetRef.current = target
      ;(isMobile ? zipInputRef : folderInputRef).current?.click()
    },
    [isMobile],
  )
  const addModel = useCallback(() => openModelDialog({ mode: "add" }), [openModelDialog])
  const addModelZip = useCallback(() => {
    modelTargetRef.current = { mode: "add" }
    zipInputRef.current?.click()
  }, [])
  const replaceSlot = useCallback((id: string) => openModelDialog({ mode: "replace", id }), [openModelDialog])
  const replaceSlotZip = useCallback((id: string) => {
    modelTargetRef.current = { mode: "replace", id }
    zipInputRef.current?.click()
  }, [])
  // The "+ Add model" button reveals an EMPTY slot (upload pair + placeholder lines) instead
  const [pendingSlot, setPendingSlot] = useState(false)
  const addSlot = useCallback(() => setPendingSlot(true), [])
  const cancelPending = useCallback(() => setPendingSlot(false), [])
  const pickAnimationFor = useCallback((id: string) => {
    animTargetRef.current = id
    vmdInputRef.current?.click()
  }, [])
  const removeModel = useCallback(
    (modelId: string) => {
      removeModelById(modelId)
      clearAnimMeta(modelId)
      setAnimByModel((prev) => {
        const n = { ...prev }
        delete n[modelId]
        return n
      })
      // Fall back to the surviving cast's first model (the derived activeModel handles it).
    },
    [removeModelById],
  )
  const pickCamera = useCallback(() => cameraInputRef.current?.click(), [])
  const pickMusic = useCallback(() => audioInputRef.current?.click(), [])
  const pickBackdrop = useCallback(() => backdropInputRef.current?.click(), [])
  const pickSkybox = useCallback(() => skyboxInputRef.current?.click(), [])
  const removeAnimation = useCallback(
    (modelId: string) => {
      stopAnimation(modelId)
      clearAnimMeta(modelId)
      // Also forgets the retained source, so a model replace won't resurrect it.
      setAnimByModel((prev) => {
        const n = { ...prev }
        delete n[modelId]
        return n
      })
    },
    [stopAnimation],
  )

  // Quick-switch entries for the two Scene-panel value rows. Rows are keyed by
  // NAME — the same key the scene stores — so drafts and built-ins are one list.
  const appliedGradeDraftId = gradeDrafts.find((d) => d.name === sceneSettings.grade.preset)?.id ?? null
  const gradeItems = useMemo(
    () =>
      [
        ...quickPickItems(GRADE_PRESETS, gradeDrafts, appliedGradeDraftId).map((g) => ({
          id: g.name,
          label: t.scene.gradePresets[g.name as keyof typeof t.scene.gradePresets] ?? g.name,
          section: g.owner === "local" ? ("local" as const) : ("builtin" as const),
        })),
        ...communityQuickPick(communityGrades, sceneSettings.grade.preset),
      ],
    [t, gradeDrafts, appliedGradeDraftId, communityGrades, sceneSettings.grade.preset],
  )
  // The built-in spec an edit descends from. Neutral, never NEW_GRADE_SPEC:
  // "revert" means back to no grade, not to the editor's authoring starting point.
  const gradeAncestor = useCallback(
    (subject?: GradeEditorSubject) =>
      GRADE_PRESETS.find((g) => g.name === (subject?.origin ?? subject?.name))?.payload.spec ?? NEUTRAL_SPEC,
    [],
  )
  const gradeName =
    t.scene.gradePresets[sceneSettings.grade.preset as keyof typeof t.scene.gradePresets] ??
    sceneSettings.grade.preset
  const pickGrade = applyGradePreset
  const editCurrentGrade = useCallback(() => {
    const { preset } = sceneSettings.grade
    const draft = gradeDrafts.find((d) => d.name === preset)
    openGradeEditor({
      id: draft?.id ?? preset,
      name: preset,
      spec: gradeSpec(preset, gradeDrafts),
      origin: draft ? undefined : preset,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneSettings.grade.preset, gradeDrafts])
  const editCurrentEffect = () => {
    if (bgEffect) openEffectEditor(bgEffect)
  }
  // "edited" means the APPLIED shader differs from its saved source — builtin or
  // draft. During an editor session the applied row carries the hint live; saving
  // or discarding clears it. An unsaved new effect gets a transient row.
  const effectItems = useMemo(() => {
    const items = [
      ...quickPickItems(BACKGROUND_EFFECTS, effectDrafts, bgEffect?.id ?? null).map((e) => ({
        id: e.name,
        label: e.name,
        section: e.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPick(communityEffects, bgEffect?.name ?? null),
    ]
    if (!bgEffect?.name) return items
    const pristine = [...BACKGROUND_EFFECTS, ...effectDrafts, ...communityEffects].some(
      (e) => e.name === bgEffect.name && e.payload.wgsl === bgEffect.wgsl,
    )
    if (pristine) return items
    const known = items.some((i) => i.id === bgEffect.name)
    const withOwn = known ? items : [...items, { id: bgEffect.name, label: bgEffect.name, section: "local" as const }]
    return withOwn.map((i) => (i.id === bgEffect.name ? { ...i, hint: t.scene.edited } : i))
  }, [bgEffect, effectDrafts, communityEffects, t])
  const pickEffect = useCallback(
    (name: string) => {
      const own = [...loadDrafts().effect, ...communityEffects].find((e) => e.name === name) as
        | EffectItem
        | undefined
      if (own) {
        // Drafts and community rows carry their own shader — they apply by value.
        setBgEffect({ id: own.id, name: own.name, wgsl: own.payload.wgsl })
        return
      }
      const def = BACKGROUND_EFFECTS.find((e) => e.name === name)
      // Straight from the definition we just found — going back through the
      // by-name lookup with its id is what made every built-in "unknown".
      if (def) setBgEffect(applyDefaults(def))
    },
    [setBgEffect, communityEffects],
  )

  // Character cards (Assets tab) + model strip (Materials tab)
  const characters = useMemo<CharacterCardData[]>(
    () =>
      models.map((m) => ({
        id: m.id,
        file: m.file,
        active: m.id === activeId,
        animName: animByModel[m.id]?.name ?? null,
      })),
    [models, animByModel, activeId],
  )
  const modelTabs = useMemo(
    () => models.map((m) => ({ id: m.id, file: m.file, active: m.id === activeId })),
    [models, activeId],
  )

  // Dock tab definitions ── LEFT = styling (materials, scene look)
  const leftTabs: DockTab[] = [
    {
      id: "materials",
      label: t.tabs.materials,
      icon: MaterialSphereIcon,
      undoScope: "materials",
      content: (
        <MaterialsPanel
          modelTabs={modelTabs}
          onSelectModel={selectModel}
          materials={materials}
          groups={groups}
          activeGroupId={activeGroupId}
          onHover={highlight}
          onToggleVisible={toggleVisible}
          onOpenLibrary={openLibrary}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onEditGroupGraph={editGroupGraph}
          onMoveMaterial={moveMaterial}
          onPickGraph={applyGraphToGroup}
          onResetGroups={resetGroupsForActive}
        />
      ),
    },
    { id: "scene", label: t.tabs.scene, icon: Sun, undoScope: "scene", content: <ScenePanel
          settings={sceneSettings}
          onChange={setSceneSettings}
          effectName={bgEffect?.name ?? null}
          onOpenEffects={openEffects}
          gradeName={gradeName}
          gradeValue={sceneSettings.grade.preset}
          gradeItems={gradeItems}
          onPickGrade={pickGrade}
          onOpenGrades={openGrades}
          effectItems={effectItems}
          onEditGrade={editCurrentGrade}
          onEditEffect={bgEffect ? editCurrentEffect : undefined}
          onPickEffect={pickEffect}
          camera={sceneCamera}
          onCameraChange={changeCamera}
          cameraDriven={cameraName !== null}
          onReset={resetSceneDefaults}
        /> },
  ]

  const rightTabs: DockTab[] = [
    {
      id: "assets",
      label: t.tabs.assets,
      icon: Package,
      content: (
        <AssetsPanel
          characters={characters}
          cameraName={cameraName}
          audioName={audioName}
          backdropName={backdrop?.name ?? null}
          skyboxName={skybox?.name ?? null}
          pendingSlot={pendingSlot}
          modelUploadLabel={isMobile ? t.assets.uploadModelZip : t.assets.uploadModelFolder}
          addModelLabel={t.assets.addModel}
          onSelectModel={selectModel}
          onReplaceSlot={replaceSlot}
          onReplaceSlotZip={isMobile ? undefined : replaceSlotZip}
          onAddSlot={addSlot}
          onFillPending={addModel}
          onFillPendingZip={isMobile ? undefined : addModelZip}
          onCancelPending={cancelPending}
          onRemoveModel={removeModel}
          onUploadAnimation={pickAnimationFor}
          onRemoveAnimation={removeAnimation}
          onUploadCamera={pickCamera}
          onUploadMusic={pickMusic}
          onRemoveMusic={removeAudio}
          onUploadBackdrop={pickBackdrop}
          onUploadSkybox={pickSkybox}
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
          modelName={masterId ?? activeId}
          extraModelNames={extraModelNames}
          sceneName={sceneName}
          animName={masterId ? (animByModel[masterId]?.name ?? null) : null}
          animDuration={masterDuration}
          backdrop={backdrop}
          backgroundColor={sceneSettings.background.color}
          musicUrl={audioSrc || null}
          audioSource={audioSource}
          onAudioSourceChange={setAudioSource}
          greenScreen={greenScreen}
          onGreenScreenChange={setGreenScreen}
          onExportingChange={setExporting}
          onFramePreviewChange={handleFramePreview}
        />
      ),
    },
  ]

  // Drag & drop anywhere: a single .vmd routes to the animation, audio to music, an image
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
          // A dropped motion lands on the ACTIVE model (the card selection).
          await loadAnimFor(activeIdRef.current, f)
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
      // A dropped model REPLACES the active one (the pre-multi-model behavior)
      await handleModelFiles(files, { mode: "replace", id: activeIdRef.current })
    })()
  }

  return (
    <div
      ref={rootRef}
      // ABSOLUTE, not fixed: `position: fixed` creates a stacking context, which
      // scoped every z-index inside this root. Radix portals its dialogs to
      // document.body, so a library at z-44 outranked a dock at z-48 simply by
      // living outside. Absolute with z-index auto doesn't open a stacking context,
      // so docks, floating panels and portaled dialogs all compare in one order.
      className="absolute inset-0 overflow-hidden text-sm text-foreground select-none"
      style={{ backgroundColor: sceneSettings.background.color }}
      suppressHydrationWarning
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Backdrop layer: page bg color → image (cover) → transparent canvas. */}
      {backdrop && !liveGreenScreen && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backdrop.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* object-contain: normally a no-op (buffer aspect ≡ box aspect), but during video export */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none object-contain" />

      {/* Video-frame overlay (Render tab open / exporting) */}
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
          {activeFrame?.watermark &&
            (() => {
              // Mirrors drawWatermark's metrics (lib/video-export.ts)
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

      {!ready && !error && <LoadingPill />}
      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-400/20 bg-zinc-950/90 px-5 py-4 text-xs text-red-400 backdrop-blur-xs">
            {t.editor.engineError(error)}
          </div>
        </div>
      )}

      {/* Left column: full-height flush dock when expanded (brand pill is its header) */}
      {mounted &&
        (docksOpen ? (
          <RaisableLayer className="fixed inset-y-0 left-0 w-[min(300px,88vw)]">
            <LeftDock
              railTop={<RailLogo />}
              railActions={
                <RailAction icon={GalleryThumbnails} label={t.gallery.title} onClick={openGallery} />
              }
              railUtilities={
                <RailUtility icon={BookOpen} label={t.gallery.manual} href={MANUAL_URL} />
              }
              header={
                <BrandPill
                  sceneName={sceneName}
          onRenameScene={setSceneName}
                  docksOpen
                  onToggleDocks={() => {
                    setDocksOpen(false)
                    setDrawerOpen(false) // collapsing the docks hides the graph editor too
                  }}
                  asHeader
                />
              }
              tabs={leftTabs}
              active={leftTab}
              onActive={setLeftTab}
            />
          </RaisableLayer>
        ) : (
          <div className="fixed top-3 left-3 z-20">
            <BrandPill sceneName={sceneName} onRenameScene={setSceneName} docksOpen={false} onToggleDocks={() => setDocksOpen(true)} />
          </div>
        ))}

      {/* Right column: full-height flush dock when expanded (account/play/share cluster */}
      {mounted &&
        (docksOpen ? (
          <RaisableLayer className="fixed inset-y-0 right-0 w-[min(300px,88vw)]">
            <RightDock
              header={<TopRightCluster onShare={() => setShareOpen(true)} onOpenLibrary={openLibraryForAccount} asHeader />}
              tabs={rightTabs}
              active={rightTab}
              onActive={setRightTab}
            />
          </RaisableLayer>
        ) : (
          <div className="fixed top-3 right-3 z-20">
            <TopRightCluster onShare={() => setShareOpen(true)} onOpenLibrary={openLibraryForAccount} />
          </div>
        ))}

      {/* Node-graph editor: a free-floating, draggable + resizable window (drag by the header grip */}
      {mounted && panelRect && (
        <FloatingPanel
          rect={panelRect}
          onRectChange={updatePanelRect}
          raiseKey={graphSession}
          // Gated on open: this panel stays MOUNTED while closed, so an ungated
          // closer would sit at the top of the stack and swallow Escape from the
          // libraries beneath it.
          onEscape={drawerOpen ? requestCloseGraphDrawer : undefined}
          fullscreen={false}
          className={cn(
            // z-50: above the docks/transport (z-20) and the non-modal library (z-40), so editing
            "z-50 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-xs transition-opacity duration-300",
            !drawerOpen && "pointer-events-none opacity-0",
          )}
        >
          {!drawerOpen ? null : graphLibEdit ? (
            <GraphEditor
              key={`lib-${graphLibEdit.sessionId}`}
              slotLabel={graphLibEdit.name}
              presetGraph={graphLibEdit.opened}
              getInitialGraph={() => graphLibEdit.opened}
              onApply={compileStandalone}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={requestCloseGraphDrawer}
            />
          ) : activeGroup && presetGraph ? (
            <GraphEditor
              key={`${activeGroup.id}-${libVersion}`}
              slotLabel={activeGroup.graph.name || groupLabel(activeGroup)}
              presetGraph={presetGraph}
              getInitialGraph={() => activeGroup.graph ?? presetGraph}
              onApply={applyActiveGraph}
              engineReady={ready}
              engineError={error}
              open={drawerOpen}
              onClose={closeGraphEdit}
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

      {/* Persistent transport bar — always present (inert with no clip, so removing the animation */}
      {mounted && (
        <div className="fixed bottom-3 left-1/2 z-20 -translate-x-1/2">
          <AnimPlayer engineRef={engineRef} modelNames={animatedIds} hasCamera={cameraName !== null} />
        </div>
      )}

      {/* Backgrounds library — the three-column shell (rail · grid · inspector). */}
      <BackgroundLibrary
        open={effectsOpen}
        initialFacet={libraryFacet}
        onOpenChange={setEffectsOpen}
        applied={bgEffect}
        onApply={applyBgEffect}
        onRemove={removeBgEffect}
        onEdit={openEffectEditor}
        onRenamed={(oldName, newName) => setBgEffect((prev) => (prev?.name === oldName ? { ...prev, name: newName } : prev))}
      />

      {/* ── Floating WGSL editor (drag it aside; the scene is the preview). ── */}
      {mounted && effectEditor && (
        <WgslEditorPanel
          open
          sessionId={effectEditor.sessionId}
          rect={effectPanelRect}
          onRectChange={updateEffectPanelRect}
          title={effectEditor.subject.name}
          initial={effectEditor.subject.wgsl}
          onCompile={(wgsl) => commitEffectCode(effectEditor.subject, wgsl)}
          onClose={(code) => void requestCloseEffectEditor(code)}
        />
      )}
      {mounted && effectEditor?.savePrompt != null && (
        <SaveCloseDialog
          defaultName={isDraft("effect", effectEditor.subject.id) ? effectEditor.subject.name : freeEffectName(effectEditor.subject.name)}
          askName={!isDraft("effect", effectEditor.subject.id)}
          onSave={saveEffectEdit}
          onDiscard={discardEffectEdit}
          onCancel={() => setEffectEditor((prev) => (prev ? { ...prev, savePrompt: null } : prev))}
        />
      )}

      {/* ── Grades library (tiles preview the live scene under each grade) ── */}
      <GradeLibrary
        open={gradesOpen}
        initialFacet={libraryFacet}
        onOpenChange={setGradesOpen}
        grade={sceneSettings.grade}
        onRenamed={(oldName, newName) =>
          setSceneSettings((s) => (s.grade.preset === oldName ? { ...s, grade: { ...s.grade, preset: newName } } : s))
        }
        onApplyPreset={applyGradePreset}
        onEdit={openGradeEditor}
      />

      {/* ── Floating grade editor (drag it aside; the scene is the preview) ── */}
      {mounted && gradeEditor && (
        <GradeEditorPanel
          open
          sessionId={gradeEditor.sessionId}
          rect={gradePanelRect}
          onRectChange={updateGradePanelRect}
          subject={gradeEditor.subject}
          origin={gradeAncestor(gradeEditor.subject)}
          onChange={editGrade}
          onClose={requestCloseGradeEditor}
        />
      )}
      <SceneGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
      <HandleDialog />
      {mounted && (
        <ShareSceneDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          sceneId={bootScene.state.id}
          sceneName={sceneName}
          onRename={setSceneName}
          forkedFromId={forkedFrom}
          collect={collectScenePublish}
        />
      )}
      {mounted && graphLibEdit?.savePrompt && (
        <SaveCloseDialog
          defaultName={isDraft("graph", graphLibEdit.id) ? graphLibEdit.name : freeGraphName(graphLibEdit.name)}
          askName={!isDraft("graph", graphLibEdit.id)}
          onSave={saveGraphLibEdit}
          onDiscard={discardGraphLibEdit}
          onCancel={() => setGraphLibEdit((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}
      {mounted && gradeEditor?.savePrompt && (
        <SaveCloseDialog
          defaultName={freeGradeName(gradeEditor.subject.name)}
          onSave={saveGradeEdit}
          onDiscard={() => setGradeEditor(null)}
          onCancel={() => setGradeEditor((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}

      {/* ── Shader-graph library popup ── */}
      <NodeLibrary
        open={library.open}
        initialFacet={libraryFacet}
        onOpenChange={(o) => setLibrary((s) => ({ ...s, open: o }))}
        canApply={libGroup !== null}
        targetLabel={libGroup ? groupLabel(libGroup) : null}
        currentGraphName={libGroup?.graph.name ?? null}
        onApply={applyLibrary}
        onEdit={openGraphLibEdit}
      />

      {/* ── Uploads ── */}
      {/* Model upload — two COMPLETE paths only (flat multi-select was dropped */}
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
      {/* Model .zip picker — the mobile primary, and desktop's ZIP button (a folder dialog can't */}
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
      {/* Audio source — driven (play/pause/seek) by the animation-clock mirror above. */}
      <audio
        ref={audioElRef}
        src={audioSrc || undefined}
        preload="auto"
        playsInline
        muted={audioSource !== "music"}
        className="hidden"
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
                    if (pmx) void loadCustom(upload.files, pmx, upload.target)
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

/** Fork hands the scene id over in sessionStorage (see lib/fork.ts), so the URL
 *  stays `/`. Rendering the editor only once the scene resolves means the engine
 *  boots once, on the right document — no demo flash, no wasted model download. */
function EditorRoute() {
  // Server renders no fork (sessionStorage doesn't exist there); the client picks
  // it up after hydration. Reading it in useState made the two disagree, which is
  // precisely the hydration error.
  const from = useSyncExternalStore(
    () => () => {},
    forkTarget,
    () => null,
  )
  const [forked, setForked] = useState<Scene | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!from) return
    let stale = false
    void (async () => {
      try {
        const res = await fetch(`/api/library/${from}`)
        if (!res.ok) throw new Error(String(res.status))
        const { item } = (await res.json()) as { item: { payload: ScenePayload } }
        const doc = item.payload.doc
        const resolve = await resolveSceneRefs(doc)
        if (stale) return
        const scene = parseSceneDoc(doc, builtinEffect, libraryGraph, resolve as never)
        // A fork is a NEW scene: its own identity from the first frame, so
        // publishing can never overwrite the one it came from — and its own name,
        // so the tab title says which of the two you are editing. Forking a fork
        // doesn't stack the suffix.
        const name = scene.state.name.endsWith(FORK_SUFFIX) ? scene.state.name : `${scene.state.name}${FORK_SUFFIX}`
        setForked({ ...scene, state: { ...scene.state, id: newSceneId(), name } })
      } catch {
        if (!stale) setFailed(true)
      }
    })()
    return () => {
      stale = true
    }
  }, [from])

  if (from && !forked && !failed) {
    return (
      <main className="fixed inset-0 bg-zinc-950">
        <LoadingPill />
      </main>
    )
  }
  return <Editor initialScene={forked ?? undefined} forkedFrom={forked ? (from ?? undefined) : undefined} />
}

export default function Home() {
  return <EditorRoute />
}
