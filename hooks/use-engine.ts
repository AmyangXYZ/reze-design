"use client"

// Engine lifecycle for the scene page

import { useCallback, useEffect, useRef, useState } from "react"
import { EFFECTS } from "@/lib/effects"
import { Engine, parseLRC, parseMidi, Quat, Vec3, type ApplyStyleGroupResult, type CompileOptions, type GizmoDragEvent, type Model, type RenderClass, type MidiNote, type StyleGroup, type LyricLine } from "reze-engine"
import { clipTrimmedToMotion } from "@/lib/clip"
import { rasterizeLyrics } from "@/lib/lyrics-raster"
import { SLOT_GRAPHS } from "@/lib/materials"
import { graphLibraryName } from "@/lib/refs"
import { graphRole, packGraph } from "@/lib/materials"
import { loadLookPref } from "@/lib/look-pref"
import { idbBundleId, modelKey, modelPmxUrl, type AssetRef, type Scene, type SceneCamera, type SceneStageTransform } from "@/lib/scene"
import { unzipToFiles } from "@/lib/uploads"
import { loadLocalBundle, sweepRetiredBundles } from "@/lib/asset-store"
import { sceneFiles } from "@/lib/scene-files"
import { BACKDROP_VIDEO_RE, openAnimatedImage } from "@/lib/backdrop"
import { createMediaFollower, type MediaFollower } from "@/lib/media-clock"
import { azElToDirection, hexToLinearVec3, hexToSrgbVec3 } from "@/lib/scene-settings"

/**
 * Surface what the engine said about a style-group apply.
 *
 * applyStyleGroups returns per-group diagnostics and every call site here threw
 * them away, so a graph that failed to compile looked exactly like one that had
 * never been applied — the engine drops an uncompilable group rather than render
 * it wrongly, which is right, and silent, which left us guessing.
 */
function reportGroups(where: string, result: { ok: boolean; groups?: { groupId: string; ok: boolean; diagnostics: unknown[] }[] } | undefined) {
  if (!result || result.ok) return
  for (const g of result.groups ?? []) {
    if (!g.ok)
      // Stringified: a diagnostic is an object, and the console collapses those
      // to {…} in a stack-heavy log — which hid the actual message for rounds.
      console.error(`[style] ${where}: group "${g.groupId}" failed —`, JSON.stringify(g.diagnostics, null, 1))
  }
}

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
  placement?: { at: [number, number, number]; scale?: number; guess?: boolean },
): EngineModelInfo {
  return {
    id,
    file,
    ...(placement
      ? {
          position: placement.at,
          ...(placement.scale !== undefined ? { scale: placement.scale } : {}),
          ...(placement.guess ? { spawnGuess: true } : {}),
        }
      : {}),
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
function firstCastId(entries: readonly { model: { id: string }; stage?: boolean }[]): string {
  return entries.find((e) => !e.stage)?.model.id ?? ""
}

/** Progress hooks. Each fires the moment its subject is usable, so a host can
 *  paint in the order the bytes arrive rather than waiting on the last model:
 *  stage → bundle (clips, audio and the backdrop image resolve out of it) →
 *  one call per model as it finishes loading and styling. */
type LoadProgress = {
  onStage?: () => void
  onBundle?: (files: File[] | null) => void
  onModel?: (info: EngineModelInfo, groups: StyleGroup[], stage: StageInfo | null) => void
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

async function loadSceneInto(engine: Engine, scene: Scene, stale: () => boolean, progress: LoadProgress = {}) {
  const { onStage, onBundle, onModel, onBytes } = progress
  const s = scene.state.settings
  const infos: EngineModelInfo[] = []
  const groups: Record<string, StyleGroup[]> = {}
  // Stages are in `infos` too — their materials use the same group path. This
  // is the list that tells the UI which of them are scenery.
  const stageList: StageInfo[] = []

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
        : await engine.loadModel(entry.model.id, { files, pmxFile })
    } else {
      const pmxUrl = modelPmxUrl(entry.model)
      if (!pmxUrl) throw new Error(`Zip-sourced models aren't loadable from a URL yet: ${entry.model.file}`)
      model = await engine.loadModel(entry.model.id, pmxUrl)
    }
    if (stale()) return null
    // A cast member's placement, filled in by the branch below and carried into
    // its row. A stage leaves it undefined: its placement is stageList's.
    let castPlacement: { at: [number, number, number]; scale?: number; guess?: boolean } | undefined
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
    } else {
      // WHERE THE DOCUMENT SAYS, and the spawn offset only where it says nothing.
      // The offset exists to keep a newly added model from landing inside the
      // first one, which is a guess about an arrangement — once someone has
      // placed the cast themselves, their placement is the answer, and a scene
      // written before the field existed still opens the way it always did.
      castPlacement = entry.transform
        ? { at: entry.transform.position, scale: entry.transform.scale }
        : { at: [spawnOffsetX(infos.length - stageList.length), 0, 0], guess: true }
      const at = castPlacement.at
      engine.setModelTransform(entry.model.id, {
        visible: false,
        position: new Vec3(at[0], at[1], at[2]),
        ...(castPlacement.scale !== undefined ? { scale: castPlacement.scale } : {}),
      })
    }
    // Styling: a document carrying groups for this model (a restored or imported scene)
    const docGroups = scene.state.groups?.[entry.model.id]
    if (docGroups) {
      // Empty groups are UI-only drop targets — withheld from the engine.
      reportGroups(
        `load ${entry.model.file}`,
        await engine.applyStyleGroups(entry.model.id, docGroups.filter((g) => g.materials.length > 0)),
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
    const info = infoFor(entry.model.id, entry.model.file, model, hidden, castPlacement)
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
    if (!entry.stage && infos.length - stageList.length === 1) applyCamera(engine, scene.state.camera, model)
    // Reveal this one NOW. Models with an animation stay hidden a moment longer:
    // their clip loader reveals them after show(), so the first visible frame
    // wears the motion's first pose instead of flashing bind pose. (If the clip
    // fails, the loader still reveals.)
    if (!entry.animation) engine.setModelTransform(entry.model.id, { visible: true })
    onModel?.(info, modelGroups, entry.stage ? stageList[stageList.length - 1]! : null)
  }

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
  return { infos, groups, bundle, stageList, planeList, restoredAnims }
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
function named(list: StyleGroup[]): StyleGroup[] {
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
async function restyled(engine: Engine, modelId: string, list: StyleGroup[]): Promise<StyleGroup[]> {
  const pack = loadLookPref()
  const next = list.map((g) => {
    const graph = packGraph(pack, graphRole(g.graph))
    return graph ? { ...g, graph: structuredClone(graph) } : g
  })
  if (next.every((g, i) => g === list[i])) return list
  reportGroups(
    "restyle",
    await engine.applyStyleGroups(modelId, next.filter((g) => g.materials.length > 0)),
  )
  return next
}

function withSpecialGroups(list: StyleGroup[]): StyleGroup[] {
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
const PLANE_PIXELS_PER_UNIT = 50

/** A transparent sheet of exactly these texels, as PNG bytes. What a moving
 *  card is allocated from: the size has to be the video's, and the content is
 *  about to be overwritten sixty times a second. */
/** A decoded animated image, and where its frames are drawn before being
 *  pushed into a card. Frames are decoded on demand and only when the wanted
 *  one CHANGES — at a gif's ten a second against sixty ticks, five in six ask
 *  for what is already up. */
type PlaneAnimation = {
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
async function preparePlaneMedia(file: File): Promise<{
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

/** The document's degrees-and-tuples form → what setModelTransform wants. One
 *  converter, so the boot path and the sliders cannot drift apart. */
function stageTransformToEngine(t: StageTransform) {
  const rad = (d: number) => (d * Math.PI) / 180
  return {
    position: new Vec3(t.position[0], t.position[1], t.position[2]),
    rotation: Quat.fromEuler(rad(t.rotation[0]), rad(t.rotation[1]), rad(t.rotation[2])),
    scale: t.scale,
  }
}

// Added models stand beside the first, not inside
function spawnOffsetX(existingCount: number): number {
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
async function loadMidiFor(
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

async function loadLyricsFor(
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
function trimToMotion(model: Model, name: string): void {
  const clip = model.getClip(name)
  if (!clip) return
  const trimmed = clipTrimmedToMotion(clip)
  if (trimmed !== clip) model.loadClip(name, trimmed)
}

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
          onModel: (info, groups, stage) => {
            setModels((prev) => [...prev, info])
            setGroupsByModel((prev) => ({ ...prev, [info.id]: groups }))
            if (stage) setStages((prev) => [...prev, stage])
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

  /** Remove a model from the scene entirely (the page keeps ≥1 by policy).
   *  Declared above the adders because replacing a stage builds on it. */
  const removeModelById = useCallback((modelId: string) => {
    sceneFiles.models.delete(modelId)
    engineRef.current?.removeModel(modelId)
    setModels((prev) => prev.filter((m) => m.id !== modelId))
    // Removing the last stage un-suppresses the ground inside the engine, so
    // nothing here has to put it back.
    setStages((prev) => prev.filter((s) => s.id !== modelId))
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
  const addStageFromFiles = useCallback(async (files: File[] | FileList, pmxFile: File): Promise<string> => {
    const engine = engineRef.current
    if (!engine) throw new Error("engine not ready")
    // A scene holds ONE stage, so uploading another replaces it. Two stages mean
    // two floors at y=0 with identical depth — they z-fight across the whole
    // floor, flashing as the camera turns, and no amount of depth precision can
    // separate surfaces that are exactly coplanar. There is also no sense in
    // which a scene is standing in two places at once.
    for (const prev of stagesRef.current) removeModelById(prev.id)
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
    setStages((prev) => [...prev, { id, file: pmxBaseName(pmxFile.name), transform: DEFAULT_STAGE_TRANSFORM, morphs: {} }])
    return id
  }, [removeModelById])

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

  /** Place a stage. Position and rotation are absolute, scale is uniform. */
  const setStageTransform = useCallback((id: string, patch: Partial<StageTransform>) => {
    const current = stagesRef.current.find((s) => s.id === id)
    if (!current) return
    const next = { ...current.transform, ...patch }
    engineRef.current?.setModelTransform(id, stageTransformToEngine(next))
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, transform: next } : s)))
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
    setModels((prev) => prev.map((m) => (m.id === modelId ? { ...m, position: [0, 0, 0] } : m)))
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
      return engine.upsertStyleGroup(modelId, group, opts)
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
        next.filter((g) => g.materials.length > 0),
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
      reportGroups("reset", await engine.applyStyleGroups(modelId, groups.filter((g) => g.materials.length > 0)))
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
    setStageTransform,
    setCastPosition,
    setCastScale,
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
