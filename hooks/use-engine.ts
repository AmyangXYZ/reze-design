"use client"

// Engine lifecycle for the scene page: boot ONCE from a scene document (so the
// first frame already matches the user's stored config — nothing flashes
// defaults), load its model in bind pose, surface the material list, and forward
// raycast picks. Selection highlight is imperative (engine.setSelectedMaterial) —
// the caller decides what "selected" means; hover temporarily overrides it.

import { useCallback, useEffect, useRef, useState } from "react"
import { Engine, Vec3, type ApplyStyleGroupResult, type CompileOptions, type RenderClass, type StyleGroup } from "reze-engine"
import { SLOT_GRAPHS } from "@/lib/materials"
import { modelPmxUrl, type Scene } from "@/lib/scene"
import { azElToDirection, hexToLinearVec3, hexToSrgbVec3 } from "@/lib/scene-settings"

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
  /** The scene to boot into — read ONCE (constructor options + first loadModel +
   *  addGround), so the first frame is already the user's config rather than a
   *  default that gets corrected a tick later. Later edits go through the
   *  mutators below, not by passing a new document. */
  initialScene: Scene,
) {
  const sceneRef = useRef(initialScene)
  const model0 = initialScene.assets.model
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  // The currently loaded model — the scene's model until the user uploads their own.
  const [modelName, setModelName] = useState(model0.id)
  const modelNameRef = useRef(model0.id)
  // The actual .pmx filename to show the user (the engine id above is internal).
  const [modelFile, setModelFile] = useState(model0.file)
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
        const scene = sceneRef.current
        const s = scene.state.settings
        const model0 = scene.assets.model
        const [tx, ty, tz] = scene.state.camera.target
        const engine = new Engine(canvasRef.current, {
          camera: { distance: scene.state.camera.distance, target: new Vec3(tx, ty, tz) },
          // The engine paints the background itself (composited post-tonemap, so it
          // matches the CSS hex) — the first frame is correct regardless of DOM state.
          background: hexToSrgbVec3(s.background.color),
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
        // Zip-sourced scenes (user uploads, once there's blob storage) need a
        // fetch + expandUploadFiles pass before loadModel — this is the one place
        // that lands. Bundled scenes are folder-sourced, so nothing hits it today.
        const pmxUrl = modelPmxUrl(model0)
        if (!pmxUrl) throw new Error(`Zip-sourced models aren't loadable from a URL yet: ${model0.file}`)
        const model = await engine.loadModel(model0.id, pmxUrl)
        if (disposed) return
        engine.addGround({
          diffuseColor: hexToLinearVec3(s.ground.color),
          gridLineColor: hexToLinearVec3(s.ground.grid),
          opacity: s.ground.opacity,
          shadowStrength: s.ground.shadow ? 1 : 0,
          gridLineOpacity: s.ground.gridEnabled ? 0.4 : 0,
        })
        setMaterials(model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })))
        setModelStats({
          vertices: Math.round(model.getVertices().length / 8),
          bones: model.getSkeleton().bones.length,
          materials: model.getMaterials().length,
        })
        // Styling: a document carrying groups (a restored or imported scene) is
        // authoritative — reproduce it exactly. Otherwise derive them from material
        // names, with the model's presets correcting the engine's built-in hints.
        // Awaited either way so getStyleGroups is populated + the first frame is styled.
        const docGroups = scene.state.groups
        if (docGroups) {
          // Empty groups are UI-only drop targets — withheld from the engine, which
          // has nothing to shade with them, but kept in the list the user sees.
          await engine.applyStyleGroups(model0.id, docGroups.filter((g) => g.materials.length > 0))
        } else {
          await engine.autoStyleGroups(model0.id, model0.presets)
        }
        if (disposed) return
        setGroups(withSpecialGroups(docGroups ?? engine.getStyleGroups(model0.id)))
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
      // Frame 0 of a new clip is an arbitrary jump from whatever pose was held —
      // settle the solver against it so the first play doesn't fling hair/cloth.
      engineRef.current?.resetPhysics()
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
      engineRef.current?.resetPhysics() // same arbitrary jump to frame 0 as loadVmdFile
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
    // clearAnimation (not stop): stop() keeps the clip current and update()
    // re-applies its frame-0 pose every frame, silently overwriting the bone
    // resets below — the "removed the animation but the pose stuck" bug.
    model.clearAnimation()
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
