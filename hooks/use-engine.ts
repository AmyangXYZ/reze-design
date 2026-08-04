"use client"

// Engine lifecycle for the scene page

import { useCallback, useEffect, useRef, useState } from "react"
import { Engine, Vec3, type ApplyStyleGroupResult, type CompileOptions, type Model, type RenderClass, type StyleGroup } from "reze-engine"
import { SLOT_GRAPHS } from "@/lib/materials"
import { idbBundleId, modelKey, modelPmxUrl, type Scene, type SceneCamera } from "@/lib/scene"
import { unzipToFiles } from "@/lib/uploads"
import { loadLocalBundle } from "@/lib/asset-store"
import { sceneFiles } from "@/lib/scene-files"
import { azElToDirection, hexToLinearVec3, hexToSrgbVec3 } from "@/lib/scene-settings"

// Eye and Hair are pinned, non-deletable groups
const SPECIAL_GROUPS: { id: string; label: string; renderClass: RenderClass; preset: "eye" | "hair" }[] = [
  { id: "eye", label: "Eye", renderClass: "eye", preset: "eye" },
  { id: "hair", label: "Hair", renderClass: "hair", preset: "hair" },
]
function infoFor(
  id: string,
  file: string,
  model: import("reze-engine").Model,
  hidden?: string[],
): EngineModelInfo {
  return {
    id,
    file,
    stats: {
      vertices: Math.round(model.getVertices().length / 8),
      bones: model.getSkeleton().bones.length,
      materials: model.getMaterials().length,
    },
    materials: model
      .getMaterials()
      .map((m) => ({ name: m.name, diffuse: m.diffuse, visible: !hidden?.includes(m.name) })),
  }
}

/**
 * Load a scene's CONTENT into a live engine: assets, models, styling, ground,
 * framing. Shared by first boot and by swapScene, so opening a published scene
 * takes exactly the same path as starting in one — and so the two can never drift.
 *
 * `stale` lets a superseded load bail between awaits; every one of these steps is
 * asynchronous and a user can swap again mid-flight.
 */
/**
 * The one place a camera is applied.
 *
 * Boot, scene swap and the sliders all pass through here. Three copies of this
 * is how the editor and the viewer drifted apart before — each grew its own
 * idea of what a scene's camera meant, and only one of them was right.
 *
 * `follow` binds the orbit centre to a bone, so a motion that travels keeps the
 * subject framed; the target triple then reads as an offset from that bone
 * rather than a point in the world. A camera VMD still overrides both.
 */
function applyCamera(engine: Engine, camera: SceneCamera, model: Model | null): void {
  if (camera.follow && model) {
    // Short exponential lag (Cinemachine-style aim damping): eases the frame
    // without letting the subject swim off-center — target-follow wants to be
    // much tighter than a position-follow would be.
    engine.setCameraFollow(model, camera.follow, new Vec3(...camera.target), 0.15)
  } else {
    engine.setCameraFollow(null)
    engine.setCameraTarget(new Vec3(...camera.target))
  }
  engine.setCameraDistance(camera.distance)
  engine.setCameraAlpha(camera.alpha)
  engine.setCameraBeta(camera.beta)
}

async function loadSceneInto(engine: Engine, scene: Scene, stale: () => boolean, onStage?: () => void) {
  const s = scene.state.settings
  const infos: EngineModelInfo[] = []
  const groups: Record<string, StyleGroup[]> = {}

  // ── Stage first, models after ──
  // Ground, framing and (via onStage) the render loop go up BEFORE any model
  // bytes arrive, so the page opens on the live stage — background, effect,
  // ground — while models stream in and pop into place. On a slow route
  // (models are the megabytes) this is the difference between a scene loading
  // and a blank screen loading.
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
  applyCamera(engine, scene.state.camera, null)
  onStage?.()

  // A scene's uploads live in one bundle: a published scene's is a zip behind a URL,
  // the working scene's is the same entries in IndexedDB (an `idb:` bundle). Either
  // way the File names carry bundle paths, which is exactly what the engine resolves
  // textures against — one seam, two stores.
  let bundle: File[] | null = null
  const idbId = idbBundleId(scene.assets.bundle)
  if (idbId) {
    bundle = await loadLocalBundle(idbId)
    if (stale()) return null
  } else if (scene.assets.bundle) {
    const res = await fetch(scene.assets.bundle)
    if (!res.ok) throw new Error(`Can't fetch scene assets: ${res.status}`)
    bundle = await unzipToFiles(new File([await res.blob()], "assets.zip"))
    if (stale()) return null
  }
  // For a published zip a missing path is corruption and throwing is honest. Local
  // bytes are different: browsers evict IndexedDB under pressure, so "gone" is a
  // normal Tuesday — the scene boots with whatever still resolves and the user
  // re-uploads the rest, rather than hitting a wall of error.
  const lenient = !scene.assets.bundle || idbId !== null

  // Camera VMD before any model: the authored shot is driving by the time the
  // first model reveals, so nothing on screen ever jumps to a new framing.
  const cam = scene.assets.cameraAnimation
  if (cam) {
    try {
      const packed = bundle?.find((f) => f.name === cam.url)
      if (packed) engine.loadCameraVmdFromBuffer(await packed.arrayBuffer())
      else if (/^[/]|^https?:/.test(cam.url)) await engine.loadCameraVmd(cam.url)
    } catch {
      // a broken camera track shouldn't block the scene
    }
    if (stale()) return null
  }

  for (const entry of scene.assets.models) {
    const src = entry.model.source
    let model
    if (src.kind === "bundle") {
      const pmxFile = bundle?.find((f) => f.name === src.path)
      if (!pmxFile) {
        if (lenient) {
          console.warn(`Local scene asset missing (evicted?): ${src.path}`)
          continue
        }
        throw new Error(`Missing in scene assets: ${src.path}`)
      }
      // Scoped to this model's folder: two models in one bundle can share a
      // texture basename, and the engine's basename fallback would guess.
      const dir = src.path.slice(0, src.path.lastIndexOf("/") + 1)
      const files = bundle!.filter((f) => f.name.startsWith(dir))
      model = await engine.loadModel(entry.model.id, { files, pmxFile })
    } else {
      const pmxUrl = modelPmxUrl(entry.model)
      if (!pmxUrl) throw new Error(`Zip-sourced models aren't loadable from a URL yet: ${entry.model.file}`)
      model = await engine.loadModel(entry.model.id, pmxUrl)
    }
    if (stale()) return null
    // Hidden until styled: the first visible frame wears the scene's shader
    // graphs, not a flash of the default PBSDF look.
    const offset = spawnOffsetX(infos.length)
    engine.setModelTransform(entry.model.id, {
      visible: false,
      ...(offset !== 0 ? { position: new Vec3(offset, 0, 0) } : {}),
    })
    // Styling: a document carrying groups for this model (a restored or imported scene)
    const docGroups = scene.state.groups?.[entry.model.id]
    if (docGroups) {
      // Empty groups are UI-only drop targets — withheld from the engine.
      await engine.applyStyleGroups(entry.model.id, docGroups.filter((g) => g.materials.length > 0))
    } else {
      await engine.autoStyleGroups(entry.model.id)
    }
    if (stale()) return null
    const hidden = scene.state.hidden?.[entry.model.id] ?? []
    for (const name of hidden) engine.toggleMaterialVisible(entry.model.id, name)
    infos.push(infoFor(entry.model.id, entry.model.file, model, hidden))
    groups[entry.model.id] = withSpecialGroups(docGroups ?? engine.getStyleGroups(entry.model.id))
  }

  // Framing travels with the document. Applied here rather than in either host,
  // so a published scene opens on the shot its author chose whether it is being
  // viewed or edited — the editor only pushed the camera when a slider moved, and
  // the viewer never pushed it at all.
  applyCamera(engine, scene.state.camera, engine.getModel(scene.assets.models[0]?.model.id ?? ""))
  // Camera bound (follow included) and styles compiled — reveal. Models with an
  // animation stay hidden a moment longer: their clip loader reveals them after
  // show(), so the first visible frame wears the motion's first pose instead of
  // flashing bind pose. (If the clip fails, the loader still reveals.)
  for (const entry of scene.assets.models) {
    if (!entry.animation) engine.setModelTransform(entry.model.id, { visible: true })
  }
  return { infos, groups, bundle }
}

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

// Added models stand beside the first, not inside
function spawnOffsetX(existingCount: number): number {
  if (existingCount === 0) return 0
  const step = Math.ceil(existingCount / 2) * 9
  return existingCount % 2 === 1 ? step : -step
}

export function useEngine(
  /** The scene to boot into — read ONCE (constructor options + first loadModel + addGround) */
  initialScene: Scene,
) {
  const sceneRef = useRef(initialScene)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [ready, setReady] = useState(false)
  // The stage (ground/camera/render loop) is live — models may still be loading.
  const [stageReady, setStageReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<EngineModelInfo[]>([])
  // Style groups per model id — the host is the source of truth (0.19).
  const [groupsByModel, setGroupsByModel] = useState<Record<string, StyleGroup[]>>({})
  // Callbacks need the CURRENT model list without re-creating themselves per render (memoized
  const modelsRef = useRef<EngineModelInfo[]>([])
  // The scene's unzipped asset bundle, for resolving clips and audio by path.
  const bundleRef = useRef<File[] | null>(null)
  // Bumped per swap so a superseded load stops touching state mid-flight.
  const swapToken = useRef(0)
  useEffect(() => {
    modelsRef.current = models
  }, [models])

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
          // The engine paints the background itself (composited post-tonemap, so it matches the CSS
          background: hexToSrgbVec3(s.background.color),
          world: { color: hexToLinearVec3(s.world.color), strength: s.world.strength },
          sun: {
            color: hexToLinearVec3(s.sun.color),
            strength: s.sun.strength,
            direction: azElToDirection(s.sun.azimuth, s.sun.elevation),
          },
          bloom: { ...s.bloom, color: hexToLinearVec3(s.bloom.color) },
        })
        engineRef.current = engine
        // Dev-only console handle — lets new engine APIs be exercised before any UI exists (e.g.
        if (process.env.NODE_ENV === "development") (window as unknown as { __reze?: Engine }).__reze = engine
        await engine.init()
        // TEMPORARY BISECT — revert after measuring. Does the mid-clip fps drop
        // on iOS follow the GPU morph pass? It only dispatches once morph
        // weights change, which matches "starts a few seconds in, and only for
        // some animations and models". The CPU fallback re-uploads the vertex
        // buffer per dirty frame, so overall speed may be WORSE; the question is
        // only whether the mid-clip step disappears.
        engine.setGpuMorphsEnabled(false)
        if (disposed) return
        const loaded = await loadSceneInto(engine, scene, () => disposed, () => {
          // Stage up: paint now, models stream in behind.
          engine.runRenderLoop()
          setStageReady(true)
        })
        if (!loaded) return
        bundleRef.current = loaded.bundle
        const { infos, groups: groupsMap } = loaded
        setModels(infos)
        setGroupsByModel(groupsMap)
        // Bind pose until the user loads a VMD — material evaluation doesn't need motion.
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

  // Zip-expanded files carry their RELATIVE PATH in File.name (lib/uploads.ts
  const pmxBaseName = (name: string): string => name.split("/").pop() || name

  /** A unique engine key from a .pmx filename — the same mint parseSceneDoc uses. */
  const uniqueModelId = (pmxName: string, except?: string): string =>
    modelKey(pmxName, modelsRef.current.filter((m) => m.id !== except).map((m) => m.id))

  /** ADD a model to the scene (folder pick / zip expansion / drop). */
  const addModelFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File): Promise<string> => {
    const engine = engineRef.current
    if (!engine) throw new Error("engine not ready")
    const id = uniqueModelId(pmxFile.name)
    // Retained for zip-on-publish — the engine consumes the bytes, the bundle
    // needs them again.
    sceneFiles.models.set(id, { pmx: pmxFile, files: Array.from(files) })
    const model = await engine.loadModel(id, { files, pmxFile })
    const offset = spawnOffsetX(modelsRef.current.length)
    if (offset !== 0) engine.setModelTransform(id, { position: new Vec3(offset, 0, 0) })
    await engine.autoStyleGroups(id)
    const groups = withSpecialGroups(engine.getStyleGroups(id))
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model)])
    setGroupsByModel((prev) => ({ ...prev, [id]: groups }))
    return id
  }, [])

  /** REPLACE one model with an upload, keeping its slot (list position + scene transform). */
  const replaceModelFromFiles = useCallback(
    async (targetId: string, files: File[] | FileList, pmxFile: File): Promise<string> => {
      const engine = engineRef.current
      if (!engine) throw new Error("engine not ready")
      const id = uniqueModelId(pmxFile.name, targetId)
      sceneFiles.models.delete(targetId)
      sceneFiles.models.set(id, { pmx: pmxFile, files: Array.from(files) })
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
    sceneFiles.models.delete(modelId)
    engineRef.current?.removeModel(modelId)
    setModels((prev) => prev.filter((m) => m.id !== modelId))
    setGroupsByModel((prev) => {
      const next = { ...prev }
      delete next[modelId]
      return next
    })
  }, [])

  /** Load a local .vmd onto ONE model (object URL), posed at frame 0 but PAUSED */
  /**
   * Drop a model's spawn offset.
   *
   * `spawnOffsetX` exists so a newly added model does not land inside the first one —
   * a framing aid for a model standing in its rest pose. A motion carries its own
   * placement, so once the user loads one the offset is the app second-guessing the
   * file. Nothing is lost: the transform is never persisted (SceneModelDoc has no
   * position), so the offset is runtime-only and the origin is where the model was
   * always going to be.
   */
  const centerModel = useCallback((modelId: string) => {
    engineRef.current?.setModelTransform(modelId, { position: new Vec3(0, 0, 0) })
  }, [])

  const loadVmdFile = useCallback(async (modelId: string, file: File): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelId)
    if (!model) return null
    const url = URL.createObjectURL(file)
    try {
      await model.loadVmd(file.name, url)
      model.show(file.name) // activate + pose frame 0, paused (user presses play)
      // Frame 0 of a new clip is an arbitrary jump from whatever pose was held
      engineRef.current?.resetPhysics()
      return file.name
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [])

  /** A file out of the scene's asset bundle, by its bundle-relative path. */
  const bundleFile = useCallback((path: string): File | null => bundleRef.current?.find((f) => f.name === path) ?? null, [])

  /** The whole unzipped bundle. Publishing a scene that came from one re-packs
   *  these, so a forked scene owns its assets instead of pointing at someone
   *  else's — which would break the moment they deleted theirs. */
  const bundleFiles = useCallback((): File[] => bundleRef.current ?? [], [])

  /** Load a VMD from a URL (a bundled default clip) onto one model, posed at frame 0 but PAUSED */
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

  /** Replace one model's whole set (structural changes: create/move/remove groups). */
  const applyGroups = useCallback(async (modelId: string, next: StyleGroup[]) => {
    setGroupsByModel((prev) => ({ ...prev, [modelId]: next }))
    await engineRef.current?.applyStyleGroups(
      modelId,
      next.filter((g) => g.materials.length > 0),
    )
  }, [])

  /** Back to a fresh load: re-derive grouping from the doc's seed + name hints, and unhide */
  /** Restore a model's grouping: the document's groups when it has an entry, the
   *  engine's auto-classification otherwise. */
  const resetStyleGroups = useCallback(async (modelId: string, groups?: StyleGroup[]) => {
    const engine = engineRef.current
    if (!engine) return
    if (groups?.length) await engine.applyStyleGroups(modelId, groups.filter((g) => g.materials.length > 0))
    else await engine.autoStyleGroups(modelId)
    for (const m of modelsRef.current.find((x) => x.id === modelId)?.materials ?? []) {
      if (!m.visible) engine.toggleMaterialVisible(modelId, m.name)
    }
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, materials: m.materials.map((x) => ({ ...x, visible: true })) } : m)),
    )
    setGroupsByModel((prev) => ({ ...prev, [modelId]: withSpecialGroups(groups ?? engine.getStyleGroups(modelId)) }))
  }, [])

  /**
   * Replace the whole scene without tearing down the device, canvas or swap
   * chain — one WebGPU context for the session, documents flowing through it.
   *
   * That is what makes opening a published scene (or swiping to the next one in a
   * gallery) a document change rather than a page load: no context loss, no
   * re-init, no flash of an empty canvas.
   */
  const swapScene = useCallback(async (scene: Scene): Promise<string | null> => {
    const engine = engineRef.current
    if (!engine) return "engine not ready"
    const token = ++swapToken.current
    const stale = () => token !== swapToken.current
    setReady(false)
    try {
      // The outgoing scene's models and its retained upload files go together —
      // keeping either would leak into the incoming document.
      for (const m of modelsRef.current) engine.removeModel(m.id)
      sceneFiles.models.clear()
      sceneFiles.audio = null
      sceneFiles.camera = null
      engine.clearCameraVmd()

      const loaded = await loadSceneInto(engine, scene, stale)
      if (!loaded) return null
      bundleRef.current = loaded.bundle
      sceneRef.current = scene
      setModels(loaded.infos)
      setGroupsByModel(loaded.groups)
      applyCamera(engine, scene.state.camera, engine.getModel(scene.assets.models[0]?.model.id ?? ""))
      setError(null)
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      return message
    } finally {
      if (!stale()) setReady(true)
    }
  }, [])

  /**
   * Push orbit framing to the engine. A loaded, enabled camera VMD drives the shot
   * instead, so this shows up only once that is off.
   */
  const setCameraView = useCallback((c: SceneCamera) => {
    const engine = engineRef.current
    if (!engine) return
    applyCamera(engine, c, engine.getModel(modelsRef.current[0]?.id ?? ""))
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
    // clearAnimation (not stop)
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
    stageReady,
    error,
    models,
    groupsByModel,
    upsertGroup,
    applyGroups,
    resetStyleGroups,
    bundleFile,
    bundleFiles,
    swapScene,
    setCameraView,
    setGroupParam,
    highlight,
    toggleVisible,
    addModelFromFiles,
    replaceModelFromFiles,
    removeModelById,
    loadVmdFile,
    loadVmdUrl,
    centerModel,
    stopAnimation,
  }
}
