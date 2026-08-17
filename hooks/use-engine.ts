"use client"

// Engine lifecycle for the scene page

import { useCallback, useEffect, useRef, useState } from "react"
import { EFFECTS } from "@/lib/effects"
import { Engine, parseLRC, parseMidi, Quat, Vec3, type ApplyStyleGroupResult, type CompileOptions, type Model, type RenderClass, type MidiNote, type StyleGroup } from "reze-engine"
import { rasterizeLyrics } from "@/lib/lyrics-raster"
import { SLOT_GRAPHS } from "@/lib/materials"
import { graphLibraryName } from "@/lib/refs"
import { graphRole, packGraph } from "@/lib/materials"
import { loadLookPref } from "@/lib/look-pref"
import { idbBundleId, modelKey, modelPmxUrl, type AssetRef, type Scene, type SceneCamera, type SceneStageTransform } from "@/lib/scene"
import { unzipToFiles } from "@/lib/uploads"
import { loadLocalBundle } from "@/lib/asset-store"
import { sceneFiles } from "@/lib/scene-files"
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
      // Stages are placed by the document; only cast members get the offset that
      // keeps a newly added model from landing inside the first one.
      const offset = spawnOffsetX(infos.length - stageList.length)
      engine.setModelTransform(entry.model.id, {
        visible: false,
        ...(offset !== 0 ? { position: new Vec3(offset, 0, 0) } : {}),
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
    const info = infoFor(entry.model.id, entry.model.file, model, hidden)
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

  // Again at the end, for the empty-scene case and because the first model may
  // have arrived before its follow bone existed.
  applyCamera(engine, scene.state.camera, engine.getModel(firstCastId(scene.assets.models)))
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
  const secs = (a: number, b: number) => `${((b - a) / 1000).toFixed(2)}s`
  console.info(
    `[reze] scene loaded in ${secs(t0, performance.now())} — assets ${secs(t0, tBundle)}` +
      `${bundleBytes ? ` (${mb(bundleBytes)} over the network)` : bundle ? " (from IndexedDB)" : ""}` +
      `, ${scene.assets.models.length} model(s) ${secs(tBundle, performance.now())}`,
  )
  return { infos, groups, bundle, stageList }
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
}

/** A stage's placement — the document's own type, not a parallel one. The value
 *  the sliders edit IS what gets serialised, so there is nothing to convert and
 *  no second definition to drift. Rotation is degrees, matching the slider. */
export type StageTransform = SceneStageTransform

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
 * Install the score that goes with the scene's track, if one is published
 * beside it: `/audios/X.mp3` pairs with `/audios/X.mid`.
 *
 * Paired by NAME rather than by url. An uploaded track's url is a `blob:`
 * handle out of IndexedDB and has no path to look beside, but its name survives
 * upload, persist and publish alike — so the same rule works for a site-served
 * track and a user's own file.
 *
 * The file's own timeline is TRUSTED. A ripped transcription rarely arrives
 * aligned — video lead-ins, DAW-default tempo grids — but guessing here (the
 * loader used to anchor the first note at zero) breaks every file whose
 * instrument genuinely enters late, and 2.63s of silence is exactly what the
 * BIBBIDIBA transcription opens with. Alignment is measured ONCE, offline, by
 * cross-correlating the mid's onsets against the audio's onset envelope, and
 * baked into the published file (the Reze arc piano carried 12.5s of video
 * intro, now removed; BIBBIDIBA gained its 2.63s lead).
 *
 * A miss is silence. Most tracks have no transcription, so a 404 here is the
 * ordinary case and must not read as a failure: a score-driven effect draws its
 * line and waits, which is what it already does before any file arrives.
 */
async function loadScoreFor(
  audio: AssetRef | null,
  engine: Engine,
  cancelled: () => boolean,
  bundleFiles: File[] | null,
): Promise<void> {
  sceneFiles.score = null
  if (!audio?.name) return
  const base = audio.name.replace(/\.[^./]+$/, "")
  try {
    const packed = bundleFiles?.find((f) => f.name === `audio/${base}.mid`) ?? null
    const bytes = packed ? await packed.arrayBuffer() : await fetchCompanion(`${base}.mid`)
    if (!bytes || cancelled()) return
    engine.setMidiNotes(parseMidi(bytes))
    // RETAINED wherever it came from, so the collector packs it beside the
    // track — that is what makes the score travel through publish and fork.
    sceneFiles.score = new File([bytes], `${base}.mid`)
  } catch {
    // No transcription beside the track, or one that will not parse.
  }
}

/** A companion file published beside the site's tracks, or null if there is
 *  none. `no-cache` still yields a 304 on an unchanged file, but a sheet
 *  edited between reloads always shows the edit — these are content files an
 *  author iterates on by hand, and a stale copy reads exactly like a parser
 *  ignoring the change. */
async function fetchCompanion(name: string): Promise<ArrayBuffer | null> {
  const res = await fetch(`/audios/${encodeURIComponent(name)}`, { cache: "no-cache" })
  return res.ok ? await res.arrayBuffer() : null
}

/**
 * Install the lyrics that go with the scene's track: `/audios/X.mp3` pairs
 * with `/audios/X.lrc`, by name, under exactly the score's rules — a miss is
 * the ordinary case, and a lyric-driven effect waits the same way a
 * score-driven one does. The lines are rasterised here (Canvas2D — the one
 * rasteriser that speaks every script) so an effect can draw the words, not
 * just their timing. An .lrc is authored against the published track itself;
 * when it runs late against a particular rip, its own [offset:] tag is the
 * knob — positive shows lines earlier.
 */
async function loadLyricsFor(
  audio: AssetRef | null,
  engine: Engine,
  cancelled: () => boolean,
  /** Canvas backing height, so lines are rasterised at the size they are drawn
   *  at — a row stored at one size and sampled at another is what soft text is. */
  canvasHeightPx: number,
  bundleFiles: File[] | null,
): Promise<void> {
  sceneFiles.lyrics = null
  if (!audio?.name) return
  const base = audio.name.replace(/\.[^./]+$/, "")
  try {
    const packed = bundleFiles?.find((f) => f.name === `audio/${base}.lrc`) ?? null
    const bytes = packed ? await packed.arrayBuffer() : await fetchCompanion(`${base}.lrc`)
    if (!bytes || cancelled()) return
    const lines = parseLRC(new TextDecoder().decode(bytes))
    engine.setLyrics(lines, rasterizeLyrics(lines, canvasHeightPx) ?? undefined)
    sceneFiles.lyrics = new File([bytes], `${base}.lrc`)
  } catch {
    // No lyric file beside the track.
  }
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
  const [bundleProgress, setBundleProgress] = useState<BundleProgress | null>(null)
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
        void loadScoreFor(scene.assets.audio, engine, () => disposed, bundleRef.current)
        void loadLyricsFor(scene.assets.audio, engine, () => disposed, canvasRef.current?.height ?? 0, bundleRef.current)
        const { infos, groups: groupsMap } = loaded
        setModels(infos)
        setStages(loaded.stageList)
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
  // Stage edits read the live list here and keep the engine call OUTSIDE the
  // state updater: React invokes updaters twice in StrictMode, which would
  // double-issue every engine write.
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
    const offset = spawnOffsetX(modelsRef.current.length)
    if (offset !== 0) engine.setModelTransform(id, { position: new Vec3(offset, 0, 0) })
    await engine.autoStyleGroups(id)
    const groups = withSpecialGroups(await restyled(engine, id, engine.getStyleGroups(id)))
    setModels((prev) => [...prev, infoFor(id, pmxBaseName(pmxFile.name), model)])
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

  /** Place a stage. Position and rotation are absolute, scale is uniform. */
  const setStageTransform = useCallback((id: string, patch: Partial<StageTransform>) => {
    const current = stagesRef.current.find((s) => s.id === id)
    if (!current) return
    const next = { ...current.transform, ...patch }
    engineRef.current?.setModelTransform(id, stageTransformToEngine(next))
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, transform: next } : s)))
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
      // Uploaded models have no curated map — auto-group from name hints alone.
      await engine.autoStyleGroups(id)
      const groups = withSpecialGroups(await restyled(engine, id, engine.getStyleGroups(id)))
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
      engine.clearCameraVmd()

      const loaded = await loadSceneInto(engine, scene, stale, { onBytes: setBundleProgress })
      if (!loaded) return null
      bundleRef.current = loaded.bundle
      void loadScoreFor(scene.assets.audio, engine, stale, bundleRef.current)
      void loadLyricsFor(scene.assets.audio, engine, stale, canvasRef.current?.height ?? 0, bundleRef.current)
      sceneRef.current = scene
      setModels(loaded.infos)
      setStages(loaded.stageList)
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
  }, [])

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
    ready,
    stageReady,
    bundleProgress,
    bundleReady,
    error,
    models,
    stages,
    addStageFromFiles,
    setStageTransform,
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
    centerModel,
    stopAnimation,
  }
}
