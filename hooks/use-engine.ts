"use client"

// Engine lifecycle for the scene page

import { useCallback, useEffect, useRef, useState } from "react"
import { EFFECTS } from "@/lib/effects"
import { Engine, parseLRC, parseMidi, Vec3, type ApplyStyleGroupResult, type CompileOptions, type StyleGroup, type LyricLine } from "reze-engine"
import { rasterizeLyrics } from "@/lib/lyrics-raster"
import { modelKey, type Scene, type SceneAttach, type SceneCamera, type SceneParentKey } from "@/lib/scene"
import { sweepRetiredBundles } from "@/lib/asset-store"
import { sceneFiles } from "@/lib/scene-files"
import { clearMaterialMaps, withMaterialMaps } from "@/lib/material-maps"
import { createMediaFollower, type MediaFollower } from "@/lib/media-clock"
import { azElToDirection, hexToLinearVec3, hexToSrgbVec3 } from "@/lib/scene-settings"
import {
  DEFAULT_STAGE_TRANSFORM,
  PLANE_PIXELS_PER_UNIT,
  applyCamera,
  castRotationToEngine,
  firstCastId,
  infoFor,
  loadLyricsFor,
  loadMidiFor,
  loadSceneInto,
  
  placeProp,
  preparePlaneMedia,
  reportGroups,
  restyled,
  spawnOffsetX,
  stageTransformToEngine,
  trimToMotion,
  withSpecialGroups,
} from "@/lib/scene-host"
import type {
  BundleProgress,
  EngineModelInfo,
  
  
  PlaneAnimation,
  PlaneInfo,
  PropInfo,
  StageInfo,
  StageTransform,
  ViewportHandlers,
} from "@/lib/scene-host"
import { normalizeVisibility, type VisibilityWindow } from "@/lib/visibility"

// Re-exported, because these are this module's public surface as far as the
// rest of the app is concerned and moving the pipeline out from under it is
// not a reason for every call site to learn a new path.
export type {
  BundleProgress,
  EngineModelInfo,
  LoadProgress,
  MaterialRow,
  PlaneAnimation,
  PlaneInfo,
  PropInfo,
  StageInfo,
  StageTransform,
  ViewportHandlers,
} from "@/lib/scene-host"

export function useEngine(
  /** The scene to boot into — read ONCE (constructor options + first loadModel + addGround) */
  initialScene: Scene,
) {
  const sceneRef = useRef(initialScene)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  // Empty until an editor fills it — see ViewportHandlers.
  const viewportRef = useRef<ViewportHandlers>({})
  const [ready, setReady] = useState(false)
  // The stage (ground/camera/render loop) is live — models may still be loading.
  const [stageReady, setStageReady] = useState(false)
  const [bundleProgress, setBundleProgress] = useState<BundleProgress | null>(null)
  /** The track's companions by display name — set when the document's refs load
   *  and when a file is picked by hand, so the rows show either. */
  const [midiClip, setMidiClip] = useState<string | null>(null)
  const [lyricsClip, setLyricsClip] = useState<string | null>(null)
  /** The song, and which slice of it the atlas currently holds. */
  const lyricPage = useRef<{ lines: LyricLine[]; from: number; to: number; heightPx: number } | null>(null)
  // The asset bundle is unzipped. Everything that resolves out of it — clips,
  // audio, a background image — is available from here, which is well before
  // the models it shares the zip with have finished loading. State and not just
  // the ref, because a ref cannot tell anyone it changed.
  const [bundleReady, setBundleReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<EngineModelInfo[]>([])
  // Which of `models` are environment rather than cast. Stages stay IN models so
  // their materials reach the group/graph path; this list is what keeps them out
  // of the cast, the motion rows and the spawn-offset walk.
  const [stages, setStages] = useState<StageInfo[]>([])
  /** Props: PMX objects the cast holds or wears. Their own list for the reason
   *  planes have one — a scene holds one stage and any number of these. */
  const [props, setProps] = useState<PropInfo[]>([])
  /**
   * Media planes: flat cards carrying a picture, placed in the scene.
   *
   * Their own list rather than rows in `stages`, because a stage IS the floor
   * and a scene holds one of them, while planes are scenery and a scene holds
   * as many as someone cares to arrange. They share the transform shape, which
   * is the part that matters — placing a card is placing a stage by another
   * name.
   */
  const [planes, setPlanes] = useState<PlaneInfo[]>([])
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
      // Before anything reads the bundle store: drop what an older key wrote.
      // The document sweep in hydrateScene has always done this for
      // localStorage; the bundle had no version to sweep by until now.
      void sweepRetiredBundles()
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
          // Viewport picking and the bone gizmo.
          //
          // Thunks reading a ref, because the Engine takes these ONCE at
          // construction and exposes no setter — a handler that closed over
          // React state would need a new Engine to change, which is the whole
          // scene. The ref is filled by whoever is editing (see ClipBridge) and
          // emptied when nothing is, so a stray double-click in a scene with no
          // editor open reaches nothing.
          onRaycast: (modelName, material, bone, screenX, screenY) =>
            viewportRef.current.onRaycast?.(modelName, material, bone, screenX, screenY),
          onGizmoDrag: (event) => viewportRef.current.onGizmoDrag?.(event),
        })
        engineRef.current = engine
        // Dev-only console handle — lets new engine APIs be exercised before any UI exists (e.g.
        if (process.env.NODE_ENV === "development") (window as unknown as { __reze?: Engine }).__reze = engine
        // …and the built-in sources beside it, keyed by name. The effects are
        // bundled rather than served, so a console trying a new multi-effect API
        // otherwise has no way to reach a real shader to pass it.
        if (process.env.NODE_ENV === "development") {
          ;(window as unknown as { __rezeEffects?: Record<string, string> }).__rezeEffects = Object.fromEntries(
            EFFECTS.map((e) => [e.name, e.payload.wgsl]),
          )
          // Fetch + parse + install a .mid in one call. The score UI does not
          // exist yet, and a parser that can only be reached by rebuilding the
          // app is a parser nobody tries.
          ;(window as unknown as { __rezeLoadScore?: (url: string) => Promise<number> }).__rezeLoadScore = async (
            url: string,
          ) => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`${res.status} ${res.statusText} — check the path under /public`)
            const notes = parseMidi(await res.arrayBuffer())
            engine.setMidiNotes(notes)
            return notes.length
          }
          // The same courtesy for lyrics: fetch + parse + rasterise + install.
          ;(window as unknown as { __rezeLoadLyrics?: (url: string) => Promise<number> }).__rezeLoadLyrics = async (
            url: string,
          ) => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`${res.status} ${res.statusText} — check the path under /public`)
            const lines = parseLRC(await res.text())
            engine.setLyrics(lines, rasterizeLyrics(lines, canvasRef.current?.height ?? 0) ?? undefined)
            return lines.length
          }
        }
        await engine.init()
        if (disposed) return
        const loaded = await loadSceneInto(engine, scene, () => disposed, {
          onStage: () => {
            // Stage up: paint now, models stream in behind.
            engine.runRenderLoop()
            setStageReady(true)
          },
          onBytes: setBundleProgress,
          onBundle: (files) => {
            bundleRef.current = files
            setBundleReady(true)
          },
          // Each model joins the lists as it lands, so a host can name it, show
          // its row and give it its motion while the rest are still loading.
          onModel: (info, groups, stage, prop) => {
            setModels((prev) => [...prev, info])
            setGroupsByModel((prev) => ({ ...prev, [info.id]: groups }))
            if (stage) setStages((prev) => [...prev, stage])
            if (prop) setProps((prev) => [...prev, prop])
          },
        })
        if (!loaded) return
        bundleRef.current = loaded.bundle
        // The track's companions — AFTER the bundle, which is where a published
        // scene carries its own copies. Not awaited: a scene must paint whether
        // or not either exists.
        void loadMidiFor(scene.assets.midi, engine, () => disposed, bundleRef.current, setMidiClip)
        void loadLyricsFor(scene.assets.lyrics, engine, () => disposed, canvasRef.current?.height ?? 0, bundleRef.current, setLyricsClip)
        const { infos, groups: groupsMap } = loaded
        setModels(infos)
        setStages(loaded.stageList)
        setProps(loaded.propList)
        for (const [id, anim] of loaded.restoredAnims) planeAnims.current.set(id, anim)
        setPlanes(loaded.planeList)
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
      // AND THE FLAGS THIS ENGINE SET. They are state, so Fast Refresh keeps
      // them across an edit while this cleanup throws the engine away — and
      // `ready` staying true through a teardown is invisible and total: the
      // reveal in app/page.tsx is keyed on it, loadSceneInto deliberately leaves
      // animated models HIDDEN for that reveal to un-hide, and with the flag
      // unchanged the effect never re-runs. The scene reloads, styles, and shows
      // nothing, with no error anywhere because nothing failed.
      setReady(false)
      setStageReady(false)
    }
  }, [])

  /**
   * Hovering a material row shows WHERE that material is, twice over.
   *
   * The tint alone answers "which of these is it" only where the material faces
   * the camera; a strip of trim behind an arm reads as nothing at all. The
   * wireframe draws the same faces as topology, so a material that is mostly
   * hidden still shows its shape — the same overlay reze-build puts under a
   * picked material, here on hover.
   *
   * Depth is still written by the full mesh, so the wireframe sits ON the body
   * rather than floating through it: the question is where these faces are, and
   * an answer that ignores the torso in front of them is not one.
   */
  const highlight = useCallback((modelId: string, material: string | null) => {
    const engine = engineRef.current
    if (!engine) return
    engine.setSelectedMaterial(material ? modelId : null, material)
    engine.setVertexOverlay(material ? modelId : null, { material })
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
  // Stage edits read the live list here and keep the engine call OUTSIDE the
  // state updater: React invokes updaters twice in StrictMode, which would
  // double-issue every engine write.
  const planesRef = useRef<PlaneInfo[]>([])
  /** One clock follower per moving card — the state is per element. */
  const planeFollowers = useRef(new Map<string, MediaFollower>())
  /** Decoders and per-frame state for animated-image cards. Mutable and
   *  per-tick, which is exactly what React state must not be. */
  const planeAnims = useRef(new Map<string, PlaneAnimation>())
  /** The element time each video card last had copied, so an unchanged frame is
   *  not copied again. */
  const planeShown = useRef(new Map<string, number>())
  useEffect(() => {
    planesRef.current = planes
  }, [planes])
  const stagesRef = useRef<StageInfo[]>([])
  useEffect(() => {
    stagesRef.current = stages
  }, [stages])
  const propsRef = useRef<PropInfo[]>([])
  useEffect(() => {
    propsRef.current = props
  }, [props])

  /** Remove a model from the scene entirely (the page keeps ≥1 by policy).
   *  Declared above the adders because replacing a stage builds on it. */
  const removeModelById = useCallback((modelId: string) => {
    sceneFiles.models.delete(modelId)
    clearMaterialMaps(modelId)
    engineRef.current?.removeModel(modelId)
    setModels((prev) => prev.filter((m) => m.id !== modelId))
    // Removing the last stage un-suppresses the ground inside the engine, so
    // nothing here has to put it back.
    setStages((prev) => prev.filter((s) => s.id !== modelId))
    // A removed parent's props stand on their own now, and the switches that
    // named it go with it; the engine has already let them go.
    setProps((prev) =>
      prev
        .filter((p) => p.id !== modelId)
        .map((p) =>
          p.attach?.model === modelId || p.parentKeys.some((k) => k.model === modelId)
            ? {
                ...p,
                attach: p.attach?.model === modelId ? null : p.attach,
                parentKeys: p.parentKeys.filter((k) => k.model !== modelId),
              }
            : p,
        ),
    )
    setGroupsByModel((prev) => {
      const next = { ...prev }
      delete next[modelId]
      return next
    })
  }, [])

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
    // HIDDEN until it is finished. A loaded model draws immediately, so without
    // this the arrival is three separate events: a raw untextured mesh, then the
    // same mesh restyled a beat later, then its row appearing in the dock. The
    // boot path already works this way — loadSceneInto leaves animated models
    // hidden so the first visible frame wears the motion's first pose — and a
    // model added by hand deserves the same courtesy.
    // Where it stands, from the first frame: the offset that keeps it from
    // landing inside the model already there. Recorded rather than applied and
    // forgotten — it is the starting value of something the user can now set.
    const position: [number, number, number] = [spawnOffsetX(modelsRef.current.length), 0, 0]
    engine.setModelTransform(id, { visible: false, position: new Vec3(position[0], position[1], position[2]) })
    let groups: StyleGroup[]
    try {
      await engine.autoStyleGroups(id)
      groups = withSpecialGroups(await restyled(engine, id, engine.getStyleGroups(id)))
    } finally {
      // Whatever happened to the styling, the model comes back: an unstyled
      // model is a look to fix, an invisible one is a model you cannot find.
      engine.setModelTransform(id, { visible: true })
    }
    // One commit with the reveal above it — the mesh, its shading and its row
    // land on the same frame.
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model, undefined, { at: position, guess: true })])
    setGroupsByModel((prev) => ({ ...prev, [id]: groups }))
    return id
  }, [])

  /**
   * ADD a stage — environment geometry rather than a cast member.
   *
   * A stage is loaded into `models` like anything else, because its materials
   * go through the same group → shader-graph path (that IS the reason pure-PMX
   * stages are worth supporting). `stages` is the separate list that keeps it
   * out of the cast: no motion slot, no spawn offset, placed by transform.
   */
  /**
   * Load a stage model. `part` adds it to the stage already there — an
   * accessory its folder ships beside the .pmx, a sky dome or an effect layer —
   * instead of replacing it.
   */
  const loadStageModel = async (files: File[] | FileList, pmxFile: File, part: boolean): Promise<string> => {
    const engine = engineRef.current
    if (!engine) throw new Error("engine not ready")
    // A scene holds ONE stage, so uploading another replaces it. Two stages mean
    // two floors at y=0 with identical depth — they z-fight across the whole
    // floor, flashing as the camera turns, and no amount of depth precision can
    // separate surfaces that are exactly coplanar. There is also no sense in
    // which a scene is standing in two places at once. The parts that came in
    // its folder are the same stage, and arrive in its place.
    if (!part) for (const prev of stagesRef.current) removeModelById(prev.id)
    const id = uniqueModelId(pmxFile.name)
    sceneFiles.models.set(id, { pmx: pmxFile, files: Array.from(files) })
    const model = await engine.loadStage(id, { files, pmxFile })
    // Deliberately NOT auto-grouped. resolvePreset matches material names by
    // substring against character hints (hair / eye / 髪 / 肌 …), and a stage's
    // materials are named for architecture. A chance hit does not just pick an
    // odd look — the hair and eye presets carry renderClass, so a wall would be
    // drawn in the hair pass or made to write the eye stencil. Ungrouped is the
    // right default here: the neutral base graph, with the user free to group
    // the stage by hand exactly as they would a character.
    const groups = withSpecialGroups(engine.getStyleGroups(id))
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model)])
    setGroupsByModel((prev) => ({ ...prev, [id]: groups }))
    // A part starts where the stage stands, and moves with it from then on.
    const transform = part ? (stagesRef.current[0]?.transform ?? DEFAULT_STAGE_TRANSFORM) : DEFAULT_STAGE_TRANSFORM
    if (part) engine.setModelTransform(id, stageTransformToEngine(transform))
    setStages((prev) => [...prev, { id, file: pmxBaseName(pmxFile.name), transform, morphs: {} }])
    return id
  }
  const addStageFromFiles = useCallback(
    (files: File[] | FileList, pmxFile: File) => loadStageModel(files, pmxFile, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeModelById],
  )
  const addStagePartFromFiles = useCallback(
    (files: File[] | FileList, pmxFile: File) => loadStageModel(files, pmxFile, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeModelById],
  )

  /**
   * ADD a prop: a PMX the cast holds or wears. Styled the way a cast member is —
   * auto-grouped from its material names and hidden until the look lands — and
   * placed the way a stage is, without the stage's one-per-scene rule: a scene
   * holds as many props as hands.
   */
  const addPropFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File): Promise<string> => {
    const engine = engineRef.current
    if (!engine) throw new Error("engine not ready")
    const id = uniqueModelId(pmxFile.name)
    sceneFiles.models.set(id, { pmx: pmxFile, files: Array.from(files) })
    const model = await engine.loadProp(id, { files, pmxFile })
    engine.setModelTransform(id, { visible: false })
    let groups: StyleGroup[]
    try {
      await engine.autoStyleGroups(id)
      groups = withSpecialGroups(await restyled(engine, id, engine.getStyleGroups(id)))
    } finally {
      engine.setModelTransform(id, { visible: true })
    }
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model)])
    setGroupsByModel((prev) => ({ ...prev, [id]: groups }))
    setProps((prev) => [...prev, { id, file: pmxBaseName(pmxFile.name), transform: DEFAULT_STAGE_TRANSFORM, morphs: {}, attach: null, parentKeys: [] }])
    return id
  }, [])

  /**
   * Add a picture to the scene as a flat card.
   *
   * The image's own proportions set the width, so a card is never stretched:
   * the height is the dial and the aspect follows the file. Placed at the world
   * origin facing the front, which is where the camera starts — a card that
   * arrives somewhere you have to go looking for reads as not having arrived.
   */
  const addPlaneFromFile = useCallback(async (file: File): Promise<string | null> => {
    const engine = engineRef.current
    if (!engine) return null
    try {
      const media = await preparePlaneMedia(file)
      if (!media) return null
      const { video, animation, frameWidth, frameHeight, firstFrame } = media

      // Its own proportions AND its own size. Clamped only at the bottom, so a
      // favicon-sized upload is still something you can find and grab.
      const height = Math.max(1, frameHeight / PLANE_PIXELS_PER_UNIT)
      const width = Math.max(1, frameWidth / PLANE_PIXELS_PER_UNIT)
      const name = uniqueModelId(file.name)
      // BESIDE the last card, not inside it — the same rule an added model
      // follows. Cards are uploaded in batches and every one landing on the
      // origin is a stack you have to take apart before you can see what you
      // added. Along X because a card faces the camera: sliding sideways keeps
      // all of them in shot, where stepping toward the lens would hide the ones
      // behind.
      //
      // AND STANDING ON THE FLOOR, not straddling it. A card is centred on its
      // own origin, so arriving at y=0 buries its lower half — and the ground
      // then occludes that half, which is what a floor is for and reads as
      // correct only while you can SEE the floor. Turned down to nothing for
      // the shadow catcher it still writes depth, so the card came out cut off
      // by something invisible. Half its height up is where a standing card
      // goes anyway.
      const transform: StageTransform = {
        ...DEFAULT_STAGE_TRANSFORM,
        position: [spawnOffsetX(planesRef.current.length), height / 2, 0],
      }
      const id = await engine.addPlane({
        image: firstFrame,
        name,
        width,
        height,
        transform: stageTransformToEngine(transform),
        // See the restore path: any rewritten texture, not only a video's.
        dynamic: video !== null || animation !== null,
      })
      if (animation) planeAnims.current.set(id, animation)
      // Retained for the same reason a model's files are: a publish re-packs
      // the bytes the scene is wearing rather than asking for them again.
      sceneFiles.planes.set(id, file)
      setPlanes((prev) => [
        ...prev,
        {
          id,
          file: file.name,
          width,
          height,
          transform,
          video,
          animated: animation !== null,
          frameWidth,
          frameHeight,
        },
      ])
      return id
    } catch {
      return null
    }
  }, [])

  /**
   * Push every moving card's current frame into its texture.
   *
   * Called from the same tick as everything else. A still card costs nothing
   * here — the list is walked and skipped — and a moving one costs one texture
   * copy, which is what a video plane is.
   */
  const tickPlanes = useCallback((time: number, playing: boolean, exporting = false) => {
    const engine = engineRef.current
    if (!engine) return
    if (exporting) {
      // The export writes every card's texture itself, from the file, at its
      // own frame times. Leaving the elements running would decode frames
      // nothing reads and fight the writes that matter.
      for (const p of planesRef.current) p.video?.pause()
      return
    }
    for (const p of planesRef.current) {
      if (p.video) {
        // The clip's clock, under the shared policy — a card follows the
        // animation exactly as the backdrop does.
        let follow = planeFollowers.current.get(p.id)
        if (!follow) {
          follow = createMediaFollower()
          planeFollowers.current.set(p.id, follow)
        }
        follow(p.video, time, playing)
        // Only when the element has actually advanced. A 30fps clip on a 60Hz
        // display shows each frame twice, so half of these copies were the same
        // pixels again — and a copy of a 4K frame is not free.
        const at = p.video.currentTime
        if (p.video.readyState >= 2 && planeShown.current.get(p.id) !== at) {
          planeShown.current.set(p.id, at)
          engine.setPlaneFrame(p.id, p.video, p.frameWidth, p.frameHeight)
        }
        continue
      }
      if (!p.animated) continue
      const a = planeAnims.current.get(p.id)
      if (!a || a.busy) continue
      const at = ((time % a.span) + a.span) % a.span
      let want = 0
      while (want < a.ends.length - 1 && at >= a.ends[want]) want++
      if (want === a.shown) continue
      a.busy = true
      void a.dec
        .decode({ frameIndex: want })
        .then(({ image }) => {
          const cx = a.canvas.getContext("2d")
          if (cx) {
            cx.clearRect(0, 0, a.canvas.width, a.canvas.height)
            cx.drawImage(image, 0, 0)
            engineRef.current?.setPlaneFrame(p.id, a.canvas, p.frameWidth, p.frameHeight)
          }
          image.close()
          a.shown = want
        })
        .catch(() => {})
        .finally(() => {
          a.busy = false
        })
    }
  }, [])

  /** Place a card. Same shape as a stage's — see PlaneInfo. */
  const setPlaneTransform = useCallback((id: string, patch: Partial<StageTransform>) => {
    setPlanes((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        const next = { ...p.transform, ...patch }
        engineRef.current?.setModelTransform(id, stageTransformToEngine(next))
        return { ...p, transform: next }
      }),
    )
  }, [])

  /** Take every card out of the scene: the models, the decoders, the elements
   *  and the retained bytes. What a reset needs, and what a new scene needs. */
  const clearPlanes = useCallback(() => {
    for (const p of planesRef.current) {
      engineRef.current?.removeModel(p.id)
      sceneFiles.planes.delete(p.id)
      if (p.video) {
        p.video.pause()
        URL.revokeObjectURL(p.video.src)
      }
      planeAnims.current.get(p.id)?.dec.close()
      planeAnims.current.delete(p.id)
      planeFollowers.current.delete(p.id)
    }
    setPlanes([])
  }, [])

  const removePlane = useCallback((id: string) => {
    sceneFiles.planes.delete(id)
    engineRef.current?.removeModel(id)
    setPlanes((prev) => {
      const gone = prev.find((p) => p.id === id)
      if (gone?.video) {
        gone.video.pause()
        URL.revokeObjectURL(gone.video.src)
      }
      planeAnims.current.get(id)?.dec.close()
      planeAnims.current.delete(id)
      planeShown.current.delete(id)
      planeFollowers.current.delete(id)
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  /** Place a prop. Absolute while it stands alone; offsets in the bone's space
   *  while it hangs from one. */
  const setPropTransform = useCallback((id: string, patch: Partial<StageTransform>) => {
    const current = propsRef.current.find((p) => p.id === id)
    if (!current) return
    const next = { ...current, transform: { ...current.transform, ...patch } }
    if (engineRef.current) placeProp(engineRef.current, next)
    setProps((prev) => prev.map((p) => (p.id === id ? next : p)))
  }, [])

  /**
   * Hang a prop from a bone, or set it down.
   *
   * Either way the position and rotation start over at zero: they change
   * meaning with the toggle — world placement one way, bone offset the other
   * — and numbers carried across would strand a world position as an offset
   * (camera follow learned this the hard way). Scale keeps its meaning and
   * its value.
   */
  const setPropAttach = useCallback((id: string, attach: SceneAttach | null) => {
    const current = propsRef.current.find((p) => p.id === id)
    if (!current) return
    const next: PropInfo = {
      ...current,
      attach,
      transform: { ...current.transform, position: [0, 0, 0], rotation: [0, 0, 0] },
    }
    if (engineRef.current) placeProp(engineRef.current, next)
    setProps((prev) => prev.map((p) => (p.id === id ? next : p)))
  }, [])

  /** A prop's parent switches after its start hold — the timeline's Parent row.
   *  Sorted by frame, and never at frame 0, which is the start hold's. */
  const setPropParentKeys = useCallback((id: string, keys: SceneParentKey[]) => {
    const current = propsRef.current.find((p) => p.id === id)
    if (!current) return
    const next: PropInfo = { ...current, parentKeys: keys.filter((k) => k.frame > 0).sort((a, b) => a.frame - b.frame) }
    if (engineRef.current) placeProp(engineRef.current, next)
    setProps((prev) => prev.map((p) => (p.id === id ? next : p)))
  }, [])

  /** The start hold set whole — parent, offset and turn together — so a switch
   *  at frame 0 can keep the prop where it is. setPropAttach starts over at zero. */
  const setPropStart = useCallback(
    (id: string, attach: SceneAttach | null, position: [number, number, number], rotation: [number, number, number]) => {
      const current = propsRef.current.find((p) => p.id === id)
      if (!current) return
      const next: PropInfo = { ...current, attach, transform: { ...current.transform, position, rotation } }
      if (engineRef.current) placeProp(engineRef.current, next)
      setProps((prev) => prev.map((p) => (p.id === id ? next : p)))
    },
    [],
  )

  /** Place a stage. Position and rotation are absolute, scale is uniform. */
  /** Place the stage. Its parts are the same set, so they move with it. */
  const setStageTransform = useCallback((id: string, patch: Partial<StageTransform>) => {
    const current = stagesRef.current.find((s) => s.id === id)
    if (!current) return
    const next = { ...current.transform, ...patch }
    for (const s of stagesRef.current) engineRef.current?.setModelTransform(s.id, stageTransformToEngine(next))
    setStages((prev) => prev.map((s) => ({ ...s, transform: next })))
  }, [])

  /**
   * Place a cast member — where their root stands.
   *
   * The stage setter's shape, on the other kind of model. It writes the engine
   * and the row together: the row is what the collector reads, so a position
   * that only reached the engine would look right until the scene was saved.
   */
  const setCastPosition = useCallback((id: string, position: [number, number, number]) => {
    engineRef.current?.setModelTransform(id, { position: new Vec3(position[0], position[1], position[2]) })
    // Chosen, so it is no longer a guess: it survives the next motion, and it is
    // written to the document.
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, position, spawnGuess: false } : m)))
  }, [])

  /** How big they stand, uniformly. Chosen the moment it is touched, exactly as
   *  a position is — a scaled model whose placement was still a guess would
   *  reload at a different size, which is the one thing a slider must not do. */
  const setCastScale = useCallback((id: string, scale: number) => {
    engineRef.current?.setModelTransform(id, { scale })
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, scale, spawnGuess: false } : m)))
  }, [])

  /** Which way a cast member faces — their ROOT, in degrees per axis.
   *
   *  A motion drives the bones under this, so it survives one: the root is the
   *  placement, and turning a dancer to face the mirror must not be undone by
   *  the next clip. Same shape as the two setters above.
   */
  const setCastRotation = useCallback((id: string, rotation: [number, number, number]) => {
    engineRef.current?.setModelTransform(id, { rotation: castRotationToEngine(rotation) })
    // spawnGuess is deliberately LEFT ALONE, unlike the two setters above.
    //
    // It means "nobody has chosen where this model stands", and centerModel
    // reads it to move a model to the origin when a clip arrives. Turning
    // someone to face a mirror says nothing about where they stand, so clearing
    // it here made a rotated model refuse to centre — the rotation appeared to
    // drag the position with it.
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, rotation } : m)))
  }, [])

  /**
   * The stretches a cast member is on stage for — its lane on the timeline.
   *
   * Normalised on the way in, so the lane, the evaluator and the document all
   * read one list: ascending, and nothing with no length in it.
   *
   * Carrying a lane also turns on cloth simulation while hidden. That is the
   * whole reason a costume swap reads as a cut rather than as a glitch: a dress
   * simulated from rest at the moment it is revealed snaps into place in front
   * of the audience. A model whose lane is emptied goes back to costing nothing
   * while invisible — and back to WHOLE, because "on stage throughout" is not
   * something a model can be half dissolved for. Deleting the last clip while
   * she was mid-departure would otherwise leave her burned away for good.
   */
  const setCastVisibility = useCallback((id: string, windows: VisibilityWindow[]) => {
    const visibility = normalizeVisibility(windows)
    engineRef.current?.setModelPhysicsWhileHidden(id, visibility.length > 0)
    if (visibility.length === 0) engineRef.current?.setModelDissolve(id, 1)
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, visibility } : m)))
  }, [])

  /** Flip one of a stage's switches. */
  const setStageMorph = useCallback((id: string, morph: string, weight: number) => {
    engineRef.current?.getModel(id)?.setMorphWeight(morph, weight)
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, morphs: { ...s.morphs, [morph]: weight } } : s)))
  }, [])

  /** Return every switch on a stage to zero. */
  const resetStageMorphs = useCallback((id: string) => {
    const current = stagesRef.current.find((s) => s.id === id)
    if (!current) return
    const model = engineRef.current?.getModel(id)
    for (const morph of Object.keys(current.morphs)) model?.setMorphWeight(morph, 0)
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, morphs: {} } : s)))
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
      const at: [number, number, number] | undefined = transform
        ? [transform.position.x, transform.position.y, transform.position.z]
        : undefined
      // Uploaded models have no curated map — auto-group from name hints alone.
      await engine.autoStyleGroups(id)
      const groups = withSpecialGroups(await restyled(engine, id, engine.getStyleGroups(id)))
      setModels((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? // The slot's placement survives the upload, and so does whether
              // anyone chose it: replacing the model does not place it.
              infoFor(id, pmxBaseName(pmxFile.name), model, undefined, at ? { at, guess: m.spawnGuess } : undefined)
            : m,
        ),
      )
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

  /**
   * Drop a model's spawn GUESS.
   *
   * `spawnOffsetX` exists so a newly added model does not land inside the first one —
   * a framing aid for a model standing in its rest pose. A motion carries its own
   * placement, so once the user loads one the offset is the app second-guessing the
   * file.
   *
   * A placement someone CHOSE is left alone. It is the same act — where this model
   * stands — and the app's guess about it cannot outrank the answer: a scene with
   * two characters standing where their author put them would otherwise pile them
   * both on the origin the moment either was given a new motion, and again on every
   * reload, since the document's clips load through here.
   *
   * The row is written with the engine. It is what the gear's sliders read and what
   * the collector packs, so a centring that only reached the engine would leave both
   * of them stating a position the model is not standing at.
   */
  const centerModel = useCallback((modelId: string) => {
    if (!modelsRef.current.find((m) => m.id === modelId)?.spawnGuess) return
    engineRef.current?.setModelTransform(modelId, { position: new Vec3(0, 0, 0) })
    // spawnGuess ENDS HERE, and that is the point of clearing it.
    //
    // The flag means "nobody chose this, so do not write it down" — the
    // collector skips a guessed placement so the app's arrangement offset is
    // not frozen into every scene. But centring is a decision: the clip owns
    // this model's root from now on, and origin is where it has to stand for
    // the motion to land where it was authored.
    //
    // Left set, the origin was never written, and only the EDITOR knew about
    // it: loading a scene re-applies spawnOffsetX to any cast member with no
    // transform, so a second model that had been centred here stood nine units
    // to the side in the viewer. The document has to say where the model is.
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, position: [0, 0, 0], spawnGuess: false } : m)))
  }, [])

  /** Load a local .vmd onto ONE model (object URL), posed at frame 0 but PAUSED */
  const loadVmdFile = useCallback(async (modelId: string, file: File): Promise<string | null> => {
    const model = engineRef.current?.getModel(modelId)
    if (!model) return null
    const url = URL.createObjectURL(file)
    try {
      await model.loadVmd(file.name, url)
      model.show(file.name) // activate + pose frame 0, paused (user presses play)
      centerModel(modelId) // the clip places this model from here on
      // Frame 0 of a new clip is an arbitrary jump from whatever pose was held
      engineRef.current?.resetPhysics()
      return file.name
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [centerModel])

  /**
   * Lay an morph VMD (表情モーション) over a model's motion.
   *
   * `clipName` is the MOTION's clip, because the morph dresses that clip
   * rather than standing on its own — loaded under its own name it would be a
   * second clip, and only one clip plays at a time. With no motion loaded yet
   * the morph becomes the clip and is shown, so a face still moves; when a
   * motion arrives later it rebuilds the clip, and the caller re-applies the
   * morph it still holds.
   */
  const loadMorphFile = useCallback(
    async (modelId: string, file: File): Promise<string | null> => {
      const model = engineRef.current?.getModel(modelId)
      if (!model) return null
      const url = URL.createObjectURL(file)
      // ASK THE MODEL which clip is playing rather than naming one ourselves.
      // A clip's engine key is whatever loaded it: an uploaded VMD keys by its
      // file name, but one unpacked from a scene bundle keeps its bundle PATH
      // as its name — so the document's display name is NOT the key. Naming
      // the clip from the document merged morphs into a clip nothing
      // plays, which looked exactly like a file with no morphs in it.
      const playing = model.getAnimationProgress().animationName
      const target = playing ?? file.name
      try {
        await model.loadVmd(target, url, { tracks: "morphs" })
        trimToMotion(model, target)
        // Only when the morph IS the clip. With a motion playing, showing
        // it again would restart the dance from frame 0.
        if (!playing) model.show(target)
        return file.name
      } catch (e) {
        console.warn("[clips] morph failed to install:", e)
        return null
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    [],
  )

  /** The same, for an morph already published or packed in the bundle. */
  const loadMorphUrl = useCallback(
    async (modelId: string, name: string, url: string): Promise<string | null> => {
      const model = engineRef.current?.getModel(modelId)
      if (!model) return null
      const playing = model.getAnimationProgress().animationName
      const target = playing ?? name
      try {
        await model.loadVmd(target, url, { tracks: "morphs" })
        trimToMotion(model, target)
        if (!playing) model.show(target)
        return name
      } catch {
        return null
      }
    },
    [],
  )

  /**
   * Install a MIDI or an .lrc the user picked by hand.
   *
   * Retained under its OWN name. The document names these files, so nothing has
   * to be renamed to keep a convention working — what you picked is what
   * travels, and what the document points at.
   */
  const installMidiFile = useCallback(async (file: File): Promise<string | null> => {
    const engine = engineRef.current
    if (!engine) return null
    try {
      const bytes = await file.arrayBuffer()
      engine.setMidiNotes(parseMidi(bytes))
      sceneFiles.score = new File([bytes], file.name)
      setMidiClip(file.name)
      return file.name
    } catch {
      return null
    }
  }, [])

  const installLyricsFile = useCallback(async (file: File): Promise<string | null> => {
    const engine = engineRef.current
    if (!engine) return null
    try {
      const bytes = await file.arrayBuffer()
      const lines = parseLRC(new TextDecoder().decode(bytes))
      engine.setLyrics(lines, rasterizeLyrics(lines, canvasRef.current?.height ?? 0) ?? undefined)
      sceneFiles.lyrics = new File([bytes], file.name)
      setLyricsClip(file.name)
      return file.name
    } catch {
      return null
    }
  }, [])

  /**
   * Rasterise the lyric sheet for a height it is about to be DRAWN at.
   *
   * The atlas is resolution-bound — a row stored at one size and sampled at
   * another is what soft text is — and every install above sizes it for the
   * viewport, which is the wrong size for a 4K render. The export calls this
   * with its output height and again with the viewport's on the way out.
   *
   * Re-parsed from the bytes the scene already retains for publishing rather
   * than from lines kept in a second place: one source, and no way for the two
   * to disagree about what the song says.
   */
  const rasterLyricsAt = useCallback(async (heightPx: number, from = 0) => {
    const engine = engineRef.current
    const file = sceneFiles.lyrics
    if (!engine || !file || heightPx <= 0) return
    try {
      const lines = parseLRC(new TextDecoder().decode(await file.arrayBuffer()))
      if (lines.length === 0) return
      const atlas = rasterizeLyrics(lines, heightPx, from)
      engine.setLyrics(lines, atlas ?? undefined)
      // Remembered so the page can be moved without re-reading the file, and so
      // the tick below can tell in a comparison whether it needs to.
      lyricPage.current = atlas ? { lines, from: atlas.from, to: atlas.to, heightPx } : null
    } catch {
      // The sheet on screen stays; a failed re-raster must not clear the words.
    }
  }, [])

  /**
   * Keep the resident page under the playhead.
   *
   * Called every frame and almost always does nothing: the check is two
   * comparisons against the range already loaded. It only rasterises when the
   * song walks off the page, which for a full-size sheet is every dozen-odd
   * lines — a handful of times across a track.
   *
   * The page starts AT the line that ran off rather than centred on it, because
   * a song runs forwards: paging from the current line gives the whole sheet to
   * what is coming instead of spending half of it on verses already sung. A
   * backward seek pages from there just the same.
   */
  const syncLyricsTo = useCallback((time: number) => {
    const page = lyricPage.current
    if (!page) return
    const { lines } = page
    // The live line, by the same rule the engine's accessor uses.
    let i = -1
    for (let k = 0; k < lines.length; k++) {
      if (time >= lines[k].start && time < lines[k].end) {
        i = k
        break
      }
    }
    if (i < 0 || (i >= page.from && i < page.to)) return
    // Guard against a page that holds one line and cannot advance — re-asking
    // for the same range every frame would rasterise every frame.
    if (i === page.from) return
    void rasterLyricsAt(page.heightPx, i)
  }, [rasterLyricsAt])

  const clearMidi = useCallback(() => {
    engineRef.current?.setMidiNotes(null)
    sceneFiles.score = null
    setMidiClip(null)
  }, [])

  const clearLyrics = useCallback(() => {
    engineRef.current?.setLyrics(null)
    sceneFiles.lyrics = null
    setLyricsClip(null)
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
      centerModel(modelId) // same handover to the clip as loadVmdFile
      engineRef.current?.resetPhysics() // same arbitrary jump to frame 0 as loadVmdFile
      return name
    } catch {
      return null
    }
  }, [centerModel])

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
      return engine.upsertStyleGroup(modelId, withMaterialMaps(modelId, [group])[0], opts)
    },
    [],
  )

  /** Replace one model's whole set (structural changes: create/move/remove groups). */
  const applyGroups = useCallback(async (modelId: string, next: StyleGroup[]) => {
    setGroupsByModel((prev) => ({ ...prev, [modelId]: next }))
    reportGroups(
      "applyGroups",
      await engineRef.current?.applyStyleGroups(
        modelId,
        withMaterialMaps(
          modelId,
          next.filter((g) => g.materials.length > 0),
        ),
      ),
    )
  }, [])

  /** Back to a fresh load: re-derive grouping from the doc's seed + name hints, and unhide */
  /** Restore a model's grouping: the document's groups when it has an entry, the
   *  engine's auto-classification otherwise. */
  const resetStyleGroups = useCallback(async (modelId: string, groups?: StyleGroup[]) => {
    const engine = engineRef.current
    if (!engine) return
    if (groups?.length)
      reportGroups(
        "reset",
        await engine.applyStyleGroups(modelId, withMaterialMaps(modelId, groups.filter((g) => g.materials.length > 0))),
      )
    else await engine.autoStyleGroups(modelId)
    for (const m of modelsRef.current.find((x) => x.id === modelId)?.materials ?? []) {
      if (!m.visible) engine.toggleMaterialVisible(modelId, m.name)
    }
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, materials: m.materials.map((x) => ({ ...x, visible: true })) } : m)),
    )
    const next = groups ?? (await restyled(engine, modelId, engine.getStyleGroups(modelId)))
    setGroupsByModel((prev) => ({ ...prev, [modelId]: withSpecialGroups(next) }))
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
    // The outgoing scene's last report was `done` — left standing, the incoming
    // scene opens on "unpacking" before it has fetched anything.
    setBundleProgress(null)
    try {
      // The outgoing scene's models and its retained upload files go together —
      // keeping either would leak into the incoming document.
      for (const m of modelsRef.current) engine.removeModel(m.id)
      sceneFiles.models.clear()
      sceneFiles.audio = null
      sceneFiles.score = null
      sceneFiles.lyrics = null
      sceneFiles.camera = null
      // Cards go with them, and they own more than bytes: a decoder, a playing
      // element and an object URL each. Left standing, the outgoing scene's
      // pictures would be found in the incoming one — and its videos would go
      // on decoding for a scene nobody is looking at.
      clearPlanes()
      engine.clearCameraVmd()

      const loaded = await loadSceneInto(engine, scene, stale, { onBytes: setBundleProgress })
      if (!loaded) return null
      bundleRef.current = loaded.bundle
      void loadMidiFor(scene.assets.midi, engine, stale, bundleRef.current, setMidiClip)
      void loadLyricsFor(scene.assets.lyrics, engine, stale, canvasRef.current?.height ?? 0, bundleRef.current, setLyricsClip)
      sceneRef.current = scene
      setModels(loaded.infos)
      setStages(loaded.stageList)
      setProps(loaded.propList)
      for (const [id, anim] of loaded.restoredAnims) planeAnims.current.set(id, anim)
      setPlanes(loaded.planeList)
      setGroupsByModel(loaded.groups)
      applyCamera(engine, scene.state.camera, engine.getModel(firstCastId(scene.assets.models)))
      setError(null)
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      return message
    } finally {
      if (!stale()) setReady(true)
    }
  }, [clearPlanes])

  /**
   * Push orbit framing to the engine. A loaded, enabled camera VMD drives the shot
   * instead, so this shows up only once that is off.
   */
  const setCameraView = useCallback((c: SceneCamera) => {
    const engine = engineRef.current
    if (!engine) return
    // Same rule as the load path — `models` carries stages too, so index 0 is
    // not necessarily a character.
    const stageIds = new Set(stagesRef.current.map((s) => s.id))
    applyCamera(engine, c, engine.getModel(modelsRef.current.find((m) => !stageIds.has(m.id))?.id ?? ""))
  }, [])

  /**
   * Point an existing follow at a different model, and change NOTHING else.
   *
   * For a replace. The shot is the one you were looking through — whatever you
   * had orbited to — and only the thing it was riding has been swapped
   * underneath it. Re-applying the whole camera would put alpha, beta, distance
   * and fov back to what the DOCUMENT holds, which since orbiting stopped being
   * an edit is not where the camera is: the view would jump on every replace.
   *
   * By id rather than by looking up the lead, because `modelsRef` is fed from
   * state and still describes the model that just left.
   */
  const rebindCameraFollow = useCallback((modelId: string, c: SceneCamera) => {
    const engine = engineRef.current
    if (!engine || !c.follow) return
    const model = engine.getModel(modelId)
    if (!model) return
    engine.setCameraFollow(model, c.follow, new Vec3(...c.target), 0.15)
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
    viewportRef,
    ready,
    stageReady,
    bundleProgress,
    bundleReady,
    error,
    models,
    stages,
    addStageFromFiles,
    addStagePartFromFiles,
    setStageTransform,
    props,
    addPropFromFiles,
    setPropTransform,
    setPropAttach,
    setPropParentKeys,
    setPropStart,
    setCastPosition,
    setCastScale,
    setCastRotation,
    setCastVisibility,
    planes,
    addPlaneFromFile,
    tickPlanes,
    setPlaneTransform,
    removePlane,
    clearPlanes,
    setStageMorph,
    resetStageMorphs,
    groupsByModel,
    upsertGroup,
    applyGroups,
    resetStyleGroups,
    bundleFile,
    bundleFiles,
    swapScene,
    setCameraView,
    rebindCameraFollow,
    setGroupParam,
    highlight,
    toggleVisible,
    addModelFromFiles,
    replaceModelFromFiles,
    removeModelById,
    loadVmdFile,
    loadVmdUrl,
    loadMorphFile,
    loadMorphUrl,
    installMidiFile,
    installLyricsFile,
    midiClip,
    lyricsClip,
    rasterLyricsAt,
    syncLyricsTo,
    clearMidi,
    clearLyrics,
    centerModel,
    stopAnimation,
  }
}
