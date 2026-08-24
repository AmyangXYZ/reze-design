// The live editor's asset slots, gathered into one document's worth of state.
//
// Extracted from app/page.tsx so the 0.4.0 chrome (app/lab) collects the scene
// the exact same way the shipped editor does. Two editors with two collectors is
// two answers to "what is this scene made of", and only one of them can be right.
//
// The pages hold their slots differently — one motion union versus another, two
// background slots versus one — so the differences are normalised at the CALL,
// and everything below this line is the single shared answer.

import type { BundleEntry } from "@/lib/bundle"
import type { EngineModelInfo, StageInfo } from "@/hooks/use-engine"
import type { AssetRef, ModelSource, SceneBackground, SceneModel, ScenePlane, SceneStageTransform } from "@/lib/scene"
import { modelFilePaths, sceneFiles } from "@/lib/scene-files"

/** One model's motion, however the page happens to store it. */
export type CollectedAnim = {
  name: string
  source: { kind: "file"; file: File } | { kind: "url"; name: string; url: string }
}

export type SceneSlotsInput = {
  /** Every loaded model, stages included. */
  models: EngineModelInfo[]
  /** Which of them are scenery — they carry placement and switches. */
  stages: StageInfo[]
  /** The BOOT document's models: where a slot that was never re-uploaded in this
   *  session gets its source from. */
  booted: SceneModel[]
  /** The scene's bundle as loaded — a fork's unzipped zip, or the idb bundle. */
  bundleFiles: File[]
  /** Per-model motion by model id. */
  anims: Record<string, CollectedAnim>
  /** Per-model EXPRESSION VMD by model id — the file laid over the motion's
   *  own morphs. Optional, and absent means the motion's own morphs are what
   *  plays: a caller with no morph slot at all (the viewer) is a scene
   *  without morphs, not a scene that cannot be collected. */
  morphAnims?: Record<string, CollectedAnim>
  /** The camera VMD's display name, and the boot document's entry for it (what a
   *  served, never-re-uploaded camera track resolves back to). */
  camera: { name: string | null; booted: AssetRef | null }
  /** The track's name, and its live src — a blob: URL means the bytes are in
   *  `sceneFiles.audio`, anything else is a served path that travels as a URL. */
  audio: { name: string | null; url: string | null }
  /** The track's companions, each the camera slot's own shape: the display
   *  name, and the boot document's entry for one never re-uploaded this
   *  session. */
  midi: { name: string | null; booted: AssetRef | null }
  lyrics: { name: string | null; booted: AssetRef | null }
  /** The background image, whichever slot it came from. */
  background: { kind: "backdrop" | "skybox"; name: string; file: File } | null
  /** Media planes, each with the file it is made from. */
  planes: { name: string; file: File; width: number; height: number; transform: SceneStageTransform }[]
}

export type SceneSlots = {
  entries: BundleEntry[]
  models: SceneModel[]
  cameraAnimation: AssetRef | null
  audio: AssetRef | null
  midi: AssetRef | null
  lyrics: AssetRef | null
  background: SceneBackground
  planes: ScenePlane[]
  hidden: Record<string, string[]>
}

/**
 * Every slot's CURRENT value — uploaded assets as bundle-relative paths backed by
 * File entries, served assets as their URLs — regardless of who supplied them. This
 * is the one collector behind BOTH destinations: publish zips the entries to R2,
 * local persistence writes them to the IndexedDB bundle. Persisting is publishing
 * with a different store, which is why refresh, fork and publish can never disagree
 * about what the scene is made of.
 */
export function collectSceneSlots(input: SceneSlotsInput): SceneSlots {
  const entries: BundleEntry[] = []
  // A file that came OUT of a bundle keeps its bundle path as its name; packing it
  // under a fresh prefix would nest it one level deeper per generation
  // (audio/audio/track.wav), and the local persist loop runs every session.
  const packPath = (prefix: string, name: string) => (name.includes("/") ? name : `${prefix}/${name}`)
  /**
   * Re-add a file that is already IN the bundle but was not re-uploaded here.
   *
   * A repack writes a new bundle out of `entries` alone, so anything pointing at
   * a bundle-relative path that nobody re-added is silently dropped — the
   * document still names it, and the bytes are gone. Models never hit this
   * because the branch above copies their files forward; a motion, a camera
   * track and an audio file did, and that is how a scene booted from a bundle
   * lost its VMD on the first repack. Adding a stage is enough to trigger one,
   * which is why it looked like stages were to blame.
   *
   * Served assets (http, blob, data, site-absolute) own their own bytes and are
   * left alone.
   */
  const carry = (url: string | null | undefined) => {
    if (!url || /^(?:https?:|blob:|data:|\/)/.test(url)) return
    if (entries.some((e) => e.path === url)) return
    const f = input.bundleFiles.find((b) => b.name === url)
    if (f) entries.push({ path: url, file: f })
  }
  const liveModels: SceneModel[] = input.models.map((m) => {
    const kept = sceneFiles.models.get(m.id)
    const booted = input.booted.find((d) => d.model.id === m.id)?.model.source ?? null
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
      for (const f of input.bundleFiles) {
        if (f.name.startsWith(dir)) entries.push({ path: f.name, file: f })
      }
      source = booted
    } else {
      source = booted
    }
    const anim = input.anims[m.id]
    let animation: AssetRef | null = null
    if (anim?.source.kind === "file") {
      const path = packPath(`motions/${m.id}`, anim.source.file.name)
      entries.push({ path, file: anim.source.file })
      animation = { name: anim.name, url: path }
    } else if (anim?.source.kind === "url") {
      animation = { name: anim.name, url: anim.source.url }
      carry(animation.url)
    }
    // The morph file, packed under the same per-model folder as the
    // motion it dresses — one clip's worth of files stays together.
    const expr = input.morphAnims?.[m.id]
    let morph: AssetRef | null = null
    if (expr?.source.kind === "file") {
      const path = packPath(`motions/${m.id}`, expr.source.file.name)
      entries.push({ path, file: expr.source.file })
      morph = { name: expr.name, url: path }
    } else if (expr?.source.kind === "url") {
      morph = { name: expr.name, url: expr.source.url }
      carry(morph.url)
    }
    // Stages carry their placement and their switch weights in the document.
    // Without the flag they reload as ordinary cast: physics, IK, a spawn
    // offset, and no ground suppression.
    const stage = input.stages.find((s) => s.id === m.id)
    return {
      model: { id: m.id, file: m.file, source: source! },
      animation,
      ...(morph ? { morph } : {}),
      ...(stage ? { stage: true, transform: stage.transform } : {}),
      ...(stage && Object.keys(stage.morphs).length ? { morphs: stage.morphs } : {}),
    }
  })
  let cameraAnimation: AssetRef | null = null
  if (input.camera.name && sceneFiles.camera) {
    const path = packPath("camera", sceneFiles.camera.name)
    entries.push({ path, file: sceneFiles.camera })
    cameraAnimation = { name: input.camera.name, url: path }
  } else if (input.camera.name && input.camera.booted?.name === input.camera.name) {
    cameraAnimation = input.camera.booted
    carry(cameraAnimation.url)
  }
  let audio: AssetRef | null = null
  if (input.audio.name && sceneFiles.audio) {
    const path = packPath("audio", sceneFiles.audio.name)
    entries.push({ path, file: sceneFiles.audio })
    audio = { name: input.audio.name, url: path }
  } else if (input.audio.name && input.audio.url && !input.audio.url.startsWith("blob:")) {
    audio = { name: input.audio.name, url: input.audio.url }
    carry(audio.url)
  }
  // The track's companions, named by the DOCUMENT exactly as the camera track
  // is: an uploaded file is packed under its own name and pointed at, a served
  // one travels as its URL. Nothing is inferred from the audio's filename, so a
  // picked file keeps the name you gave it and "this scene has no lyrics" is
  // something the document can say rather than something a reader infers.
  const companionOf = (slot: { name: string | null; booted: AssetRef | null }, file: File | null): AssetRef | null => {
    if (slot.name && file) {
      const path = packPath("audio", file.name)
      if (!entries.some((e) => e.path === path)) entries.push({ path, file })
      return { name: slot.name, url: path }
    }
    if (slot.name && slot.booted?.name === slot.name) {
      carry(slot.booted.url)
      return slot.booted
    }
    return null
  }
  const midi = companionOf(input.midi, sceneFiles.score)
  const lyrics = companionOf(input.lyrics, sceneFiles.lyrics)
  let background: SceneBackground = null
  if (input.background) {
    const path = packPath(input.background.kind, input.background.name)
    entries.push({ path, file: input.background.file })
    background = { kind: input.background.kind, asset: { name: input.background.name, url: path } }
  }
  const hidden = Object.fromEntries(
    input.models
      .map((m) => [m.id, m.materials.filter((mat) => !mat.visible).map((mat) => mat.name)] as const)
      .filter(([, names]) => names.length),
  )
  // Cards, packed like every other upload: the bytes go into the bundle and the
  // document keeps a path to them. Their own prefix, so a card called the same
  // thing as a backdrop cannot land on it.
  const planes: ScenePlane[] = input.planes.map((p, i) => {
    // INDEXED, because a card is identified by its place in the list and not by
    // what it is called. Two cards made from the same file — the same clip used
    // twice, which is an ordinary thing to want — packed to the same path and
    // both copies went into the bundle, so a scene with two copies of one video
    // weighed twice what it should and walked into the upload cap.
    //
    // The index is stable across a reload (the list is rebuilt in document
    // order), so the path is stable too and a repack does not churn.
    const path = `planes/${i}-${p.name}`
    entries.push({ path, file: p.file })
    // The display name travels beside the path: the path now carries an index
    // that is bookkeeping, and a card called "0-blue.mp4" in the UI would be
    // this leaking out — and re-packing THAT would prefix it again every load.
    return { asset: { name: p.name, url: path }, width: p.width, height: p.height, transform: p.transform }
  })

  // NO TWO ENTRIES MAY SHARE A PATH.
  //
  // A bundle is a flat list of {path, file}, so a repeated path is not an
  // overwrite — it is the same bytes stored twice, and nothing downstream ever
  // says so. It cost a scene with two cards of one video double its weight and
  // put it into the upload cap. Every slot that could repeat now guards itself;
  // this is the backstop, and it keeps the FIRST because that is the one the
  // document's paths were built against.
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    if (seen.has(e.path)) return false
    seen.add(e.path)
    return true
  })
  if (unique.length !== entries.length) {
    console.warn(
      `[reze] ${entries.length - unique.length} duplicate bundle path(s) dropped — ` +
        `two assets packed to the same name. The scene is fine; the packer is not.`,
    )
  }

  return { entries: unique, models: liveModels, cameraAnimation, audio, midi, lyrics, background, planes, hidden }
}
