"use client"

// Engine lifecycle for the scene page: boot ONCE from a scene document (so the
// first frame already matches the user's stored config — nothing flashes
// defaults), load its model(s) in bind pose, surface per-model material lists,
// and forward raycast picks. Selection highlight is imperative
// (engine.setSelectedMaterial) — the caller decides what "selected" means.
//
// MULTI-MODEL: the engine keys instances by name and renders them all; this hook
// mirrors that as `models: EngineModelInfo[]` plus `groupsByModel` keyed by the
// same ids. Every mutator takes the target model id — the page owns the "active
// model" concept (which model the Materials tab edits); this hook has no
// favorite beyond models[0] being the boot camera's subject.

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

export type EngineModelInfo = {
  /** Engine instance key — unique per loaded model, internal. */
  id: string
  /** The .pmx filename to show the user. */
  file: string
  stats: { vertices: number; bones: number; materials: number }
  materials: MaterialRow[]
}

// Added models stand beside the first, not inside it: alternate right/left of
// the origin in ~9-unit steps (a character is ~9 units shoulder-to-stage-mark).
function spawnOffsetX(existingCount: number): number {
  if (existingCount === 0) return 0
  const step = Math.ceil(existingCount / 2) * 9
  return existingCount % 2 === 1 ? step : -step
}

export function useEngine(
  onPick: (model: string, material: string | null) => void,
  /** The scene to boot into — read ONCE (constructor options + first loadModel +
   *  addGround), so the first frame is already the user's config rather than a
   *  default that gets corrected a tick later. Later edits go through the
   *  mutators below, not by passing a new document. */
  initialScene: Scene,
) {
  const sceneRef = useRef(initialScene)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<EngineModelInfo[]>([])
  // Style groups per model id — the host is the source of truth (0.19). Seeded
  // from the engine's auto-created defaults after load; the app mutates and
  // pushes them down.
  const [groupsByModel, setGroupsByModel] = useState<Record<string, StyleGroup[]>>({})
  // Callbacks need the CURRENT model list without re-creating themselves per
  // render (memoized panels hold them) — mirror it in a ref.
  const modelsRef = useRef<EngineModelInfo[]>([])
  useEffect(() => {
    modelsRef.current = models
  }, [models])

  // Raycast fires from inside the engine's event handlers; route through a ref
  // so the boot effect never depends on the callback identity.
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  })

  const infoFor = (id: string, file: string, model: import("reze-engine").Model): EngineModelInfo => ({
    id,
    file,
    stats: {
      vertices: Math.round(model.getVertices().length / 8),
      bones: model.getSkeleton().bones.length,
      materials: model.getMaterials().length,
    },
    materials: model.getMaterials().map((m) => ({ name: m.name, diffuse: m.diffuse, visible: true })),
  })

  useEffect(() => {
    let disposed = false
    const boot = async () => {
      if (!canvasRef.current) return
      try {
        const scene = sceneRef.current
        const s = scene.state.settings
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
          onRaycast: (model, material) => onPickRef.current(model, material),
        })
        engineRef.current = engine
        // Dev-only console handle — lets new engine APIs be exercised before any
        // UI exists (e.g. `await __reze.setBackgroundEffect(wgsl, params)`).
        if (process.env.NODE_ENV === "development") (window as unknown as { __reze?: Engine }).__reze = engine
        await engine.init()
        if (disposed) return
        const infos: EngineModelInfo[] = []
        const groupsMap: Record<string, StyleGroup[]> = {}
        for (const entry of scene.assets.models) {
          // Zip-sourced scenes (user uploads, once there's blob storage) need a
          // fetch + expandUploadFiles pass before loadModel — this is the one
          // place that lands. Bundled scenes are folder-sourced.
          const pmxUrl = modelPmxUrl(entry.model)
          if (!pmxUrl) throw new Error(`Zip-sourced models aren't loadable from a URL yet: ${entry.model.file}`)
          const model = await engine.loadModel(entry.model.id, pmxUrl)
          if (disposed) return
          const offset = spawnOffsetX(infos.length)
          if (offset !== 0) engine.setModelTransform(entry.model.id, { position: new Vec3(offset, 0, 0) })
          // Styling: a document carrying groups for this model (a restored or
          // imported scene) is authoritative — reproduce it exactly. Otherwise
          // derive from material names, with the model's presets correcting the
          // engine's built-in hints. Awaited so the first frame is styled.
          const docGroups = scene.state.groups?.[entry.model.id]
          if (docGroups) {
            // Empty groups are UI-only drop targets — withheld from the engine.
            await engine.applyStyleGroups(entry.model.id, docGroups.filter((g) => g.materials.length > 0))
          } else {
            await engine.autoStyleGroups(entry.model.id, entry.model.presets)
          }
          if (disposed) return
          infos.push(infoFor(entry.model.id, entry.model.file, model))
          groupsMap[entry.model.id] = withSpecialGroups(docGroups ?? engine.getStyleGroups(entry.model.id))
        }
        engine.addGround({
          diffuseColor: hexToLinearVec3(s.ground.color),
          gridLineColor: hexToLinearVec3(s.ground.grid),
          opacity: s.ground.opacity,
          shadowStrength: s.ground.shadow ? 1 : 0,
          gridLineOpacity: s.ground.gridEnabled ? 0.4 : 0,
          width: s.ground.size,
          height: s.ground.size,
          fadeStart: s.ground.size * (10 / 160),
          fadeEnd: s.ground.size * (80 / 160),
        })
        setModels(infos)
        setGroupsByModel(groupsMap)
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

  const highlight = useCallback((modelId: string, material: string | null) => {
    engineRef.current?.setSelectedMaterial(material ? modelId : null, material)
  }, [])

  const toggleVisible = useCallback((modelId: string, name: string) => {
    engineRef.current?.toggleMaterialVisible(modelId, name)
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? { ...m, materials: m.materials.map((r) => (r.name === name ? { ...r, visible: !r.visible } : r)) }
          : m,
      ),
    )
  }, [])

  // Zip-expanded files carry their RELATIVE PATH in File.name (lib/uploads.ts —
  // that's how textures resolve like a folder pick), so the display name and
  // engine key must strip to the basename or a zip upload shows
  // "ModelFolder/model.pmx" while a folder pick shows "model.pmx".
  const pmxBaseName = (name: string): string => name.split("/").pop() || name

  /** A unique engine key from a .pmx filename ("miku" → "miku-2" on collision).
   *  `except` skips one existing id (the model being replaced). */
  const uniqueModelId = (pmxName: string, except?: string): string => {
    const base = pmxBaseName(pmxName).replace(/\.pmx$/i, "") || "custom"
    const taken = new Set(modelsRef.current.filter((m) => m.id !== except).map((m) => m.id))
    if (!taken.has(base)) return base
    let i = 2
    while (taken.has(`${base}-${i}`)) i++
    return `${base}-${i}`
  }

  /** ADD a model to the scene (folder pick / zip expansion / drop). Auto-grouped,
   *  spawned beside the existing cast. Returns the new model's id. Throws on
   *  load failure — the scene keeps its current cast. */
  const addModelFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File): Promise<string> => {
    const engine = engineRef.current
    if (!engine) throw new Error("engine not ready")
    const id = uniqueModelId(pmxFile.name)
    const model = await engine.loadModel(id, { files, pmxFile })
    const offset = spawnOffsetX(modelsRef.current.length)
    if (offset !== 0) engine.setModelTransform(id, { position: new Vec3(offset, 0, 0) })
    await engine.autoStyleGroups(id)
    const groups = withSpecialGroups(engine.getStyleGroups(id))
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model)])
    setGroupsByModel((prev) => ({ ...prev, [id]: groups }))
    return id
  }, [])

  /** REPLACE one model with an upload, keeping its slot (list position + scene
   *  transform). The old model is removed only after the new one loads, so a
   *  failed upload keeps the scene. Returns the (possibly new) id. */
  const replaceModelFromFiles = useCallback(
    async (targetId: string, files: File[] | FileList, pmxFile: File): Promise<string> => {
      const engine = engineRef.current
      if (!engine) throw new Error("engine not ready")
      const id = uniqueModelId(pmxFile.name, targetId)
      const transform = engine.getModelTransform(targetId)
      if (id === targetId) engine.removeModel(targetId)
      const model = await engine.loadModel(id, { files, pmxFile })
      if (id !== targetId) engine.removeModel(targetId)
      if (transform) engine.setModelTransform(id, { position: transform.position })
      // Uploaded models have no curated map — auto-group from name hints alone.
      await engine.autoStyleGroups(id)
      const groups = withSpecialGroups(engine.getStyleGroups(id))
      setModels((prev) => prev.map((m) => (m.id === targetId ? infoFor(id, pmxBaseName(pmxFile.name), model) : m)))
      setGroupsByModel((prev) => {
        const next = { ...prev }
        delete next[targetId]
        next[id] = groups
        return next
      })
      return id
    },
    [],
  )

  /** Remove a model from the scene entirely (the page keeps ≥1 by policy). */
  const removeModelById = useCallback((modelId: string) => {
    engineRef.current?.removeModel(modelId)
    setModels((prev) => prev.filter((m) => m.id !== modelId))
    setGroupsByModel((prev) => {
      const next = { ...prev }
      delete next[modelId]
      return next
    })
  }, [])

  /** Load a local .vmd onto ONE model (object URL), posed at frame 0 but PAUSED —
   *  the user presses play (which also unlocks audio). Returns the clip name. */
  const loadVmdFile = useCallback(async (modelId: string, file: File): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelId)
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

  /** Load a VMD from a URL (a bundled default clip) onto one model, posed at
   *  frame 0 but PAUSED — play also unlocks audio, so motion and music start in
   *  sync. */
  const loadVmdUrl = useCallback(async (modelId: string, name: string, url: string): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelId)
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
  const upsertGroup = useCallback(
    async (modelId: string, group: StyleGroup, opts?: CompileOptions): Promise<ApplyStyleGroupResult> => {
      setGroupsByModel((prev) => {
        const list = prev[modelId] ?? []
        const i = list.findIndex((g) => g.id === group.id)
        return { ...prev, [modelId]: i >= 0 ? list.map((g) => (g.id === group.id ? group : g)) : [...list, group] }
      })
      const engine = engineRef.current
      if (!engine) return { ok: false, diagnostics: [], slotMap: [] }
      return engine.upsertStyleGroup(modelId, group, opts)
    },
    [],
  )

  /** Replace one model's whole set (structural changes: create/move/remove groups).
   *  Empty folders are kept in UI state but withheld from the engine. */
  const applyGroups = useCallback(async (modelId: string, next: StyleGroup[]) => {
    setGroupsByModel((prev) => ({ ...prev, [modelId]: next }))
    await engineRef.current?.applyStyleGroups(
      modelId,
      next.filter((g) => g.materials.length > 0),
    )
  }, [])

  /** Instant adjust-tier: write one exposed param on a group's graph (no recompile). */
  const setGroupParam = useCallback(
    (modelId: string, groupId: string, paramId: string, value: number | [number, number, number]) => {
      engineRef.current?.setStyleParam(modelId, groupId, paramId, value)
    },
    [],
  )

  const stopAnimation = useCallback((modelId: string) => {
    const model = engineRef.current?.getModel(modelId)
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
    models,
    groupsByModel,
    upsertGroup,
    applyGroups,
    setGroupParam,
    highlight,
    toggleVisible,
    addModelFromFiles,
    replaceModelFromFiles,
    removeModelById,
    loadVmdFile,
    loadVmdUrl,
    stopAnimation,
  }
}
