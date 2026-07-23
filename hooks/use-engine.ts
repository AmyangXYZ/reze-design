"use client"

// Engine lifecycle for the scene page: boot once with the user's stored scene
// settings (so nothing flashes defaults), load the demo model in bind pose,
// surface the material list, and forward raycast picks. Selection highlight is
// imperative (engine.setSelectedMaterial) — the caller decides what "selected"
// means; hover temporarily overrides it.

import { useCallback, useEffect, useRef, useState } from "react"
import { Engine, Vec3, type ApplyStyleGroupResult, type CompileOptions, type RenderClass, type StyleGroup } from "reze-engine"
import { MODEL_ID, MODEL_PATH, MODEL_PRESETS, SLOT_GRAPHS } from "@/lib/materials"
import { azElToDirection, hexToLinearVec3, type SceneSettings } from "@/lib/scene-settings"

// Eye and Hair are pinned, non-deletable groups: they own the special render
// classes (stencil so eyes read through hair), so membership IS the assignment —
// users drag eye/hair materials here instead of picking a render class. Seeded
// empty when the engine's auto-grouping didn't already produce them, so there's
// always a drop target. Empty seeds are UI-only (withheld from the engine).
const SPECIAL_GROUPS: { id: string; label: string; renderClass: RenderClass; preset: "eye" | "hair" }[] = [
  { id: "eye", label: "Eye", renderClass: "eye", preset: "eye" },
  { id: "hair", label: "Hair", renderClass: "hair", preset: "hair" },
]
function withSpecialGroups(list: StyleGroup[]): StyleGroup[] {
  const seeds = SPECIAL_GROUPS.filter((s) => !list.some((g) => (g.renderClass ?? "auto") === s.renderClass)).map(
    (s): StyleGroup => ({ id: s.id, label: s.label, materials: [], graph: structuredClone(SLOT_GRAPHS[s.preset]!), renderClass: s.renderClass }),
  )
  return [...list, ...seeds]
}

export type MaterialRow = {
  name: string
  /** PMX base diffuse — used as the row swatch in the sidebar. */
  diffuse: [number, number, number, number]
  visible: boolean
}

export function useEngine(
  onPick: (material: string | null) => void,
  /** Stored scene settings applied AT BOOT (constructor options + first
   *  addGround) so the first frame already matches the user's config. */
  initialSettings: SceneSettings,
) {
  const initialSettingsRef = useRef(initialSettings)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  // The currently loaded model — the demo model until the user uploads their own.
  const [modelName, setModelName] = useState(MODEL_ID)
  const modelNameRef = useRef(MODEL_ID)
  // The actual .pmx filename to show the user (the engine id above is internal).
  const [modelFile, setModelFile] = useState(() => MODEL_PATH.split("/").pop() ?? `${MODEL_ID}.pmx`)
  // High-level model stats for the Assets panel (VERTEX_STRIDE = 8 floats/vertex).
  const [modelStats, setModelStats] = useState({ vertices: 0, bones: 0, materials: 0 })
  // Style groups — the host is the source of truth (0.19). Seeded from the engine's
  // auto-created defaults after load; the app mutates and pushes them down.
  const [groups, setGroups] = useState<StyleGroup[]>([])

  // Raycast fires from inside the engine's event handlers; route through a ref
  // so the boot effect never depends on the callback identity.
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  })

  useEffect(() => {
    let disposed = false
    const boot = async () => {
      if (!canvasRef.current) return
      try {
        const s = initialSettingsRef.current
        const engine = new Engine(canvasRef.current, {
          camera: { distance: 28.8, target: new Vec3(0, 12.5, 0) },
          world: { color: hexToLinearVec3(s.world.color), strength: s.world.strength },
          sun: {
            color: hexToLinearVec3(s.sun.color),
            strength: s.sun.strength,
            direction: azElToDirection(s.sun.azimuth, s.sun.elevation),
          },
          bloom: { ...s.bloom, color: hexToLinearVec3(s.bloom.color) },
          onRaycast: (_model, material) => onPickRef.current(material),
        })
        engineRef.current = engine
        await engine.init()
        if (disposed) return
        const model = await engine.loadModel(MODEL_ID, MODEL_PATH)
        if (disposed) return
        engine.setMaterialPresets(MODEL_ID, MODEL_PRESETS)
        engine.addGround({
          diffuseColor: hexToLinearVec3(s.colors.ground),
          gridLineColor: hexToLinearVec3(s.colors.grid),
        })
        setMaterials(model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })))
        setModelStats({
          vertices: Math.round(model.getVertices().length / 8),
          bones: model.getSkeleton().bones.length,
          materials: model.getMaterials().length,
        })
        // Auto-group from the curated preset map + name hints → compiled-graph looks.
        // Awaited (compiles finish) so getStyleGroups is populated + first frame is styled.
        await engine.autoStyleGroups(MODEL_ID)
        if (disposed) return
        setGroups(withSpecialGroups(engine.getStyleGroups(MODEL_ID)))
        // Bind pose until the user loads a VMD — material evaluation doesn't need motion.
        engine.runRenderLoop()
        setReady(true)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void boot()
    return () => {
      disposed = true
      engineRef.current?.dispose?.()
      engineRef.current = null
    }
  }, [])

  const highlight = useCallback((material: string | null) => {
    engineRef.current?.setSelectedMaterial(material ? modelNameRef.current : null, material)
  }, [])

  const toggleVisible = useCallback((name: string) => {
    engineRef.current?.toggleMaterialVisible(modelNameRef.current, name)
    setMaterials((rows) => rows.map((r) => (r.name === name ? { ...r, visible: !r.visible } : r)))
  }, [])

  /** Swap in a user-uploaded model from a folder pick (loadModel resolves the
   *  PMX's relative texture paths against the picked files). The old model is
   *  removed only after the new one loads, so a failed upload keeps the scene. */
  const loadFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File) => {
    const engine = engineRef.current
    if (!engine) return
    const name = pmxFile.name.replace(/\.pmx$/i, "") || "custom"
    try {
      if (name === modelNameRef.current) engine.removeModel(name)
      const model = await engine.loadModel(name, { files, pmxFile })
      if (name !== modelNameRef.current) engine.removeModel(modelNameRef.current)
      modelNameRef.current = name
      setModelName(name)
      setModelFile(pmxFile.name)
      setMaterials(model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })))
      setModelStats({
        vertices: Math.round(model.getVertices().length / 8),
        bones: model.getSkeleton().bones.length,
        materials: model.getMaterials().length,
      })
      // Uploaded models have no curated map — auto-group from name hints alone.
      await engine.autoStyleGroups(name)
      setGroups(withSpecialGroups(engine.getStyleGroups(name)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  /** Load a local .vmd onto the current model (object URL), posed at frame 0 but
   *  PAUSED — the user presses play (which also unlocks audio). Returns the clip
   *  name on success. */
  const loadVmdFile = useCallback(async (file: File): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelNameRef.current)
    if (!model) return null
    const url = URL.createObjectURL(file)
    try {
      await model.loadVmd(file.name, url)
      model.show(file.name) // activate + pose frame 0, paused (user presses play)
      return file.name
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [])

  /** Load a VMD from a URL (a bundled default clip) onto the current model, posed
   *  at frame 0 but PAUSED — the user presses play, which also unlocks audio
   *  (browsers block autoplay), so motion and music start in sync. */
  const loadVmdUrl = useCallback(async (name: string, url: string): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelNameRef.current)
    if (!model) return null
    try {
      await model.loadVmd(name, url)
      model.show(name) // activate + pose frame 0, paused (user presses play)
      return name
    } catch {
      return null
    }
  }, [])

  // ── Style-group mutators (host owns the set; these mirror to state + engine). ──

  /** Add/replace one group's graph or definition (compile + swap just that group). */
  const upsertGroup = useCallback(async (group: StyleGroup, opts?: CompileOptions): Promise<ApplyStyleGroupResult> => {
    setGroups((prev) => {
      const i = prev.findIndex((g) => g.id === group.id)
      return i >= 0 ? prev.map((g) => (g.id === group.id ? group : g)) : [...prev, group]
    })
    const engine = engineRef.current
    if (!engine) return { ok: false, diagnostics: [], slotMap: [] }
    return engine.upsertStyleGroup(modelNameRef.current, group, opts)
  }, [])

  /** Replace the whole set (structural changes: create/move/remove groups). Empty
   *  folders are kept in UI state but withheld from the engine (nothing to shade). */
  const applyGroups = useCallback(async (next: StyleGroup[]) => {
    setGroups(next)
    await engineRef.current?.applyStyleGroups(
      modelNameRef.current,
      next.filter((g) => g.materials.length > 0),
    )
  }, [])

  /** Instant adjust-tier: write one exposed param on a group's graph (no recompile). */
  const setGroupParam = useCallback((groupId: string, paramId: string, value: number | [number, number, number]) => {
    engineRef.current?.setStyleParam(modelNameRef.current, groupId, paramId, value)
  }, [])

  const stopAnimation = useCallback(() => {
    const model = engineRef.current?.getModel(modelNameRef.current)
    if (!model) return
    model.stopAnimation()
    // Back to the default bind pose (not the animation's frame 0).
    model.resetAllBones()
    model.resetAllMorphs()
    engineRef.current?.resetPhysics()
  }, [])

  return {
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
    setGroupParam,
    highlight,
    toggleVisible,
    loadFromFiles,
    loadVmdFile,
    loadVmdUrl,
    stopAnimation,
  }
}
