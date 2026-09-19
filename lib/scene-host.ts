// The scene pipeline: a scene document in, a loaded engine out.
//
// React-free on purpose. This is everything both hosts need and neither host
// owns — the editor drives it through `useEngine`, and the desktop pet drives
// it directly, with no framework in between. Keeping it here is what stops the
// two from growing separate ideas of what a scene means, which is exactly how
// the editor and the viewer drifted apart once before.

import { Engine, parseLRC, parseMidi, Quat, Vec3, type GizmoDragEvent, type Model, type ModelParentKey, type RenderClass, type StyleGroup } from "reze-engine"
import { FPS, clipTrimmedToMotion } from "@/lib/clip"
import { rasterizeLyrics } from "@/lib/lyrics-raster"
import { SLOT_GRAPHS } from "@/lib/materials"
import { graphLibraryName } from "@/lib/refs"
import { graphRole, packGraph } from "@/lib/materials"
import { loadLookPref } from "@/lib/look-pref"
import { idbBundleId, modelPmxUrl, type AssetRef, type Scene, type SceneAttach, type SceneCamera, type SceneParentKey, type SceneStageTransform } from "@/lib/scene"
import { unzipToFiles } from "@/lib/uploads"
import { loadLocalBundle } from "@/lib/asset-store"
import { sceneFiles } from "@/lib/scene-files"
import { clearMaterialMaps, loadMaterialMaps, withMaterialMaps } from "@/lib/material-maps"
import { BACKDROP_VIDEO_RE, openAnimatedImage } from "@/lib/backdrop"
import { groundExtent, hexToLinearVec3 } from "@/lib/scene-settings"
import { visibilityAt, visibleAt, type VisibilityWindow } from "@/lib/visibility"

/**
 * Surface what the engine said about a style-group apply.
 *
 * applyStyleGroups returns per-group diagnostics and every call site here threw
 * them away, so a graph that failed to compile looked exactly like one that had
 * never been applied — the engine drops an uncompilable group rather than render
 * it wrongly, which is right, and silent, which left us guessing.
 */
export function reportGroups(where: string, result: { ok: boolean; groups?: { groupId: string; ok: boolean; diagnostics: unknown[] }[] } | undefined) {
  if (!result || result.ok) return
  for (const g of result.groups ?? []) {
    if (g.ok) continue
    // SEVERITY DECIDES THE CHANNEL. A group also comes back not-ok when a newer
    // apply overtook it — "superseded by a newer edit", severity warning — which
    // is the ordinary outcome of two applies racing and not a thing anyone can
    // act on: the newer set is the one on screen. Shouting it as an error sent
    // people hunting a broken graph that had compiled perfectly well.
    const failed = (g.diagnostics as { severity?: string }[]).some((d) => d?.severity === "error")
    // Stringified: a diagnostic is an object, and the console collapses those
    // to {…} in a stack-heavy log — which hid the actual message for rounds.
    const detail = JSON.stringify(g.diagnostics, null, 1)
    if (failed) console.error(`[style] ${where}: group "${g.groupId}" failed —`, detail)
    else console.info(`[style] ${where}: group "${g.groupId}" not applied —`, detail)
  }
}

// Eye and Hair are pinned, non-deletable groups
const SPECIAL_GROUPS: { id: string; label: string; renderClass: RenderClass; preset: "eye" | "hair" }[] = [
  { id: "eye", label: "Eye", renderClass: "eye", preset: "eye" },
  { id: "hair", label: "Hair", renderClass: "hair", preset: "hair" },
]
export function infoFor(
  id: string,
  file: string,
  model: import("reze-engine").Model,
  hidden?: string[],
  placement?: { at: [number, number, number]; scale?: number; rot?: [number, number, number]; guess?: boolean },
  visibility?: VisibilityWindow[],
): EngineModelInfo {
  return {
    id,
    file,
    ...(visibility?.length ? { visibility } : {}),
    ...(placement
      ? {
          position: placement.at,
          ...(placement.scale !== undefined ? { scale: placement.scale } : {}),
          ...(placement.rot ? { rotation: placement.rot } : {}),
          ...(placement.guess ? { spawnGuess: true } : {}),
        }
      : {}),
    stats: {
      vertices: Math.round(model.getVertices().length / 8),
      bones: model.getSkeleton().bones.length,
      materials: model.getMaterials().length,
    },
    bones: model.getSkeleton().bones.map((b) => b.name),
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
export function applyCamera(engine: Engine, camera: SceneCamera, model: Model | null): void {
  // Roll is a property OF the orbit, not a replacement for it.
  //
  // The first cut pushed a whole pose instead, converting alpha/beta/distance
  // into the five channels an MMD camera carries. That reads correctly only for
  // a camera with no `follow`: under follow, `target` is an OFFSET FROM A BONE
  // rather than a world point, so a pose built from it aimed at a spot near the
  // origin and the shot swung to the far side of the scene the moment roll left
  // zero. Tilting the up vector leaves the eye and the look-at exactly where the
  // orbit put them, so following, dragging and zooming all survive it.
  engine.setCameraRoll(camera.roll ?? 0)
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

/**
 * The model the camera follows: the first CAST member, never the stage.
 *
 * Stage-ness is a flag on an entry, not a separate list, so a stage sits
 * wherever it was added — and a scene built stage-first has scenery at index 0.
 * Binding `follow` there aims the shot at a building, which never moves, so the
 * framing sat still through a motion that travelled. It only happened to some
 * scenes because it is purely a question of what order the author uploaded in.
 */
export function firstCastId(entries: readonly { model: { id: string }; stage?: boolean; prop?: boolean }[]): string {
  return entries.find((e) => !e.stage && !e.prop)?.model.id ?? ""
}

/** Progress hooks. Each fires the moment its subject is usable, so a host can
 *  paint in the order the bytes arrive rather than waiting on the last model:
 *  stage → bundle (clips, audio and the backdrop image resolve out of it) →
 *  one call per model as it finishes loading and styling. */
export type LoadProgress = {
  onStage?: () => void
  onBundle?: (files: File[] | null) => void
  onModel?: (info: EngineModelInfo, groups: StyleGroup[], stage: StageInfo | null, prop: PropInfo | null) => void
  /** Bundle download, while it is downloading. Null once the bytes are in. */
  onBytes?: (p: BundleProgress | null) => void
}

/**
 * A bundle download in flight. `total` is 0 when the server sent no length.
 *
 * `done` marks the last report, sent once the bytes are all in and the zip is
 * being walked. It is what tells "the download has not started" (null) apart
 * from "the download has finished" — the two are otherwise the same absence,
 * and a host that cannot separate them has to call the first wait by the second
 * wait's name.
 */
export type BundleProgress = { received: number; total: number; bytesPerSecond: number; done?: boolean }

export async function loadSceneInto(engine: Engine, scene: Scene, stale: () => boolean, progress: LoadProgress = {}) {
  const { onStage, onBundle, onModel, onBytes } = progress
  const s = scene.state.settings
  const infos: EngineModelInfo[] = []
  const groups: Record<string, StyleGroup[]> = {}
  // Stages are in `infos` too — their materials use the same group path. This
  // is the list that tells the UI which of them are scenery.
  const stageList: StageInfo[] = []
  const propList: PropInfo[] = []

  // ── Stage first, models after ──
  // Ground, framing and (via onStage) the render loop go up BEFORE any model
  // bytes arrive, so the page opens on the live stage — background, effect,
  // ground — while models stream in and pop into place. On a slow route
  // (models are the megabytes) this is the difference between a scene loading
  // and a blank screen loading.
  engine.setGroundVisible(s.ground.enabled)
  // A scene standing in footage opens with its floor already a catcher. The
  // sync layer would arrive at the same options a beat later, so this is not
  // what makes the mode work — it is what stops a published composite opening
  // on one frame of a solid floor painted over the picture.
  const plate = scene.assets.background?.kind === "plate"
  engine.addGround({
    diffuseColor: hexToLinearVec3(s.ground.color),
    gridLineColor: hexToLinearVec3(s.ground.grid),
    opacity: plate ? 0 : s.ground.opacity,
    shadowStrength: s.ground.shadow ? 1 : 0,
    shadowSoftness: s.sun.softness ?? 0,
    gridLineOpacity: s.ground.gridEnabled ? 0.4 : 0,
    ...groundExtent(s.ground),
  })
  applyCamera(engine, scene.state.camera, null)
  onStage?.()

  // A scene's uploads live in one bundle: a published scene's is a zip behind a URL,
  // the working scene's is the same entries in IndexedDB (an `idb:` bundle). Either
  // way the File names carry bundle paths, which is exactly what the engine resolves
  // textures against — one seam, two stores.
  // Opening a scene is four serial costs and it is not obvious which one a given
  // user is waiting on: a big published bundle is network-bound, a big MODEL is
  // decode-bound, and the two want opposite fixes. Timed rather than guessed —
  // the line lands in the console ring buffer, so a slow-open report carries the
  // breakdown instead of the word "slow".
  const t0 = performance.now()
  let bundle: File[] | null = null
  let bundleBytes = 0
  const idbId = idbBundleId(scene.assets.bundle)
  if (idbId) {
    bundle = await loadLocalBundle(idbId)
    if (stale()) return null
  } else if (scene.assets.bundle) {
    const res = await fetch(scene.assets.bundle)
    if (!res.ok) throw new Error(`Can't fetch scene assets: ${res.status}`)
    // Read the body in chunks rather than awaiting .blob(), so the wait can be
    // reported. This is the dominant cost of opening someone else's scene —
    // measured at 5.5s of a 6.1s open for a 165MB bundle — and an unmoving
    // "loading…" for that long is indistinguishable from a hang.
    const total = Number(res.headers.get("content-length")) || 0
    let blob: Blob
    if (res.body && onBytes) {
      const reader = res.body.getReader()
      const chunks: BlobPart[] = []
      let received = 0
      const started = performance.now()
      let painted = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value as unknown as BlobPart)
        received += value.byteLength
        // Four updates a second. The number is being read by a human, and a
        // per-chunk setState on a 165MB download is thousands of renders.
        const now = performance.now()
        if (now - painted > 250) {
          painted = now
          onBytes({ received, total, bytesPerSecond: received / Math.max(0.001, (now - started) / 1000) })
        }
        if (stale()) return null
      }
      blob = new Blob(chunks)
    } else {
      blob = await res.blob()
    }
    // Not null: the wait is not over, it has changed kind. Unzipping a 165MB
    // bundle is its own visible pause, and reporting "no download" here would
    // send the pill back to the name it uses before one has started.
    bundleBytes = blob.size
    onBytes?.({ received: bundleBytes, total: total || bundleBytes, bytesPerSecond: 0, done: true })
    bundle = await unzipToFiles(new File([blob], "assets.zip"))
    if (stale()) return null
  }
  const tBundle = performance.now()
  // The bundle is what clips, audio and a background image resolve out of, and
  // none of them have anything to do with how long the models take. Handed over
  // the moment it is unzipped.
  onBundle?.(bundle)
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
      // A stage has to go in through the stage door, or it comes back as an
      // ordinary cast member: physics, IK, a spawn offset, and no ground
      // suppression. The document's `stage` flag is the only thing that knows.
      model = entry.stage
        ? await engine.loadStage(entry.model.id, { files, pmxFile })
        : entry.prop
          ? await engine.loadProp(entry.model.id, { files, pmxFile })
          : await engine.loadModel(entry.model.id, { files, pmxFile })
      await loadMaterialMaps(entry.model.id, files, pmxFile.name, (f) => f.name)
    } else {
      clearMaterialMaps(entry.model.id)
      const pmxUrl = modelPmxUrl(entry.model)
      if (!pmxUrl) throw new Error(`Zip-sourced models aren't loadable from a URL yet: ${entry.model.file}`)
      model = await engine.loadModel(entry.model.id, pmxUrl)
    }
    if (stale()) return null
    // A cast member's placement, filled in by the branch below and carried into
    // its row. A stage leaves it undefined: its placement is stageList's.
    let castPlacement:
      | { at: [number, number, number]; scale?: number; rot?: [number, number, number]; guess?: boolean }
      | undefined
    // Hidden until styled: the first visible frame wears the scene's shader
    // graphs, not a flash of the default PBSDF look.
    if (entry.stage) {
      const tr = entry.transform ?? DEFAULT_STAGE_TRANSFORM
      const morphs = entry.morphs ?? {}
      stageList.push({ id: entry.model.id, file: entry.model.file, transform: tr, morphs })
      engine.setModelTransform(entry.model.id, { visible: false, ...stageTransformToEngine(tr) })
      // Switches are authored state, so they are restored before the first
      // visible frame rather than applied after the scene appears.
      for (const [morph, weight] of Object.entries(morphs)) model.setMorphWeight(morph, weight)
    } else if (entry.prop) {
      // Placed on its own for now. What it hangs from lands after the LAST
      // model, since the parent may be further down the list.
      const tr = entry.transform ?? DEFAULT_STAGE_TRANSFORM
      const morphs = entry.morphs ?? {}
      propList.push({
        id: entry.model.id,
        file: entry.model.file,
        transform: tr,
        morphs,
        attach: entry.attach ?? null,
        parentKeys: entry.parentKeys ?? [],
      })
      engine.setModelTransform(entry.model.id, { visible: false, ...stageTransformToEngine(tr) })
      for (const [morph, weight] of Object.entries(morphs)) model.setMorphWeight(morph, weight)
    } else {
      // WHERE THE DOCUMENT SAYS, and the spawn offset only where it says nothing.
      // The offset exists to keep a newly added model from landing inside the
      // first one, which is a guess about an arrangement — once someone has
      // placed the cast themselves, their placement is the answer, and a scene
      // written before the field existed still opens the way it always did.
      castPlacement = entry.transform
        ? { at: entry.transform.position, scale: entry.transform.scale, rot: entry.transform.rotation }
        : { at: [spawnOffsetX(infos.length - stageList.length - propList.length), 0, 0], guess: true }
      const at = castPlacement.at
      const rot = castPlacement.rot
      engine.setModelTransform(entry.model.id, {
        visible: false,
        position: new Vec3(at[0], at[1], at[2]),
        ...(castPlacement.scale !== undefined ? { scale: castPlacement.scale } : {}),
        ...(rot ? { rotation: castRotationToEngine(rot) } : {}),
      })
    }
    // Styling: a document carrying groups for this model (a restored or imported scene)
    const docGroups = scene.state.groups?.[entry.model.id]
    if (docGroups) {
      // Empty groups are UI-only drop targets — withheld from the engine.
      reportGroups(
        `load ${entry.model.file}`,
        await engine.applyStyleGroups(
          entry.model.id,
          withMaterialMaps(
            entry.model.id,
            docGroups.filter((g) => g.materials.length > 0),
          ),
        ),
      )
    } else if (!entry.stage) {
      // Never auto-group a stage: resolvePreset matches material names by
      // substring against character hints, and the hair/eye presets carry a
      // renderClass — a chance hit would put a wall in the hair pass or have it
      // write the eye stencil. Ungrouped is the honest default for scenery.
      await engine.autoStyleGroups(entry.model.id)
    }
    if (stale()) return null
    const hidden = scene.state.hidden?.[entry.model.id] ?? []
    for (const name of hidden) engine.toggleMaterialVisible(entry.model.id, name)
    const info = infoFor(entry.model.id, entry.model.file, model, hidden, castPlacement, entry.visibility)
    const modelGroups = withSpecialGroups(
      docGroups ?? (await restyled(engine, entry.model.id, engine.getStyleGroups(entry.model.id))),
    )
    infos.push(info)
    groups[entry.model.id] = modelGroups
    // Framing travels with the document, and it is bound to the first CAST
    // member — `follow` rides that one's bone, and scenery has no bone worth
    // riding. Applied as soon as it exists rather than
    // after the last: with three characters, waiting meant two of them stood in
    // an unframed shot until the third finished, and the camera then jumped.
    if (!entry.stage && !entry.prop && infos.length - stageList.length - propList.length === 1) {
      applyCamera(engine, scene.state.camera, model)
    }
    // A scheduled model keeps simulating its cloth while it is off stage, so the
    // frame it appears on is a frame its skirt is already moving on. Set before
    // the reveal, because the hiding starts here.
    //
    // Its dissolve is seeded here too, for the same reason the reveal below asks
    // the track instead of simply showing her: a switch at frame 0 that
    // dissolves her IN wants nothing of her on screen yet, and a model revealed
    // whole for the one frame before the first tick is exactly the pop this
    // feature exists to avoid. Both live here because every reveal path — with a
    // motion, without one, and the one taken when a motion fails to load — comes
    // through this block first.
    if (entry.visibility?.length) {
      engine.setModelPhysicsWhileHidden(entry.model.id, true)
      engine.setModelDissolve(entry.model.id, visibilityAt(entry.visibility, 0).dissolve)
    }
    // Reveal this one NOW. Models with an animation stay hidden a moment longer:
    // their clip loader reveals them after show(), so the first visible frame
    // wears the motion's first pose instead of flashing bind pose. (If the clip
    // fails, the loader still reveals.)
    //
    // What the track says at frame 0, which for an unscheduled model is shown.
    // Asked here rather than left to the playback tick to correct: a costume
    // that opens the scene off stage would otherwise be on screen for the frame
    // between the reveal and the first tick, which is a flash of two characters
    // standing in each other.
    if (!entry.animation)
      engine.setModelTransform(entry.model.id, { visible: visibleAt(entry.visibility, 0) })
    onModel?.(
      info,
      modelGroups,
      entry.stage ? stageList[stageList.length - 1]! : null,
      entry.prop ? propList[propList.length - 1]! : null,
    )
  }

  // Every model is in, so every parent a prop's track names exists.
  for (const p of propList) placeProp(engine, p)

  // Cards, after the cast: they are scenery and a scene without them is still
  // the scene, so a card that fails to resolve costs a picture rather than the
  // load. Each comes back as the File it was packed as, which is also what
  // sceneFiles wants for the next publish — so restoring and re-packing use the
  // same bytes rather than two paths that could disagree.
  const planeList: PlaneInfo[] = []
  // Handed back rather than stored here: the decoders live in a ref the hook
  // owns, and this function is outside it.
  const restoredAnims: [string, PlaneAnimation][] = []
  for (const p of scene.assets.planes ?? []) {
    if (stale()) break
    try {
      const packed = bundle?.find((f) => f.name === p.asset.url) ?? null
      const bytes = packed ? await packed.arrayBuffer() : await fetchAsset(p.asset.url)
      if (!bytes) continue
      const name = p.asset.name || p.asset.url.split("/").pop() || "plane"
      const file = new File([bytes], name)
      // THE SAME PREPARATION AN UPLOAD GETS. Handing these bytes straight to
      // addPlane is what produced white cards: a .mp4 is not a picture, and the
      // image decoder tried it as TGA.
      const media = await preparePlaneMedia(file)
      if (!media) continue
      const id = await engine.addPlane({
        image: media.firstFrame,
        name,
        width: p.width,
        height: p.height,
        transform: stageTransformToEngine(p.transform),
        dynamic: media.video !== null,
      })
      sceneFiles.planes.set(id, file)
      if (media.animation) restoredAnims.push([id, media.animation])
      planeList.push({
        id,
        file: name,
        width: p.width,
        height: p.height,
        transform: p.transform,
        video: media.video,
        animated: media.animation !== null,
        frameWidth: media.frameWidth,
        frameHeight: media.frameHeight,
      })
    } catch {
      // One card short, not one scene short.
    }
  }

  // Again at the end, for the empty-scene case and because the first model may
  // have arrived before its follow bone existed.
  applyCamera(engine, scene.state.camera, engine.getModel(firstCastId(scene.assets.models)))
  return { infos, groups, bundle, stageList, propList, planeList, restoredAnims }
}

/**
 * Give a group's graph the name this library knows it by.
 *
 * A graph carries its own name, and an auto-grouped model gets its graphs from
 * the ENGINE, whose built-ins are called "Body", "Face", "Hair" — the names this
 * repo's content used before the Aether Gazer set was packaged as "AG Body" and
 * so on. The engine has no business knowing about that packaging, so the rename
 * happens here, where an engine graph first becomes an app group.
 *
 * Matched by look rather than by name, which is what makes it a rename and not a
 * guess: an edited graph matches nothing and keeps whatever it is called.
 */
export function named(list: StyleGroup[]): StyleGroup[] {
  return list.map((g) => {
    const name = graphLibraryName(g.graph)
    return !name || name === g.graph.name ? g : { ...g, graph: { ...g.graph, name } }
  })
}

/**
 * Dress freshly auto-derived groups in the browser's preferred style.
 *
 * The engine's auto-grouping fills a model with the engine's own presets, which
 * are the Aether Gazer set. Someone who switched the scene to another style and
 * then loads a second character should get that character in the same style,
 * not in the one they switched away from.
 *
 * Only for AUTO-derived groups. A document's own groups are the user's saved
 * work and are never restyled — the preference answers "what should a NEW model
 * look like", not "what should every scene look like".
 *
 * A no-op when the preference is already what the engine produced, so the common
 * case costs no second compile.
 */
export async function restyled(engine: Engine, modelId: string, list: StyleGroup[]): Promise<StyleGroup[]> {
  const pack = loadLookPref()
  const next = list.map((g) => {
    const graph = packGraph(pack, graphRole(g.graph))
    return graph ? { ...g, graph: structuredClone(graph) } : g
  })
  if (next.every((g, i) => g === list[i])) return list
  reportGroups(
    "restyle",
    await engine.applyStyleGroups(
      modelId,
      withMaterialMaps(
        modelId,
        next.filter((g) => g.materials.length > 0),
      ),
    ),
  )
  return next
}

export function withSpecialGroups(list: StyleGroup[]): StyleGroup[] {
  // Seeded in the preferred style too. These are empty drop targets, so they
  // render nothing either way — but a scene switched to another style that still
  // showed its pinned Eye and Hair groups wearing the default set's names would
  // be telling the user something untrue about what they are about to drop into.
  const pack = loadLookPref()
  const seeds = SPECIAL_GROUPS.filter((s) => !list.some((g) => (g.renderClass ?? "auto") === s.renderClass)).map(
    (s): StyleGroup => {
      const base = SLOT_GRAPHS[s.preset]!
      return {
        id: s.id,
        label: s.label,
        materials: [],
        graph: structuredClone(packGraph(pack, graphRole(base)) ?? base),
        renderClass: s.renderClass,
      }
    },
  )
  return named([...list, ...seeds])
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
  /**
   * Where this CAST member's root stands, in world units.
   *
   * The thing a scene made of two models wearing one motion is actually about:
   * without it they dance inside each other, and the automatic spawn offset can
   * only guess. Authored here and written to the document, so a published link
   * shows the arrangement rather than the guess.
   *
   * Absent on a stage, whose placement is its own (StageInfo.transform) and
   * which this list must not keep a second, drifting copy of.
   */
  position?: [number, number, number]
  /** Uniform, 1 at rest. Its own field rather than a component of position:
   *  the engine takes one number, and a character is scaled evenly or not at
   *  all — a squashed figure is a broken figure, not a look. */
  scale?: number
  /** Degrees per axis about the model's ROOT — which way they face. The unit
   *  the slider shows, so nothing converts between the row and the panel; the
   *  engine's quaternion is made at the edge, as it is for a stage. */
  rotation?: [number, number, number]
  /**
   * The position above is the app's SPAWN GUESS rather than a placement anyone
   * chose — see spawnOffsetX, which stands a new model beside the first instead
   * of inside it.
   *
   * A guess is dropped the moment a motion arrives, because the motion carries
   * its own placement, and it is never written to the document. So a scene
   * nobody has placed by hand loads exactly as it did before any of this
   * existed, and one that HAS been placed keeps what its author set — including
   * through the next motion they attach.
   */
  spawnGuess?: boolean
  /** Every bone's name, in rig order — what a prop's bone picker lists. Kept
   *  here rather than read off the live model in render, which the row cannot
   *  do without reaching into a ref. */
  bones: string[]
  /**
   * The stretches this model is on stage for — its lane on the timeline.
   *
   * Absent means throughout, so a cast that nobody has scheduled behaves exactly
   * as it did before lanes existed. Carried on the row rather than in a map
   * beside it for the reason StageInfo.morphs gives: it is per-model document
   * state with the same lifecycle as the placement, and a second container keyed
   * by the same id goes stale on a document swap.
   */
  visibility?: VisibilityWindow[]
}

/** A stage's placement — the document's own type, not a parallel one. The value
 *  the sliders edit IS what gets serialised, so there is nothing to convert and
 *  no second definition to drift. Rotation is degrees, matching the slider. */
export type StageTransform = SceneStageTransform

/** A card in the scene: what it is made of, how big, and where it stands. */
export type PlaneInfo = {
  id: string
  /** The upload's filename — what the chip calls it. */
  file: string
  /** World size. Height is the dial; width follows the picture's own shape. */
  width: number
  height: number
  transform: StageTransform
  /** A MOVING card. The element that plays it lives beside this and its frames
   *  are pushed into the card's texture; null for a still or an animated image. */
  video: HTMLVideoElement | null
  /** An animated IMAGE (gif / webp / apng). No element can be told what time it
   *  is, so its frames are decoded and drawn — see tickPlanes. The decoder and
   *  its per-frame state live in a ref, not here: this is React state, and a
   *  tick that mutated it would be writing through a value an effect depends
   *  on. */
  animated: boolean
  /** The frame size the card's texture was allocated at. A push of any other
   *  size is refused, so this is what the element must be. */
  frameWidth: number
  frameHeight: number
}

/**
 * World units per pixel of the uploaded picture.
 *
 * A card arrives at ITS OWN size rather than a fixed height, so a 4K backdrop
 * comes in as a wall and a small sprite comes in small — and two uploads keep
 * the relative sizes they had in the folder they came from, which is the thing
 * a fixed height threw away.
 *
 * The constant is the mapping, and 50 is chosen against the cast: a MMD
 * character is about twenty units, so 1080p lands at 21.6 — a card standing
 * beside her rather than a postage stamp or a wall filling the shot.
 */
export const PLANE_PIXELS_PER_UNIT = 50

/** A transparent sheet of exactly these texels, as PNG bytes. What a moving
 *  card is allocated from: the size has to be the video's, and the content is
 *  about to be overwritten sixty times a second. */
/** A decoded animated image, and where its frames are drawn before being
 *  pushed into a card. Frames are decoded on demand and only when the wanted
 *  one CHANGES — at a gif's ten a second against sixty ticks, five in six ask
 *  for what is already up. */
export type PlaneAnimation = {
  dec: ImageDecoder
  /** Cumulative end time of each frame: these formats carry per-frame delays,
   *  not a frame rate, so time maps to an index by walking them. */
  ends: number[]
  span: number
  canvas: OffscreenCanvas
  shown: number
  busy: boolean
}

/**
 * What a card needs to exist, from the file it is made of.
 *
 * ONE function because there are two callers — an upload and a restore — and
 * they were two copies. The restore copy handed a .mp4's own bytes to the image
 * decoder, which tried them as TGA and produced a white card: a video is not a
 * picture, and the texture has to start as a blank sheet at the video's size
 * with frames written into it.
 */
export async function preparePlaneMedia(file: File): Promise<{
  video: HTMLVideoElement | null
  animation: PlaneAnimation | null
  frameWidth: number
  frameHeight: number
  firstFrame: ArrayBuffer
} | null> {
  if (BACKDROP_VIDEO_RE.test(file.name)) {
    // The element IS the decoder: copyExternalImageToTexture takes one
    // directly, so a moving card needs no demuxing at all.
    const video = document.createElement("video")
    video.src = URL.createObjectURL(file)
    video.muted = true
    video.loop = true
    video.playsInline = true
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("cannot decode"))
    })
    const frameWidth = video.videoWidth
    const frameHeight = video.videoHeight
    void video.play().catch(() => {})
    return { video, animation: null, frameWidth, frameHeight, firstFrame: await blankPng(frameWidth, frameHeight) }
  }

  const bitmap = await createImageBitmap(file)
  const frameWidth = bitmap.width
  const frameHeight = bitmap.height
  bitmap.close()
  const firstFrame = await file.arrayBuffer()

  // A gif or animated webp is a still to the DOM and an animation to us:
  // drawImage takes frame one and nothing else, so without this a moving
  // picture becomes a frozen card.
  const opened = await openAnimatedImage(file).catch(() => null)
  let animation: PlaneAnimation | null = null
  if (opened) {
    const ends: number[] = []
    let acc = 0
    for (let i = 0; i < opened.frames; i++) {
      const { image } = await opened.dec.decode({ frameIndex: i })
      // Microseconds; a frame with no stated delay runs at the 100ms every
      // decoder substitutes for one.
      acc += (image.duration ?? 100_000) / 1e6
      image.close()
      ends.push(acc)
    }
    animation = {
      dec: opened.dec,
      ends,
      span: Math.max(acc, 1 / 1000),
      canvas: new OffscreenCanvas(frameWidth, frameHeight),
      shown: -1,
      busy: false,
    }
  }
  return { video: null, animation, frameWidth, frameHeight, firstFrame }
}

async function blankPng(width: number, height: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  canvas.getContext("2d")
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()
}

export const DEFAULT_STAGE_TRANSFORM: StageTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
}

export type StageInfo = {
  id: string
  file: string
  transform: StageTransform
  /** Authored switch weights by morph name. Lives here, not in a parallel map in
   *  the page: it is per-stage document state with the same lifecycle as the
   *  transform, and a second container keyed by the same id went stale on
   *  document swap — ids are pmx basenames, so a new scene with a same-named
   *  stage inherited the old one's switches. */
  morphs: Record<string, number>
}

/** A prop: a stage's shape plus what it hangs from. `attach` and the transform
 *  are the start hold — null stands on its own — and `parentKeys` the switches
 *  the timeline keyed after it. */
export type PropInfo = StageInfo & { attach: SceneAttach | null; parentKeys: SceneParentKey[] }

/** Degrees per axis → the engine's quaternion, in MMD's own euler order.
 *  Shared by the loader and the slider so the two cannot disagree about what a
 *  number in the document means. */
export function castRotationToEngine(rotation: [number, number, number]): Quat {
  const rad = (d: number) => (d * Math.PI) / 180
  return Quat.fromEuler(rad(rotation[0]), rad(rotation[1]), rad(rotation[2]))
}

/** The document's degrees-and-tuples form → what setModelTransform wants. One
 *  converter, so the boot path and the sliders cannot drift apart. */
export function stageTransformToEngine(t: StageTransform) {
  const rad = (d: number) => (d * Math.PI) / 180
  return {
    position: new Vec3(t.position[0], t.position[1], t.position[2]),
    rotation: Quat.fromEuler(rad(t.rotation[0]), rad(t.rotation[1]), rad(t.rotation[2])),
    scale: t.scale,
  }
}

/**
 * Put a prop on its whole parent track: the start hold its row sets, then every
 * switch the timeline keyed. The engine picks the hold for the frame it draws,
 * so playback, a scrub and an export all switch on the same frame.
 *
 * One function for the boot path, the sliders and the timeline, like the
 * converter above. The keys own position and rotation; scale is the transform's.
 */
export function placeProp(engine: Engine, p: PropInfo): void {
  engine.setModelParentKeys(p.id, propParentKeys(p))
  engine.setModelTransform(p.id, { scale: p.transform.scale })
}

/** A prop's track in the engine's terms — frames to seconds, degrees to a
 *  quaternion through the same converter the sliders use. */
export function propParentKeys(p: PropInfo): ModelParentKey[] {
  const start: SceneParentKey = {
    frame: 0,
    model: p.attach?.model ?? null,
    ...(p.attach ? { bone: p.attach.bone } : {}),
    position: p.transform.position,
    rotation: p.transform.rotation,
  }
  return [start, ...p.parentKeys.filter((k) => k.frame > 0)].map((k) => ({
    time: k.frame / FPS,
    parent: k.model,
    ...(k.bone ? { bone: k.bone } : {}),
    position: new Vec3(k.position[0], k.position[1], k.position[2]),
    rotation: castRotationToEngine(k.rotation),
    ...(k.tween ? { tween: true } : {}),
  }))
}

// Added models stand beside the first, not inside
export function spawnOffsetX(existingCount: number): number {
  if (existingCount === 0) return 0
  const step = Math.ceil(existingCount / 2) * 9
  return existingCount % 2 === 1 ? step : -step
}

/**
 * Fetch an asset the document names, or null if it is not really there.
 *
 * `ok` is not proof a file exists: a dev server answers a path it no longer has
 * with its own 404 PAGE at status 200. Nothing loaded here is ever HTML, so the
 * content type is what separates a file from an error page — without it a
 * deleted companion kept "loading" and putting its name on a row.
 */
async function fetchAsset(url: string): Promise<ArrayBuffer | null> {
  // No cache override: /audios is immutable by next.config's headers rule, and
  // these files are named by the document rather than by convention — so the
  // "rename, never overwrite in place" discipline that rule asks for holds here
  // too. `no-cache` was added while a deleted file kept reappearing, which the
  // content-type check below actually fixed; leaving it in would cost a
  // revalidation round trip on every load for nothing.
  const res = await fetch(url)
  if (!res.ok) return null
  if ((res.headers.get("content-type") ?? "").includes("text/html")) return null
  return await res.arrayBuffer()
}

/**
 * Install the track's companions — the MIDI its notes come from, the .lrc its
 * words come from — from the refs the DOCUMENT holds.
 *
 * NAMED, never inferred. These used to be found by filename: X.mp3 pairs with
 * X.mid. That meant the app loaded files nobody chose, renamed the files you
 * did choose so they would keep pairing, and could not tell "this track has no
 * lyrics" from "I have not found them yet". Every other asset in a scene is
 * named by the document; these are now too, so a picked file keeps its own name
 * and a null in the document is a real answer.
 *
 * The MIDI's own timeline is TRUSTED. A ripped transcription rarely arrives
 * aligned, but guessing (the loader used to anchor the first note at zero)
 * breaks every file whose instrument genuinely enters late — indistinguishable
 * from a lead-in without listening to both. Alignment is measured once,
 * offline, and baked into the file.
 *
 * A miss is silence: an effect that reads notes or words draws its line and
 * waits, exactly as it does before any file arrives.
 */
export async function loadMidiFor(
  ref: AssetRef | null,
  engine: Engine,
  cancelled: () => boolean,
  bundleFiles: File[] | null,
  onLoaded?: (name: string | null) => void,
): Promise<void> {
  // Cleared first, all three: the retained bytes, the row's name, and the
  // ENGINE. A swap to a scene with no MIDI used to leave the previous scene's
  // notes installed and still driving effects.
  sceneFiles.score = null
  onLoaded?.(null)
  engine.setMidiNotes(null)
  if (!ref) return
  try {
    const packed = bundleFiles?.find((f) => f.name === ref.url) ?? null
    const bytes = packed ? await packed.arrayBuffer() : await fetchAsset(ref.url)
    if (!bytes || cancelled()) return
    const notes = parseMidi(bytes)
    // Parsed to nothing is not a file — see fetchAsset.
    if (notes.length === 0) return
    engine.setMidiNotes(notes)
    // Retained under its OWN name, so the collector packs what you gave it.
    sceneFiles.score = new File([bytes], ref.name)
    onLoaded?.(ref.name)
  } catch {
    // Not there, or will not parse. Either way the scene plays without it.
  }
}

export async function loadLyricsFor(
  ref: AssetRef | null,
  engine: Engine,
  cancelled: () => boolean,
  /** Canvas backing height, so lines are rasterised at the size they are drawn
   *  at — a row stored at one size and sampled at another is what soft text is. */
  canvasHeightPx: number,
  bundleFiles: File[] | null,
  onLoaded?: (name: string | null) => void,
): Promise<void> {
  sceneFiles.lyrics = null
  onLoaded?.(null)
  engine.setLyrics(null)
  if (!ref) return
  try {
    const packed = bundleFiles?.find((f) => f.name === ref.url) ?? null
    const bytes = packed ? await packed.arrayBuffer() : await fetchAsset(ref.url)
    if (!bytes || cancelled()) return
    const lines = parseLRC(new TextDecoder().decode(bytes))
    if (lines.length === 0) return
    engine.setLyrics(lines, rasterizeLyrics(lines, canvasHeightPx) ?? undefined)
    sceneFiles.lyrics = new File([bytes], ref.name)
    onLoaded?.(ref.name)
  } catch {
    // Same rule as the MIDI above.
  }
}


/** What the viewport hands back: a pick, and a gizmo drag. Filled by the
 *  surface that is editing; see ClipBridge. */
export type ViewportHandlers = {
  onRaycast?: (
    modelName: string,
    material: string | null,
    bone: string | null,
    screenX: number,
    screenY: number,
  ) => void
  onGizmoDrag?: (event: GizmoDragEvent) => void
}

/**
 * Put a clip's length back where the BODY MOTION left it.
 *
 * setMorphTracks grows a clip to cover whichever of the two files runs longer,
 * so an expression VMD with a trailing key a thousand frames past the last step
 * stretches everything measured from this number: the transport's scrub bar, the
 * timeline's ruler, the loop point, the export end. The engine is right to keep
 * the face playing — truncating morph PLAYBACK to the dance would drop the tail
 * of a performance — and this app is the one that decides how long the take IS.
 * See clipTrimmedToMotion for what it deliberately leaves alone.
 *
 * Written back through loadClip, the same door the editor's own commits use, so
 * nothing here has to know a clip's internals. Module scope because it closes
 * over nothing: the two loaders below are memoized on an empty dependency list,
 * and a helper from the hook body would be a stale closure by construction even
 * though this one could not tell the difference.
 */
export function trimToMotion(model: Model, name: string): void {
  const clip = model.getClip(name)
  if (!clip) return
  const trimmed = clipTrimmedToMotion(clip)
  if (trimmed !== clip) model.loadClip(name, trimmed)
}
