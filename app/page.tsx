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
import { useSceneMedia } from "@/hooks/use-scene-media"
import { useBrowseSurface } from "@/hooks/use-browse-surface"
import { useStoredRect } from "@/hooks/use-stored-rect"
import { expandUploadFiles, readDroppedFiles, unzipToFiles } from "@/lib/uploads"
import { useI18n, useT } from "@/lib/i18n"
import { MaterialSphereIcon } from "@/components/scene/slot-icons"
import { DEFAULT_SCENE, EMPTY_SCENE } from "@/lib/default-scene"
import { groupLabel, GRAPH_LIBRARY, libraryGraph, sameGraphLook, SLOT_GRAPHS } from "@/lib/materials"
import type { AppliedBackgroundEffect } from "@/lib/background-effects"
import { GRADE_PRESETS, NEUTRAL_SPEC, gradeSpec, recallIntensity, specOf } from "@/lib/grade"
import {
  communityQuickPickItems,
  nameKey,
  quickPickItems,
  type EffectItem,
  type GradeItem,
  type GraphItem,
  type GraphPayload,
  type LibraryFacet,
  type ScenePayload,
} from "@/lib/library"
import { communityItems, useCommunity, useCommunityLoaded } from "@/hooks/use-community"
import { prefetchLibraryStats } from "@/hooks/use-library-stats"
import { clearForkTarget, forkTarget } from "@/lib/fork"
import { resolveSceneRefs } from "@/lib/resolve-refs"
import { effectRef, gradeRef, graphLibraryName, graphRef, unpublishedUses } from "@/lib/refs"
import { freeName } from "@/lib/names"
import { useDrafts } from "@/hooks/use-drafts"
import { useSession } from "@/lib/auth-client"
import {
  cancelDraftWrites,
  createDraft,
  flushDraftWrites,
  isDraft,
  loadDrafts,
  nextDraftName,
  updateDraft,
  updateDraftSoon,
} from "@/lib/drafts"
import { applyDefaults, BACKGROUND_EFFECTS, builtinEffect } from "@/lib/background-effects"
import { GradeLibrary } from "@/components/editor/grade-library"
import { GradeEditorPanel, type GradeEditorSubject } from "@/components/editor/grade-editor"
import { SaveCloseDialog } from "@/components/editor/save-close"
import { captureScene } from "@/components/editor/grade-preview"
import {
  assetsDocOf,
  hydrateScene,
  idbBundleOf,
  newSceneId,
  parseSceneDoc,
  saveSceneAssets,
  saveSceneState,
  storedGroupsFor,
  serializeSceneDoc,
  type Scene,
  type AssetRef,
  type ModelSource,
  type SceneBackground,
  type SceneCamera,
  type SceneDoc,
  type SceneModel,
} from "@/lib/scene"
import { downloadBlob, readSceneFile, sceneZipFileName } from "@/lib/scene-file"
import { modelFilePaths, sceneFiles } from "@/lib/scene-files"
import { buildZip, type BundleEntry } from "@/lib/bundle"
import { clearLocalBundle, saveLocalBundle } from "@/lib/asset-store"
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
const MANUAL_BASE = "https://github.com/AmyangXYZ/reze-design/blob/main/docs/manual"
/** The manual in the reader's language where one exists, English otherwise. */
const manualUrl = (locale: string) => `${MANUAL_BASE}/${locale === "zh" ? "zh" : "en"}.md`

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
// The WGSL editor floats like the graph editor; its rect persists the same way.
const GRADE_PANEL_KEY = "reze-design.gradePanel"

const WGSL_PANEL_KEY = "reze-design.wgslPanel"

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

/**
 * Give every look this scene wears a name you can find it under.
 *
 * Two halves, one rule — a group's graph is named after whatever library entry
 * its look actually is, and a look that is no library entry becomes one of yours:
 *
 * NAMED AFTER SOMETHING ELSE. The scene stores each group's graph by value, name
 * included, so a stale name outlives whatever produced it: published under a
 * different title, renamed since, or minted by an older version of this repair.
 * The look is fine — it is pinned, it renders — but the quick switch matches
 * groups to library rows BY NAME, so it showed a look nobody could look up.
 * Renaming to the matched entry costs nothing: the two are the same graph.
 *
 * IN NO LIBRARY AT ALL. A scene can arrive wearing a built-in its author edited
 * and never saved. It renders — that graph travels by value inside the document
 * — but nothing could show it, so the quick switch reported "edited" against a
 * Hair you could not find, and picking Hair from the list silently replaced the
 * author's version with no way back.
 *
 * Each orphan becomes a draft under a free name and the group is repointed at
 * it: the look survives exactly, appears under Local like anything else you own,
 * and the quick switch selects it by its own name instead of impersonating a
 * built-in. Publishing can then require it the way it requires everything else.
 *
 * Idempotent by construction rather than by bookkeeping — a second pass finds
 * the draft the first one made, reads back the same name, and changes nothing.
 * Returns null when there was nothing to do, so the caller can skip the write.
 */
function adoptOrphanGraphs(list: StyleGroup[], author: string, fallbackName: string): StyleGroup[] | null {
  // A running list, not a snapshot: two groups wearing the same orphan look must
  // end up on ONE draft, and two wearing differently-named orphans must not both
  // be handed the same free name by a list that never learns about the first.
  const drafts = loadDrafts().graph
  let changed = false
  const next = list.map((g) => {
    if (!g.graph) return g
    // It IS a library entry: wear that entry's name, whatever the document says.
    const known = graphLibraryName(g.graph)
    if (known) {
      if (g.graph.name === known) return g
      changed = true
      return { ...g, graph: { ...g.graph, name: known } }
    }
    const mine = drafts.find((d) => sameGraphLook((d.payload as GraphPayload).graph, g.graph))
    // Same whole-kind namespace the editor's freeGraphName uses: an adopted
    // orphan is usually named after the built-in or community graph it was
    // edited from, which is exactly the name it must not take.
    const name =
      mine?.name ??
      nextDraftName(g.graph.name || fallbackName, [
        ...GRAPH_LIBRARY.map((x) => x.name),
        ...communityItems("graph").map((c) => c.name),
        ...drafts.map((d) => d.name),
      ])
    if (!mine) drafts.push(createDraft("graph", { name, payload: { graph: { ...g.graph, name } }, author }))
    if (g.graph.name === name) return g
    changed = true
    return { ...g, graph: { ...g.graph, name } }
  })
  return changed ? next : null
}

function Editor({ initialScene, forkedFrom }: { initialScene?: Scene; forkedFrom?: string }) {
  const t = useT()
  const { locale } = useI18n()
  // Which style group the node-graph editor is bound to.
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  // Node-graph library popup, opened for a specific material.
  // One slot for the graph / grade / effect libraries and the gallery — see
  // useBrowseSurface for why four booleans became a union.
  const {
    facet: libraryFacet,
    open: openBrowse,
    closeIf: closeBrowse,
    graphLibrary,
    gradesOpen,
    effectsOpen,
    galleryOpen,
  } = useBrowseSurface()
  const library = { open: graphLibrary !== null, groupId: graphLibrary?.groupId ?? null }
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
  // What the group's graph was when this session opened. Editing a group applies
  // to the scene live — that IS the preview — so declining to keep the result
  // has to put this back, or "discard" would mean "discard from the library but
  // keep in the scene", which is two different words for one button.
  const groupGraphBaseline = useRef<{ groupId: string; graph: ShaderGraph } | null>(null)
  const [groupGraphPrompt, setGroupGraphPrompt] = useState(false)
  const openGraphEditor = useCallback(() => {
    setGraphLibEdit(null)
    setGraphSession((v) => v + 1)
    setDrawerOpen(true)
  }, [])
  // Free-floating editor window rect. Read at init rather than in an effect: the
  // panel is gated on `mounted`, so nothing renders it before hydration settles,
  // and setting it from an effect cost a second render of this whole component.
  const { rect: panelRect, update: updatePanelRect } = useStoredRect(PANEL_KEY, defaultPanelRect, { eager: true })
  // Per-model animation: each model owns its clip (engine clips are per instance).
  type AnimSource = { kind: "file"; file: File } | { kind: "url"; name: string; url: string }
  type AnimEntry = { name: string; size: number | null; source: AnimSource }
  // Where an upload routes: a new cast member, or swapping one out in place.
  type ModelTarget = { mode: "add" } | { mode: "replace"; id: string } | { mode: "addStage" }
  const [animByModel, setAnimByModel] = useState<Record<string, AnimEntry>>({})
  const [animMetaByModel, setAnimMetaByModel] = useState<Record<string, { duration: number; keyframes: number }>>({})
  // The boot document: the bundled demo with the user's stored values merged over it.
  // A forked scene boots as published — NOT merged with your stored state, which
  // belongs to whatever you were working on before.
  const [bootScene, setBootScene] = useState(() => initialScene ?? hydrateScene(DEFAULT_SCENE))
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(bootScene.state.settings)
  const [sceneCamera, setSceneCamera] = useState<SceneCamera>(bootScene.state.camera)
  const [sceneName, setSceneName] = useState(bootScene.state.name)
  // Which scene the timelines are ABOUT: bumps on every swap/open so undo can
  // never carry one scene's past into another (same model id or not).
  const sceneEpochRef = useRef(0)
  const prevBootRef = useRef(bootScene)
  if (prevBootRef.current !== bootScene) {
    prevBootRef.current = bootScene
    sceneEpochRef.current++
  }
  const sceneEpoch = sceneEpochRef.current
  // Undo/redo for the Scene panel — also the fallback scope, so ⌘Z with nothing
  // focused still edits the scene the way it always has.
  useHistory(sceneSettings, setSceneSettings, { scope: "scene", fallback: true, resetKey: sceneEpoch })
  // suppressHydrationWarning makes React SKIP patching the server-rendered style (SSR uses
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.style.setProperty("background-color", sceneSettings.background.color)
  }, [sceneSettings.background.color])

  const {
    canvasRef,
    engineRef,
    ready,
    stageReady,
    error,
    models,
    groupsByModel,
    upsertGroup: upsertGroupFor,
    applyGroups: applyGroupsFor,
    resetStyleGroups,
    bundleFile,
    bundleFiles,
    setCameraView,
    swapScene,
    highlight: highlightFor,
    toggleVisible: toggleVisibleFor,
    addModelFromFiles,
    stages,
    addStageFromFiles,
    setStageTransform,
    setStageMorph,
    resetStageMorphs,
    replaceModelFromFiles,
    removeModelById,
    loadVmdFile,
    loadVmdUrl,
    centerModel,
    stopAnimation,
  } = useEngine(bootScene)

  // Active model: the one the Materials tab + graph editor edit.
  const [activeModelId, setActiveModelId] = useState(bootScene.assets.models[0]?.model.id ?? "")
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
  // `ready` is part of the key: a published scene knows its model id from the
  // document, so without it the async [] → doc/auto groups population right
  // after boot records as an undoable step — and ⌘Z "ungroups" everything.
  useHistory(groups, applyGroups, { scope: "materials", resetKey: `${sceneEpoch}:${activeId}:${ready ? 1 : 0}` })
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
    closeBrowse("graph")
  }

  // Graph-editor session lifecycle ── Edits preview live on the active group.
  // Close keeps the edits, like the other two editors. Undoing is ⌘Z, and the
  // header's reset-to-preset covers starting over.
  /**
   * Closing a GROUP graph session — the same scratchpad contract the library and
   * the grade/effect editors already keep, which this path never had.
   *
   * Unchanged closes silently. Changed asks to keep it, because otherwise a look
   * built here could only ever live in this one scene: invisible in the library,
   * unusable on another group, impossible to publish. Declining reverts, so the
   * one rule holds everywhere — what you keep is in Local, and what you do not
   * keep is gone.
   *
   * Editing one of YOUR drafts is not that situation: it already has a home, so
   * it saves in place and closes, exactly as the standalone editor does. Asking
   * where to put it made every close mint another copy of the draft you were
   * already editing.
   */
  const closeGraphEdit = () => {
    const base = groupGraphBaseline.current
    const group = base ? groups.find((g) => g.id === base.groupId) : null
    // Compared by LOOK, not bytes: merely opening the editor round-trips the
    // graph through ReactFlow and stamps node layout onto it, so a raw compare
    // calls every session dirty and asks to save a graph nobody touched.
    if (!base || !group || sameGraphLook(group.graph, base.graph)) {
      groupGraphBaseline.current = null
      setDrawerOpen(false)
      return
    }
    // By name, which IS the identity a group holds a look by — the load-time
    // repair keeps that name pointing at the draft the look came from.
    const draft = draftGraphNamed(group.graph.name)
    if (draft) {
      // A save that doesn't compile is refused everywhere else; surfacing that
      // needs the dialog, so fall through to it rather than silently keeping a dud.
      const r = compileGraph(group.graph)
      if (r.ok) {
        updateDraft("graph", draft.id, { payload: { graph: group.graph } })
        groupGraphBaseline.current = null
        setDrawerOpen(false)
        return
      }
    }
    setGroupGraphPrompt(true)
  }
  const saveGroupGraph = (wanted: string): string | null => {
    const base = groupGraphBaseline.current
    const group = base ? groups.find((g) => g.id === base.groupId) : null
    if (!base || !group) return null
    // Your own draft keeps its identity and its name — this is the same save the
    // silent path does, reached only because a compile error had to be shown.
    // Anything else is new, and a taken name gets the next free number: closing
    // an editor is the wrong moment to be blocked over a label.
    const keep = draftGraphNamed(group.graph.name)
    const name = keep?.name ?? freeGraphName(wanted)
    const graph = { ...group.graph, name }
    // Same rule as every other save here: a graph that does not compile does not
    // enter the library, or picking it later would raise engine errors.
    const r = compileGraph(graph)
    if (!r.ok) return r.diagnostics.find((d) => d.severity === "error")?.message ?? "compile failed"
    if (keep) updateDraft("graph", keep.id, { payload: { graph } })
    else createDraft("graph", { name, payload: { graph }, author: authorName })
    // The group keeps it too, now under the saved name, so the scene and the
    // library agree about what this look is called.
    void upsertGroup({ ...group, graph })
    groupGraphBaseline.current = null
    setGroupGraphPrompt(false)
    setDrawerOpen(false)
    return null
  }
  const discardGroupGraph = () => {
    const base = groupGraphBaseline.current
    const group = base ? groups.find((g) => g.id === base.groupId) : null
    if (base && group) void upsertGroup({ ...group, graph: base.graph })
    groupGraphBaseline.current = null
    setGroupGraphPrompt(false)
    setDrawerOpen(false)
  }

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
    // Editing your own draft saves as you go — closing it is then just closing,
    // and a crash or a stray reload costs nothing. Only drafts: a built-in or
    // someone else's published work has no local home to write to until the
    // close prompt gives it one.
    if (graphLibEdit && isDraft("graph", graphLibEdit.id)) {
      updateDraftSoon("graph", graphLibEdit.id, { payload: { graph: { ...graph, name: graphLibEdit.name } } })
    }
    return Promise.resolve({ ok: r.ok, diagnostics: r.diagnostics })
  }
  // Names live in lib/names.ts — one namespace per kind, asked the same way by
  // every editor, every library and the publish dialog.
  const freeGraphName = (wanted: string, editingId?: string) => freeName("graph", wanted, editingId)
  /** Your local draft that this graph name refers to, if any — the thing an edit
   *  from the quick switch saves back into. */
  const draftGraphNamed = (name: string) => loadDrafts().graph.find((d) => nameKey(d.name) === nameKey(name))
  const requestCloseGraphDrawer = () => {
    if (!graphLibEdit) {
      setDrawerOpen(false)
      return
    }
    const latest = graphLibLatest.current ?? graphLibEdit.opened
    // By LOOK, not bytes — the same compare the group path makes. Opening the
    // editor round-trips the graph through ReactFlow, which stamps and rounds a
    // layout position onto every node, so a raw compare calls a session dirty for
    // dragging a node an inch, or for an edit that was undone back to where it
    // started, and then asks where to save a graph that renders identically.
    if (sameGraphLook(latest, graphLibEdit.opened)) {
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
    const name = freeGraphName(wanted, graphLibEdit.id)
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
  // Discard has to undo save-as-you-go, not just stop it. A draft has been
  // written throughout the session — that is the point of it — so declining the
  // result means dropping what is still queued AND putting the draft back to
  // what this session opened on. Without that, "discard" kept everything except
  // the last four hundred milliseconds.
  const discardGraphLibEdit = () => {
    if (graphLibEdit && isDraft("graph", graphLibEdit.id)) {
      cancelDraftWrites("graph", graphLibEdit.id)
      updateDraft("graph", graphLibEdit.id, {
        payload: { graph: { ...graphLibEdit.opened, name: graphLibEdit.name } },
      })
    }
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
      groupGraphBaseline.current = { groupId: id, graph: structuredClone(g.graph) }
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
  /** Surface a message in the upload notice dialog — the one way anything in the
   *  editor reports a failure the user has to read. */
  const notice = useCallback((message: string) => setUpload({ kind: "notice", message }), [])
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  // Where the folder/zip inputs route their pick (set before opening the dialog).
  const modelTargetRef = useRef<ModelTarget>({ mode: "add" })
  // Mobile: no folder pickers exist, so the model button is zip-only there.
  const [isMobile] = useState(() => typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent))

  /**
   * Re-apply the material work saved for this model id, if any.
   *
   * Only groups whose materials this model actually has: ids come from the .pmx
   * FILENAME, so two unrelated models both called `model.pmx` share an id, and
   * pushing one's groups onto the other would apply groups naming materials that do
   * not exist. The freshly auto-grouped set is the authority on what does.
   */
  const reclaimGroups = async (id: string) => {
    const saved = storedGroupsFor(id)
    if (!saved?.length) return
    const known = new Set(engineRef.current?.getStyleGroups(id).flatMap((g) => g.materials) ?? [])
    const usable = saved
      .map((group) => ({ ...group, materials: group.materials.filter((m) => known.has(m)) }))
      .filter((group) => group.materials.length > 0)
    if (usable.length) await resetStyleGroups(id, usable)
  }

  // The "+ Add model" button reveals an EMPTY slot (upload pair + placeholder lines) instead.
  // Declared here rather than beside addSlot/cancelPending: loadCustom clears it on a
  // successful upload, and a setter used a thousand lines above its own declaration reads
  // as a hoisting accident.
  const [pendingSlot, setPendingSlot] = useState(false)

  const loadCustom = async (files: File[], pmxFile: File, target: ModelTarget) => {
    setUpload(null)
    try {
      if (target.mode === "addStage") {
        // No reclaimGroups and no activeModelId: a stage is not the thing you are
        // styling when it lands, and its groups are the user's to make.
        await addStageFromFiles(files, pmxFile)
      } else if (target.mode === "add") {
        const id = await addModelFromFiles(files, pmxFile)
        await reclaimGroups(id)
        setActiveModelId(id)
        setPendingSlot(false)
      } else {
        const oldId = target.id
        const prevAnim = animByModel[oldId] ?? null
        const id = await replaceModelFromFiles(oldId, files, pmxFile)
        await reclaimGroups(id)
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
    // Only here, on a user-picked motion — the other loadVmd call sites are restores
    // (boot, and re-applying a clip after a model swap), where clearing the offset
    // would stack a published multi-model scene back on top of itself.
    if (name) {
      centerModel(modelId)
      // Join the transport where it already is. `show()` poses frame 0 and pauses, so a
      // clip added to a second model mid-session starts at zero while the rest of the
      // cast stands at T — they then play out of step for the whole take. The first
      // model that already has a clip is the transport's clock (same rule AnimPlayer
      // uses), so the newcomer seeks to it, and starts moving if it is running.
      const engine = engineRef.current
      const joined = engine?.getModel(modelId)
      for (const other of engine?.getModelNames() ?? []) {
        if (other === modelId) continue
        const p = engine?.getModel(other)?.getAnimationProgress()
        if (!p || p.duration <= 0) continue
        joined?.seek(p.current)
        if (p.playing) joined?.play()
        break
      }
    }
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

  // Camera motion, backdrop, skybox and music all live in useSceneMedia — four
  // slots with one shape, and neither layout owns them.
  const media = useSceneMedia({ engineRef, bootScene, onNotice: notice })
  const {
    cameraInputRef, cameraName, setCameraName, camVmdFollowing, setCamVmdFollowing,
    loadCameraBuffer, onCameraPicked, pickCamera, removeCamera,
    backdropInputRef, backdrop, onBackdropPicked, pickBackdrop, removeBackdrop,
    skyboxInputRef, skybox, onSkyboxPicked, pickSkybox, removeSkybox,
    audioInputRef, audioElRef, audioName, setAudioName, audioSrc, setAudioSrc,
    audioSource, setAudioSource, setMusicFile, pickMusic, removeAudio,
  } = media

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
  // Seeded from the window rather than left null until an effect runs: the pair
  // (frame, viewport) decides the render size, and measuring the viewport one
  // render later made opening the Render tab resize the WebGPU canvas TWICE —
  // once to the viewport, once to the framed size — which the docks' backdrop
  // blur sits on top of.
  const [frameVp, setFrameVp] = useState<{ w: number; h: number } | null>(() =>
    typeof window === "undefined" ? null : { w: window.innerWidth, h: window.innerHeight },
  )
  useEffect(() => {
    if (!activeFrame) return
    const update = () => setFrameVp({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [activeFrame])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return
    if (exporting) return // the export pins the full output resolution itself
    // Nothing to decide until the viewport has been measured; resizing to the
    // viewport first and to the frame a moment later is two canvas rebuilds where
    // one will do.
    if (activeFrame && !frameVp) return
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
    ready: stageReady,
    settings: sceneSettings,
    gradeSpec: appliedGradeSpec,
    backgroundEffect: bgEffect,
    hasBackdrop: !!backdrop,
    skybox: skybox?.file ?? null,
    greenScreen: liveGreenScreen,
  })

  const { data: authSession } = useSession()
  const authorName = authSession?.user.username ?? t.bgLibrary.you

  // See adoptOrphanGraphs. EDITOR ONLY: the viewer shares useEngine, and reading
  // somebody's scene must not deposit their work in your library.
  //
  // Once per LOADED DOCUMENT, never on a live edit. Editing a group's graph
  // previews by writing the group, so keying this on `groupsByModel` ran it on
  // every keystroke in the graph editor: each half-finished look was adopted as
  // a draft and the group renamed under the open editor, which is how closing
  // with Discard still left drafts behind, and how a name grew a tail of
  // numbers ("Hair 2 17 3 18 11") one edit at a time. A document arrives once —
  // that is the moment it can be repaired.
  //
  // Gated on the community list having ARRIVED, not merely been asked for. An
  // orphan is a look that matches nothing published, and before those rows land
  // nothing matches: running early adopted every graph in the scene you just
  // opened, published or not, which is the other half of the same report.
  const communityLoaded = useCommunityLoaded()
  const adoptedDoc = useRef(false)
  useEffect(() => {
    // A swap clears `ready` first, which re-arms this for the incoming document.
    if (!ready) {
      adoptedDoc.current = false
      return
    }
    // Never under an open editor: this renames a group's graph, and doing that
    // to the graph somebody is editing is the whole complaint. Waiting costs
    // nothing — the guard above still lets it run exactly once, when the drawer
    // closes.
    if (adoptedDoc.current || !communityLoaded || drawerOpen) return
    adoptedDoc.current = true
    for (const [modelId, list] of Object.entries(groupsByModel)) {
      const next = adoptOrphanGraphs(list, authorName, t.materials.styleGroup)
      if (next) void applyGroupsFor(modelId, next)
    }
    // `groupsByModel` is read, not depended on — the loaded document's groups
    // land in the same commit as `ready`, and re-running on later edits is the
    // bug above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, communityLoaded, drawerOpen])

  // Grades library ── User grades live in localStorage (pre-accounts), while the APPLIED
  const showGrades = useCallback(
    (facet: LibraryFacet) => {
      // Snapshot the viewport BEFORE the library covers it — grade previews
      // render against the scene as it looks right now.
      captureScene(canvasRef.current)
      openBrowse({ kind: "grade" }, facet)
    },
    // canvasRef is stable by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openBrowse],
  )
  // Applying restores the strength you last used this grade at — that memory is
  // UX, so it lives in localStorage rather than the scene.
  const applyGradePreset = useCallback(
    (name: string) =>
      setSceneSettings((s) => ({ ...s, grade: { preset: name, intensity: recallIntensity(name) } })),
    [],
  )

  const { rect: gradePanelRect, update: updateGradePanelRect, ensure: ensureGradePanelRect } =
    useStoredRect(GRADE_PANEL_KEY, defaultPanelRect)
  // Plain function, not useCallback
  const openGradeEditor = (subject: GradeEditorSubject) => {
    ensureGradePanelRect()
    setGradeEditor((prev) => ({ sessionId: (prev?.sessionId ?? 0) + 1, subject, opened: subject, savePrompt: false }))
  }
  // Plain function for the same reason as openGradeEditor above
  const editGrade = (next: GradeEditorSubject) => {
    setGradeEditor((prev) => (prev ? { ...prev, subject: next } : prev))
    if (isDraft("grade", next.id)) updateDraftSoon("grade", next.id, { payload: { spec: next.spec } })
  }
  const freeGradeName = (wanted: string, editingId?: string) => freeName("grade", wanted, editingId)
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
  const saveGradeEdit = (wanted: string): string | null => {
    if (!gradeEditor) return null
    const { subject } = gradeEditor
    const keep = isDraft("grade", subject.id) ? subject.id : undefined
    const name = freeGradeName(wanted, subject.id)
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
    return null
  }
  // Same contract as the other two editors' discard: a draft that saved as you
  // went goes back to what the session opened on.
  const discardGradeEdit = () => {
    if (!gradeEditor) return
    const { subject, opened } = gradeEditor
    if (isDraft("grade", subject.id)) {
      cancelDraftWrites("grade", subject.id)
      updateDraft("grade", subject.id, { payload: { spec: opened.spec } })
    }
    setGradeEditor(null)
  }
  // A draft renamed in the library takes the groups wearing it along. The grade
  // and effect libraries have always done this for what the scene applies; the
  // graph library could not, because a group holds its look by value — so the
  // scene went on calling it by a name no library had, which then read as
  // "not in use" and let the draft be deleted out from under it.
  const renameGroupLooks = useCallback(
    (oldName: string, newName: string) => {
      for (const [modelId, list] of Object.entries(groupsByModel)) {
        let changed = false
        const next = list.map((g) => {
          if (!g.graph || nameKey(g.graph.name) !== nameKey(oldName)) return g
          changed = true
          return { ...g, graph: { ...g.graph, name: newName } }
        })
        if (changed) void applyGroupsFor(modelId, next)
      }
    },
    [groupsByModel, applyGroupsFor],
  )
  // Every look the scene is wearing, across ALL models — not just the group the
  // library was opened from. A draft one of these is built on is in use, and the
  // library refuses to delete it.
  const usedLookNames = useMemo(
    () => [...new Set(Object.values(groupsByModel).flatMap((list) => list.map((g) => g.graph?.name).filter(Boolean)))] as string[],
    [groupsByModel],
  )
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

  const showLibrary = useCallback(
    (groupId: string | null, facet: LibraryFacet) => openBrowse({ kind: "graph", groupId }, facet),
    [openBrowse],
  )
  const showEffects = useCallback((facet: LibraryFacet) => openBrowse({ kind: "effect" }, facet), [openBrowse])
  // Zero-argument handlers: these are wired straight to onClick, and an optional
  // parameter there would be filled with the click event.
  const openGrades = useCallback(() => showGrades("all"), [showGrades])
  const openEffects = useCallback(() => showEffects("all"), [showEffects])
  const openLibrary = useCallback((groupId: string | null) => showLibrary(groupId, "all"), [showLibrary])
  /** Account-tab stat numbers: the matching library, filtered to your work. */
  const openGallery = useCallback(() => openBrowse({ kind: "gallery" }), [openBrowse])
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
  const { rect: effectPanelRect, update: updateEffectPanelRect, ensure: ensureEffectPanelRect } =
    useStoredRect(WGSL_PANEL_KEY, defaultPanelRect)
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
        // Same rule as graphs and grades: your own draft saves as you go.
        if (isDraft("effect", subject.id)) updateDraftSoon("effect", subject.id, { payload: { wgsl } })
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
    ensureEffectPanelRect()
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
    // Same contract as the graph editor's discard: undo the as-you-go writes.
    if (isDraft("effect", effectEditor.subject.id)) {
      cancelDraftWrites("effect", effectEditor.subject.id)
      updateDraft("effect", effectEditor.subject.id, { payload: { wgsl: effectEditor.subject.wgsl } })
    }
    setBgEffect(effectEditor.prior)
    setEffectEditor(null)
  }
  const freeEffectName = (wanted: string, editingId?: string) => freeName("effect", wanted, editingId)
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
    const name = freeEffectName(wanted, subject.id)
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

  // Everything a scene document carries beyond its models: motion, camera motion,
  // music, backdrop, skybox. loadSceneInto owns models, styles, camera and ground;
  // THIS owns the rest — and it is the only loader of the rest. Boot and swap both
  // call it, which is what ended each drifting its own copy (music lost on swap,
  // clips lost on reset, background surviving as a ghost).
  //
  // Resolution per slot: the scene's bundle first — a published zip and the local
  // IndexedDB bundle look identical through bundleFile — then the URL itself for
  // served assets. Bundle-resolved files are REMEMBERED as files, so publishing a
  // fork re-packs them instead of pointing into somebody else's zip.
  const loadDocExtras = async (scene: Scene) => {
    // Camera VMD before the clips: the authored shot is in place for the first
    // animated frame instead of flashing the default orbit while clips stream.
    const cam = scene.assets.cameraAnimation
    if (cam) {
      const packed = bundleFile(cam.url)
      if (packed) await onCameraPicked(packed)
      else if (/^[/]|^https?:/.test(cam.url)) {
        try {
          await loadCameraBuffer(await (await fetch(cam.url)).arrayBuffer(), cam.name)
        } catch {
          // a missing served asset degrades to no camera motion, not a dead scene
        }
      }
    }
    for (const entry of scene.assets.models) {
      const clip = entry.animation
      if (!clip) continue
      const id = entry.model.id
      const packed = bundleFile(clip.url)
      const name = await (packed ? loadVmdFile(id, packed) : loadVmdUrl(id, clip.name, clip.url))
      // Animated models were revealed-on-hold by loadSceneInto: show them now,
      // wearing the clip's first pose (or bind pose if the clip failed to load).
      engineRef.current?.setModelTransform(id, { visible: true })
      if (!name) continue
      setAnimByModel((prev) => ({
        ...prev,
        [id]: packed
          ? { name, size: packed.size, source: { kind: "file", file: packed } }
          : { name, size: null, source: { kind: "url", name: clip.name, url: clip.url } },
      }))
    }

    const track = scene.assets.audio
    if (track) {
      const packed = bundleFile(track.url)
      if (packed) setMusicFile(packed)
      else if (/^[/]|^https?:/.test(track.url)) {
        setAudioName(track.name)
        setAudioSrc(track.url)
        setAudioSource((v) => (v === "none" ? "music" : v))
      }
    }

    const bg = scene.assets.background
    if (bg) {
      const packed = bundleFile(bg.asset.url)
      const apply = bg.kind === "skybox" ? onSkyboxPicked : onBackdropPicked
      if (packed) await apply(packed)
      else if (/^[/]|^https?:/.test(bg.asset.url)) {
        try {
          const blob = await (await fetch(bg.asset.url)).blob()
          await apply(new File([blob], bg.asset.name, { type: blob.type }))
        } catch {
          // same: degrade, don't die
        }
      }
    }
  }

  const sceneAnimLoaded = useRef(false)
  useEffect(() => {
    if (!ready || sceneAnimLoaded.current) return
    sceneAnimLoaded.current = true
    void loadDocExtras(bootScene)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, bootScene])

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
    // The one correction free-run allows: when sound ACTUALLY starts (decode
    // can lag play() by hundreds of ms on a cold cache), stamp the clock once.
    // Fires per start, never during steady playback.
    // Armed ONLY when the tick just stamped the clock (start/scrub/loop):
    // sound may begin hundreds of ms after that stamp, so correct once at true
    // onset. Plain resumes never arm it — seeking there flushes the decoder
    // and mutes the first beat, which is worse than the drift.
    let stampArmed = false
    const onPlaying = () => {
      if (!stampArmed) return
      stampArmed = false
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      if (p?.playing && Math.abs(audio.currentTime - p.current) > 0.05) audio.currentTime = p.current
    }
    audio.addEventListener("playing", onPlaying)
    // preload="auto" is a hint iOS Safari ignores until a user gesture — warm
    // the buffer on the FIRST gesture anywhere (usually well before play), so
    // pressing play starts sound without a fetch+decode stall. Guarded: never
    // fires once data is buffered or playback has begun.
    const warm = () => {
      if (audio.paused && audio.readyState < 3 && audio.src) audio.load()
    }
    window.addEventListener("pointerdown", warm, { once: true })
    window.addEventListener("keydown", warm, { once: true })

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = engineRef.current?.getModel(masterId)?.getAnimationProgress()
      if (!p) return
      const playing = p.playing && userInteracted.current
      // A frame advances the clock ≤ ~0.05s — anything bigger is a discrete jump.
      const jumped = lastModelTime >= 0 && Math.abs(p.current - lastModelTime) > 0.35
      lastModelTime = p.current
      if (playing) {
        // Free-running audio, like the reze.one demo: the clock is set at
        // playback start and on explicit jumps (scrub, loop wrap) and is then
        // LEFT ALONE — no drift lock, no rate bending. Continuous correction
        // of any kind is what stuttered on mobile Safari; real clock drift
        // over a dance is milliseconds and nobody hears it.
        // Stamp only when the clocks genuinely disagree (scrubbed while
        // stopped, loop wrap) — a resume with clocks already close plays on
        // untouched, seek-free.
        if ((!wasPlaying && Math.abs(audio.currentTime - p.current) > 0.15) || (!audio.seeking && jumped)) {
          audio.currentTime = p.current
          stampArmed = true
        }
        // A track SHORTER than the clip ends part-way through and leaves the
        // element paused. Seeking it back to 0 when the motion loops does not
        // resume an ended element — only play() does — so the second pass ran in
        // silence. Guarded on there being audio left, or an element sitting at
        // its own duration would be asked to start again every frame.
        if (audio.paused && (!Number.isFinite(audio.duration) || p.current < audio.duration - 0.05)) {
          void audio.play().catch(() => {})
        }
      } else if (!audio.paused) {
        audio.pause()
      }
      wasPlaying = playing
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      audio.removeEventListener("playing", onPlaying)
      window.removeEventListener("pointerdown", warm)
      window.removeEventListener("keydown", warm)
    }
    // audioElRef now comes from useSceneMedia, so the linter can no longer see
    // that it is a ref and stable. Listing it costs nothing and keeps the rule on.
  }, [masterId, engineRef, exporting, audioElRef])

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
      // Draft edits coalesce on a short timer, so the same exit that catches the
      // scene has to catch them too — otherwise closing the tab mid-edit takes
      // the last keystroke with it.
      flushDraftWrites()
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

  // Angles and wheel-zoom live on the ENGINE camera only (drags never flow
  // through React state) — snapshot at PUBLISH time so a document opens on the
  // exact view its author chose to ship.
  //
  // Deliberately not used by the local autosave. Orbiting is how you look at a
  // scene, not how you edit it, and it changes no React state — so it never
  // saves on its own. Calling this from the autosave meant the next unrelated
  // edit (a slider, a hidden material) quietly baked wherever the mouse had
  // left the camera into the stored scene, and the angle came back on refresh
  // having never been authored. The document's camera is what the three
  // sliders write, and only they should persist.
  const snapshotCamera = useCallback((): SceneCamera => {
    const e = engineRef.current
    if (!e) return sceneCamera
    // While a camera VMD drives, the live orbit is parked wherever it last was —
    // meaningless numbers that must not overwrite the document's camera.
    if (e.isCameraVmdEnabled()) return sceneCamera
    return { ...sceneCamera, distance: e.getCameraDistance(), alpha: e.getCameraAlpha(), beta: e.getCameraBeta() }
  }, [sceneCamera, engineRef])

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
      // DERIVED from the live model list rather than tracked separately.
      // Empty lists are WRITTEN, not filtered: saveSceneState's retain() merges
      // over the previous save, so a dropped key would leave the old hidden
      // list in place — un-hiding the last material could never persist.
      hidden: Object.fromEntries(models.map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)])),
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
  /**
   * Every slot's CURRENT value — uploaded assets as bundle-relative paths backed by
   * File entries, served assets as their URLs — regardless of who supplied them. This
   * is the one collector behind BOTH destinations: publish zips the entries to R2,
   * local persistence writes them to the IndexedDB bundle. Persisting is publishing
   * with a different store, which is why refresh, fork and publish can never disagree
   * about what the scene is made of.
   */
  const collectSceneSlots = () => {
    const entries: BundleEntry[] = []
    // A file that came OUT of a bundle keeps its bundle path as its name; packing it
    // under a fresh prefix would nest it one level deeper per generation
    // (audio/audio/track.wav), and the local persist loop runs every session.
    const packPath = (prefix: string, name: string) => (name.includes("/") ? name : `${prefix}/${name}`)
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
        const path = packPath(`motions/${m.id}`, anim.source.file.name)
        entries.push({ path, file: anim.source.file })
        animation = { name: anim.name, url: path }
      } else if (anim?.source.kind === "url") {
        animation = { name: anim.name, url: anim.source.url }
      }
      // Stages carry their placement and their switch weights in the document.
      // Without the flag they reload as ordinary cast: physics, IK, a spawn
      // offset, and no ground suppression.
      const stage = stages.find((s) => s.id === m.id)
      return {
        model: { id: m.id, file: m.file, source: source! },
        animation,
        ...(stage ? { stage: true, transform: stage.transform } : {}),
        ...(stage && Object.keys(stage.morphs).length ? { morphs: stage.morphs } : {}),
      }
    })
    let cameraAnimation: AssetRef | null = null
    if (cameraName && sceneFiles.camera) {
      const path = packPath("camera", sceneFiles.camera.name)
      entries.push({ path, file: sceneFiles.camera })
      cameraAnimation = { name: cameraName, url: path }
    } else if (cameraName && bootScene.assets.cameraAnimation?.name === cameraName) {
      cameraAnimation = bootScene.assets.cameraAnimation
    }
    let audio: AssetRef | null = null
    if (audioName && sceneFiles.audio) {
      const path = packPath("audio", sceneFiles.audio.name)
      entries.push({ path, file: sceneFiles.audio })
      audio = { name: audioName, url: path }
    } else if (audioName && audioSrc && !audioSrc.startsWith("blob:")) {
      audio = { name: audioName, url: audioSrc }
    }
    let background: SceneBackground = null
    if (backdrop) {
      const path = packPath("backdrop", backdrop.name)
      entries.push({ path, file: backdrop.file })
      background = { kind: "backdrop", asset: { name: backdrop.name, url: path } }
    } else if (skybox) {
      const path = packPath("skybox", skybox.name)
      entries.push({ path, file: skybox.file })
      background = { kind: "skybox", asset: { name: skybox.name, url: path } }
    }
    const hidden = Object.fromEntries(
      models
        .map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)] as const)
        .filter(([, names]) => names.length),
    )
    return { entries, models: liveModels, cameraAnimation, audio, background, hidden }
  }

  const collectScenePublish = (): ScenePublishSource => {
    const slots = collectSceneSlots()
    return {
      entries: slots.entries,
      makeDoc: (bundle) =>
        serializeSceneDoc(
          {
            models: slots.models,
            cameraAnimation: slots.cameraAnimation,
            audio: slots.audio,
            background: slots.background,
            bundle,
            name: sceneName,
            camera: snapshotCamera(),
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
            hidden: slots.hidden,
          },
          { graph: graphRef, effect: effectRef },
        ),
    }
  }

  // The fingerprint the bundle in IndexedDB was written for, and the URL it got.
  // Refs, not state: they record what already happened on disk and must not
  // themselves trigger the effect that writes it.
  const bundleWrittenFor = useRef<string | null>(null)
  const bundleWrittenRef = useRef<string | null>(null)

  // ── The working scene's assets, persisted. ──
  //
  // Bytes land FIRST, then the doc: a doc pointing at a bundle that never finished
  // writing would boot half a scene, so the record only ever describes what is down.
  // When the byte write fails (quota), the doc records no bundle and boot degrades to
  // the slots that still resolve — the lenient path in loadSceneInto.
  // 150ms: just enough to coalesce one upload's burst of state commits (model list,
  // groups, clip entry) into a single bundle write, while keeping upload→refresh a
  // window a human hand cannot beat. The write order is the real guarantee — bytes,
  // then the record — so a refresh that does land mid-write boots the previous state,
  // never a broken one.
  // What changes the BYTES: the set of files the scene points at. Placement and
  // switches are not on this list — they change the doc, never the bundle, and
  // repacking tens of megabytes of PMX through structuredClone every time a
  // slider settles is what a stage drag used to cost.
  const assetFingerprint = [
    models.map((m) => m.id).join("|"),
    Object.entries(animByModel).map(([k, v]) => `${k}:${v.name}`).join("|"),
    audioName ?? "",
    backdrop?.name ?? "",
    skybox?.name ?? "",
    cameraName ?? "",
  ].join("//")

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      const id = bootScene.state.id
      const slots = collectSceneSlots()
      void (async () => {
        // Only repack when the file set moved; otherwise keep pointing at the
        // bundle already in IndexedDB.
        let bundleUrl: string | null = bundleWrittenRef.current
        if (bundleWrittenFor.current !== assetFingerprint) {
          bundleUrl = slots.entries.length && (await saveLocalBundle(id, slots.entries)) ? idbBundleOf(id) : null
          bundleWrittenFor.current = assetFingerprint
          bundleWrittenRef.current = bundleUrl
        }
        saveSceneAssets(
          id,
          assetsDocOf({
            models: slots.models,
            cameraAnimation: slots.cameraAnimation,
            audio: slots.audio,
            background: slots.background,
            bundle: bundleUrl,
          }),
        )
      })()
    }, 150)
    return () => clearTimeout(timer)
    // stages is here so moving a stage or flipping a switch reaches the DOC —
    // the bundle write above is gated separately on assetFingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, models, stages, assetFingerprint, animByModel, audioName, audioSrc, cameraName, backdrop, skybox, bootScene])


  /**
   * The whole scene as one file: the publish pipeline aimed at disk. The same
   * collector gathers the doc and the uploaded bytes, and the same zip format R2
   * receives is what the user downloads — `scene.json` beside the asset entries, so
   * import, fork and boot all read one shape. Served assets stay URLs (they exist on
   * every deployment); uploaded ones travel in the zip.
   */
  const exportScene = async () => {
    const src = collectScenePublish()
    // bundle: null in the written doc — the assets are BESIDE it in the same zip, and
    // import points the parsed scene at the zip it came from.
    const doc = src.makeDoc(null)
    const zip = await buildZip([
      ...src.entries,
      { path: "scene.json", file: new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }) },
    ])
    downloadBlob(zip, sceneZipFileName(sceneName))
  }

  // Deliberately not memoized: BrandPill is a plain component, so a stable identity
  // buys nothing here, and the compiler cannot preserve a manual memo across this
  // async body — a useCallback would only be a lie the linter has to flag.
  const importScene = async (file: File) => {
    // The full format: a zip with scene.json beside its assets. Loaded exactly like a
    // fork — parse the doc, point the scene at its bundle, swap — and then owned like
    // one: the persist effect re-packs the zip's files into the IndexedDB bundle, so
    // the import survives refresh with no dependence on the original file.
    if (file.name.toLowerCase().endsWith(".zip")) {
      try {
        const files = await unzipToFiles(file)
        const docFile = files.find((f) => f.name === "scene.json")
        if (!docFile) throw new Error("no scene.json")
        const doc = JSON.parse(await docFile.text()) as SceneDoc
        const resolve = await resolveSceneRefs(doc)
        const scene = parseSceneDoc(doc, builtinEffect, libraryGraph, resolve)
        // A blob URL, so loadSceneInto's bundle fetch reads the zip we already hold.
        const url = URL.createObjectURL(file)
        try {
          await applyScene({
            ...scene,
            assets: { ...scene.assets, bundle: url },
            // Its own identity: an imported file may be shared around, and two people's
            // working scenes must not collide on one id.
            state: { ...scene.state, id: newSceneId() },
          })
        } finally {
          URL.revokeObjectURL(url)
        }
      } catch {
        setUpload({ kind: "notice", message: t.sceneFile.badFile })
      }
      return
    }
    // Legacy .reze.json: the config-only format — settings and materials onto the
    // scene you are in, assets untouched.
    const config = await readSceneFile(file)
    if (!config) {
      setUpload({ kind: "notice", message: t.sceneFile.badFile })
      return
    }
    if (config.settings) setSceneSettings(config.settings)
    if (config.camera) changeCamera(config.camera)
    if (config.name) setSceneName(config.name)
    if ("backgroundEffect" in config) setBgEffect(config.backgroundEffect ?? null)
    // Groups are keyed by model id, which modelKey() mints from the .pmx filename —
    // so a config re-attaches to the same model on any machine, and says nothing about
    // models this scene has not loaded. Those entries are skipped, not an error.
    if (config.groups) {
      setActiveGroupId(null)
      for (const m of models) {
        const g = config.groups[m.id]
        if (g?.length) void resetStyleGroups(m.id, g)
      }
    }
    // After resetStyleGroups every material is visible again, so hidden has to be
    // re-applied on top — otherwise a config would export what it hides and import
    // it back showing everything.
    if (config.hidden) {
      for (const m of models) {
        for (const name of config.hidden[m.id] ?? []) toggleVisibleFor(m.id, name)
      }
    }
  }

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
  const addSlot = useCallback(() => setPendingSlot(true), [])
  const cancelPending = useCallback(() => setPendingSlot(false), [])
  const uploadStage = useCallback(() => openModelDialog({ mode: "addStage" }), [openModelDialog])
  // Same two doors as a model: a folder pick, or a zip for people who have the
  // stage as one file (which is how most are distributed).
  const uploadStageZip = useCallback(() => {
    modelTargetRef.current = { mode: "addStage" }
    zipInputRef.current?.click()
  }, [])
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

  /**
   * Swap the whole document in place.
   *
   * Reset, New and Import all land here. The engine's `swapScene` runs the same
   * `loadSceneInto` that first boot does — so a swapped scene and a booted one can never
   * mean different things — and it keeps the WebGPU device, its pipelines and every
   * compiled shader. A page reload would have thrown all of that away and flashed the
   * DOM on the way.
   *
   * `bootScene` is state rather than a frozen initializer because it is the identity the
   * whole persistence layer keys on: the manifest, the IndexedDB record and the autosave
   * all write under `bootScene.state.id`. Leave it frozen and a new scene would quietly
   * persist under the identity of the one it replaced, and only misbehave on the NEXT
   * refresh.
   */
  // Not memoized: BrandPill is a plain component so a stable identity buys nothing, and
  // the compiler cannot preserve a manual memo across this async body anyway.
  const applyScene = async (next: Scene) => {
      await swapScene(next)

      // Assets the engine does not own, cleared before the new document's are adopted.
      sceneFiles.models.clear()
      sceneFiles.audio = null
      sceneFiles.camera = null
      setAnimByModel({})
      setAnimMetaByModel({})
      engineRef.current?.clearCameraVmd()
      setCameraName(null)
      // The helpers, not setState: removeSkybox also clears the engine's equirect, and
      // clearing only the React state left the engine still drawing the old sky.
      removeBackdrop()
      removeSkybox()
      setAudioSrc((prev) => {
        if (prev.startsWith("blob:")) URL.revokeObjectURL(prev)
        return ""
      })
      setAudioName(null)

      // loadSceneInto handled models, styles, camera and ground; the same extras
      // loader boot uses handles the rest, so a swapped document and a booted one
      // can never mean different things.
      await loadDocExtras(next)

      setSceneSettings(next.state.settings)
      setBgEffect(next.state.backgroundEffect)
      setSceneName(next.state.name)
      changeCamera(next.state.camera)
      setActiveGroupId(null)
      setActiveModelId(next.assets.models[0]?.model.id ?? "")
      setPendingSlot(false)
      setBootScene(next)

      // Persisted NOW rather than left to the debounced effects: Reset and New are the
      // user stating what the scene is, and a refresh inside the debounce window must
      // not resurrect what they just discarded. One exception in the record: a blob:
      // bundle (an imported zip) dies with this session, so it is stored as no bundle —
      // a refresh in the window boots what resolves, and the persist effect re-points
      // the record at the IndexedDB copy moments later.
      const transient = !!next.assets.bundle && next.assets.bundle.startsWith("blob:")
      saveSceneState(next.state)
      saveSceneAssets(next.state.id, assetsDocOf({ ...next.assets, bundle: transient ? null : next.assets.bundle }))
      if (!next.assets.bundle) void clearLocalBundle()
  }

  /** The curated first-open scene, assets included. */
  const resetSceneDefaults = () =>
    void applyScene({ ...DEFAULT_SCENE, state: { ...DEFAULT_SCENE.state, id: bootScene.state.id } })

  /** Blank: no assets, no effect, no grade, neutral settings — and a NEW identity, so the
   *  uploads just cleared can never be re-adopted by it. */
  const newScene = () => void applyScene({ ...EMPTY_SCENE, state: { ...EMPTY_SCENE.state, id: newSceneId() } })


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
  // Same three parts as the effect list below it, in the same order: the rows,
  // then the "edited" hint when what is applied has drifted from the entry it
  // came from, then a transient row for a look no list holds. Grades had none of
  // it, so an unsaved grade edit read as though the preset itself had changed.
  const gradeItems = useMemo(() => {
    const items = [
      ...quickPickItems(GRADE_PRESETS, gradeDrafts, appliedGradeDraftId).map((g) => ({
        id: g.name,
        label: t.scene.gradePresets[g.name as keyof typeof t.scene.gradePresets] ?? g.name,
        section: g.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityGrades),
    ]
    const { preset } = sceneSettings.grade
    const source = gradeSpec(preset, [...gradeDrafts, ...communityGrades])
    if (JSON.stringify(appliedGradeSpec) === JSON.stringify(source)) return items
    const known = items.some((i) => i.id === preset)
    const withOwn = known ? items : [...items, { id: preset, label: preset, section: "local" as const }]
    return withOwn.map((i) => (i.id === preset ? { ...i, hint: t.scene.edited } : i))
  }, [t, gradeDrafts, appliedGradeDraftId, communityGrades, sceneSettings.grade, appliedGradeSpec])
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
  // Opened on exactly what the scene is showing, resolved the way the RENDER
  // resolves it — drafts and community alike, snapshot included. Reading only
  // drafts opened the editor on Neutral for anything published: the session
  // began by discarding the look it was meant to be editing, and saving then
  // wrote that blank back out. The other two editors are handed the applied
  // item itself, which is why neither could go wrong this way.
  //
  // The item's own id comes with it, so a community grade saves as a working
  // copy of that item — the same provenance the library's Edit already gives.
  const editCurrentGrade = useCallback(() => {
    const { preset } = sceneSettings.grade
    const own = [...gradeDrafts, ...communityGrades].find((g) => nameKey(g.name) === nameKey(preset))
    openGradeEditor({
      id: own?.id ?? preset,
      name: preset,
      spec: specOf(sceneSettings.grade, [...gradeDrafts, ...communityGrades]),
      // Only a built-in is an ancestor to revert to.
      origin: own ? undefined : preset,
    })
    // openGradeEditor calls ensureGradePanelRect, which is stable from useStoredRect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneSettings.grade, gradeDrafts, communityGrades])
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
      ...communityQuickPickItems(communityEffects),
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

  // Character cards (Assets tab) + model strip (Materials tab).
  //
  // Stages live in `models` so their materials reach the group / shader-graph
  // path — that is the point of supporting pure-PMX stages at all — but they are
  // not cast. They get no motion row and no slot of their own here; the Stage
  // section owns them.
  const stageIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages])
  const characters = useMemo<CharacterCardData[]>(
    () =>
      models
        .filter((m) => !stageIds.has(m.id))
        .map((m) => ({
          id: m.id,
          file: m.file,
          active: m.id === activeId,
          animName: animByModel[m.id]?.name ?? null,
        })),
    [models, stageIds, animByModel, activeId],
  )
  // The Materials strip DOES list stages — styling a stage is the workflow.
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
          cameraDriven={cameraName !== null && camVmdFollowing}
          stagePresent={stages.length > 0}
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
          stages={stages}
          engineRef={engineRef}
          onUploadStage={uploadStage}
          onUploadStageZip={isMobile ? undefined : uploadStageZip}
          stageUploadLabel={isMobile ? t.stage.uploadStageZip : t.stage.uploadStageFolder}
          onRemoveStage={removeModelById}
          onStageTransform={setStageTransform}
          onStageMorph={setStageMorph}
          onResetStageMorphs={resetStageMorphs}
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
              railTop={<RailLogo onNew={newScene} onExport={exportScene} onImport={importScene} onReset={resetSceneDefaults} />}
              railActions={
                <RailAction icon={GalleryThumbnails} label={t.gallery.title} onClick={openGallery} />
              }
              railUtilities={
                <RailUtility icon={BookOpen} label={t.gallery.manual} href={manualUrl(locale)} />
              }
              header={
                <BrandPill
                  sceneName={sceneName}
                  onRenameScene={setSceneName}
                  onNewScene={newScene}
                  onExportScene={exportScene}
                  onImportScene={importScene}
                  onResetScene={resetSceneDefaults}
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
            <BrandPill sceneName={sceneName} onRenameScene={setSceneName} onNewScene={newScene} onExportScene={exportScene} onImportScene={importScene} onResetScene={resetSceneDefaults} docksOpen={false} onToggleDocks={() => setDocksOpen(true)} />
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
          <AnimPlayer
            engineRef={engineRef}
            modelNames={animatedIds}
            hasCamera={cameraName !== null}
            onFollowingChange={setCamVmdFollowing}
          />
        </div>
      )}

      {/* Backgrounds library — the three-column shell (rail · grid · inspector). */}
      <BackgroundLibrary
        open={effectsOpen}
        initialFacet={libraryFacet}
        onOpenChange={(o) => !o && closeBrowse("effect")}
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
          defaultName={freeEffectName(effectEditor.subject.name, effectEditor.subject.id)}
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
        onOpenChange={(o) => !o && closeBrowse("grade")}
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
      <SceneGallery open={galleryOpen} onOpenChange={(o) => !o && closeBrowse("gallery")} />
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
          unpublished={() =>
            unpublishedUses({
              gradeSpec: appliedGradeSpec,
              gradeName: sceneSettings.grade.preset,
              effect: bgEffect,
              groups: groupsByModel,
            })
          }
        />
      )}
      {mounted && groupGraphPrompt && (
        <SaveCloseDialog
          // Your own draft is not being named, it is being saved back — the
          // dialog is here only because the compile failed.
          askName={!draftGraphNamed(activeGroup?.graph.name ?? "")}
          defaultName={
            draftGraphNamed(activeGroup?.graph.name ?? "")?.name ??
            freeGraphName(activeGroup?.graph.name ?? t.materials.newGroup)
          }
          onSave={saveGroupGraph}
          onDiscard={discardGroupGraph}
          onCancel={() => setGroupGraphPrompt(false)}
        />
      )}
      {mounted && graphLibEdit?.savePrompt && (
        <SaveCloseDialog
          defaultName={freeGraphName(graphLibEdit.name, graphLibEdit.id)}
          askName={!isDraft("graph", graphLibEdit.id)}
          onSave={saveGraphLibEdit}
          onDiscard={discardGraphLibEdit}
          onCancel={() => setGraphLibEdit((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}
      {mounted && gradeEditor?.savePrompt && (
        <SaveCloseDialog
          // Spelled out like the other two, though a draft never reaches this
          // dialog: the three prompts should read the same at a glance.
          askName={!isDraft("grade", gradeEditor.subject.id)}
          defaultName={freeGradeName(gradeEditor.subject.name, gradeEditor.subject.id)}
          onSave={saveGradeEdit}
          onDiscard={discardGradeEdit}
          onCancel={() => setGradeEditor((prev) => (prev ? { ...prev, savePrompt: false } : prev))}
        />
      )}

      {/* ── Shader-graph library popup ── */}
      <NodeLibrary
        open={library.open}
        initialFacet={libraryFacet}
        onOpenChange={(o) => !o && closeBrowse("graph")}
        canApply={libGroup !== null}
        targetLabel={libGroup ? groupLabel(libGroup) : null}
        currentGraphName={libGroup?.graph.name ?? null}
        usedNames={usedLookNames}
        onRenamed={renameGroupLooks}
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
  // Every boot decision inside Editor reads localStorage: the stored scene state, and
  // whether this scene's uploads are waiting in IndexedDB. On the server both answer
  // "nothing", so the demo scene renders there and the user's renders here — the same
  // hydration mismatch this route already avoids for forks. `bootScene` is frozen in
  // useState and cannot re-derive after hydration, so the fix is to not build it until
  // the client is running. Server snapshot false, client true, no effect needed.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

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
        const scene = parseSceneDoc(doc, builtinEffect, libraryGraph, resolve)
        // A fork is a NEW scene: its own identity from the first frame, so
        // publishing can never overwrite the one it came from — and its own name,
        // so the tab title says which of the two you are editing. Forking a fork
        // doesn't stack the suffix.
        const name = scene.state.name.endsWith(FORK_SUFFIX) ? scene.state.name : `${scene.state.name}${FORK_SUFFIX}`
        setForked({ ...scene, state: { ...scene.state, id: newSceneId(), name } })
        // Spent: the editor adopts this scene and persistence carries it from here.
        // `from` stays stable this session (the store never notifies), so the editor
        // still knows it is a fork; only the NEXT load stops re-forking.
        clearForkTarget()
      } catch {
        if (!stale) setFailed(true)
      }
    })()
    return () => {
      stale = true
    }
  }, [from])

  if (!mounted || (from && !forked && !failed)) {
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
