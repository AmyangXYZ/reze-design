// The scene document — one JSON bundle describing everything a scene is.

import type { ShaderGraph, StyleGroup } from "reze-engine"
import pkg from "@/package.json"
import type { AppliedEffect } from "@/lib/effects"
import type { EffectWindow } from "@/lib/effect-schedule"
import { DEFAULT_DOF, DEFAULT_OUTLINE, DEFAULT_PHYSICS, DEFAULT_VIEW, type SceneSettings } from "@/lib/scene-settings"
import { storageKey } from "@/lib/storage"

export const SCENE_FORMAT_VERSION = 1

/** A file the scene points at. */
export type AssetRef = { name: string; url: string }

/** Where a model's files come from. */
export type ModelSource =
  | { kind: "folder"; dir: string }  // folder URL, no trailing slash
  | { kind: "zip"; url: string }     // archive URL
  | { kind: "bundle"; path: string } // inside the scene's asset bundle

export type ModelRef = {
  /** Engine key, unique within the scene. Never authored — minted from the .pmx
   *  filename by modelKey(), at import and at parse alike. */
  id: string
  /** .pmx filename inside the folder/archive — also what the Assets panel shows. */
  file: string
  source: ModelSource
}

/** The background's BASE layer */
export type SceneBackground = { kind: "backdrop" | "skybox"; asset: AssetRef } | null

/** Placement for an environment model. Characters spawn on a deterministic
 *  offset; a stage has to be put somewhere, so it carries its own transform.
 *  Rotation is degrees per axis — what the slider shows, so nothing converts. */
export type SceneStageTransform = {
  position: [number, number, number]
  rotation: [number, number, number]
  /** Uniform. Stage PMX are authored at wildly different scales. */
  scale: number
}

/** One character in the scene: the model plus ITS motion clip. */
export type SceneModel = {
  model: ModelRef
  animation: AssetRef | null
  /** An morph VMD (表情モーション) laid over the motion's own morphs.
   *  Null is not "no morphs" — it means the motion's own morphs play. */
  morph?: AssetRef | null
  /** Environment geometry — no motion slot, placed by `transform`, and it
   *  suppresses the ground. */
  stage?: boolean
  transform?: SceneStageTransform
  /** Authored morph weights by morph name. A stage's morphs are switches the
   *  user set, not animation, so they are document state — see stage-morphs.tsx. */
  morphs?: Record<string, number>
}

export type SceneAssets = {
  /** Media planes: pictures standing in the scene. Optional because every scene
   *  written before them has none, and absent must mean none rather than a
   *  load failure. */
  planes?: ScenePlane[]
  /** [0] is the PRIMARY model. May be empty: a build that does not opt into the
   *  demo scene (NEXT_PUBLIC_USE_DEFAULT_SCENE) starts with no cast, and the last
   *  model can be removed. */
  models: SceneModel[]
  /** Camera VMD — drives target/rotation/distance/fov, overriding `state.camera`. */
  cameraAnimation: AssetRef | null
  audio: AssetRef | null
  /** The track's companions, named by the document — never inferred from the
   *  audio's filename. Null is a real answer: this scene has none. */
  midi: AssetRef | null
  lyrics: AssetRef | null
  background: SceneBackground
  /**
   * The HDRI world — what LIGHTS the scene.
   *
   * Its own slot, beside `background` rather than inside it. Backdrop and
   * skybox are two answers to "what is behind the scene" and only one can be;
   * this answers "what is lighting it", which can be true at the same time as
   * either. They shared a slot and were told apart by file extension, so a
   * studio HDRI and a chosen sky were mutually exclusive for no reason but the
   * plumbing.
   */
  hdri: AssetRef | null
  /** Asset zip these models/clips live in, or null when every path is site-served. */
  bundle: string | null
}

/**
 * A pin to a published library item — the id, and nothing else.
 *
 * It used to carry a version, and resolved to that exact immutable payload. It
 * resolves to whatever the item IS now. A pin costs a few bytes where a snapshot
 * costs kilobytes, and resolution is two-tier: built-ins ship in the app bundle
 * and resolve with no network, everything else through /api/library/resolve.
 *
 * Documents written before this still carry `{ id, version }`. They keep
 * parsing — the version is simply ignored, which is exactly what it means to
 * follow the item — so there is nothing to migrate in anyone's stored scene.
 */
export type ItemRef = { id: string }

/** An effect stored BY VALUE: for a draft, which has no published version to pin. */
export type EffectSnapshot = { name: string; wgsl: string }

/**
 * One effect as the scene wears it: WHAT it is, and WHEN.
 *
 * The source used to be the whole entry. It could not stay that way once an
 * effect could be scheduled or dialled down, because a pin is a reference to
 * someone else's published effect — the timing belongs to THIS scene's use of
 * it, not to the effect, and two scenes using one effect at different moments
 * is the ordinary case.
 *
 * Documents written before this carry the bare source and read as having no
 * effects. That is a handful of beta scenes re-applied by hand, against
 * carrying a second document shape forever — the same call the single-effect
 * field got when the list arrived.
 */
export type SceneEffect = {
  /** A pin to a published effect, a snapshot while it is still a draft, or a
   *  built-in's name for this repo's own documents. */
  source: ItemRef | EffectSnapshot | string
  /** The level it reaches, 0..1. Absent = fully on. */
  influence?: number
  /** Its strips, in FRAMES at 30fps — the space the timeline draws and a VMD is
   *  keyed in. A LANE, so one effect can fire at several moments. Absent or
   *  empty = alive for the whole scene. */
  window?: EffectWindow[]
}

/** The engine's stock orbit angles — the backfill for documents written before
 *  angles were part of the schema (also what the DB patch stamped). */
export const CAMERA_DEFAULT_ALPHA = Math.PI
export const CAMERA_DEFAULT_BETA = Math.PI / 2.5
/** The engine's stock vertical FOV, and the backfill for every document written
 *  before the lens was authorable. */
export const CAMERA_DEFAULT_FOV = Math.PI / 4

/** Orbit framing: how far the camera sits, from which angle, at what it looks. */
export type SceneCamera = {
  distance: number
  /** Orbit azimuth in radians — captured from the live camera at save time, so
   *  a scene opens on the exact authored angle. */
  alpha: number
  /** Orbit inclination in radians (0 = top-down pole). */
  beta: number
  /** Vertical field of view in RADIANS — the unit alpha/beta use and the one the
   *  engine takes, so nothing converts between here and the camera. Optional:
   *  every document written before the lens was authorable simply has none, and
   *  reads back as CAMERA_DEFAULT_FOV. */
  fov?: number
  /** Where the camera looks — or, when `follow` is set, the offset from the bone
   *  it is following. The three sliders mean the same thing either way. */
  target: [number, number, number]
  /** Bone the orbit centre rides on, so a travelling motion stays in frame.
   *  Absent or null = a fixed point in the world, which is what every scene
   *  written before this does. */
  follow?: string | null
}

export type SceneState = {
  /** The scene's identity, and the ONLY place it lives — `SceneItem.id` when
   *  published, this while it is still local. Never inside SceneDoc: the payload
   *  is content, and a second copy could only drift from the primary key.
   *  Minted client-side so a scene has identity before it is ever published. */
  id: string
  name: string
  /** `target` is the orbit centre — tune to the model's height. */
  camera: SceneCamera
  settings: SceneSettings
  /** WGSL effects, in layer order — the first is drawn first (stars, water…).
   *  A list because a scene runs several at once: notes behind the cast,
   *  ribbons off her hands, prints under her feet. Empty is no effect. */
  backgroundEffects: AppliedEffect[]
  /** Per-group shader graphs — the user's actual creative work */
  groups: Record<string, StyleGroup[]> | null
  /** Materials the user has hidden, per model id. */
  hidden: Record<string, string[]> | null
}

/** A card in the document: what it is made of, how big, and where it stands.
 *
 *  The asset is an IMAGE OR A VIDEO rather than a model folder, which is the one
 *  thing that stops a plane being an ordinary SceneModel entry — everything else
 *  about it (a transform, a place in the bundle) is what a model already has. */
export type ScenePlane = {
  asset: AssetRef
  /** World size, stored rather than re-derived: it comes from the picture's own
   *  proportions at upload, and a re-encoded or replaced file must not silently
   *  restretch a card someone already placed. */
  width: number
  height: number
  transform: SceneStageTransform
}

export type Scene = {
  version: number
  assets: SceneAssets
  state: SceneState
}

// ── Authored form ────────────────────────────────────────────────────────────────
//
// The document mirrors the editor's three tabs: `assets` holds URLs, `settings`
// holds values, `materials` holds each model's grouping and shading. A field lives
// where its tab is, so reading a scene file and reading the UI teach the same
// structure.

/**
 * A style group as AUTHORED: a display label, which materials, and which shader
 * graph they use. No id — engine keys are minted at parse, like model keys.
 *
 * `graph` is a full ShaderGraph in anything the app writes: a published scene is
 * frozen artwork, so it carries its shading BY VALUE and renders identically
 * forever — no matter who renames, retunes or deletes the preset it came from, and
 * with no distinction between built-in and community content.
 *
 * A NAME is also accepted, for hand-authored documents in this repo (see
 * lib/default-scene.ts) where both sides move in one commit. Serialization never
 * produces one.
 *
 * `role` marks the groups with special pass integration (hair/eye stenciling,
 * stockings' hashed alpha). Not a user choice — the app maintains these groups —
 * but it must travel, because nothing else in the document implies it.
 */
export type StyleGroupDoc = {
  label?: string
  materials: string[]
  /**
   * A pin to a published graph, a full ShaderGraph for an unpublished draft, or a
   * built-in's NAME (the hand-authored shorthand this repo's own documents use —
   * serialization never writes one).
   */
  graph: ItemRef | ShaderGraph | string
  role?: "hair" | "eye" | "stockings"
}

/** Distinguishes the three `graph` forms without inspecting a ShaderGraph's shape.
 *
 *  `id` alone is the test. It used to require `version` as well, which was free
 *  discrimination while pins carried one — but a ShaderGraph has no `id` and an
 *  effect snapshot has `name`/`wgsl`, so the id is already the only thing a pin
 *  has and nothing else does. Documents still carrying a version match too. */
export const isItemRef = (v: unknown): v is ItemRef =>
  typeof v === "object" && v !== null && "id" in v && typeof (v as { id: unknown }).id === "string"

export type SceneModelDoc = {
  /** Path to the .pmx, or to a .zip containing it. */
  model: string
  /** Path to this model's motion, or null. */
  animation?: string | null
  morph?: string | null
  /** Environment model. Absent = a cast member, which is the old shape — so
   *  every scene written before stages existed still parses as it always did. */
  stage?: boolean
  /** Stage placement (position / rotation in degrees / uniform scale). */
  transform?: SceneStageTransform
  /** Authored stage switch weights by morph name. */
  morphs?: Record<string, number>
  /** This model's Materials-tab state. Absent = auto-group at load. */
  materials?: SceneModelMaterialsDoc
}

/** Every file the scene points at — and nothing else. */
export type ScenePlaneDoc = {
  /** Bundle-relative path, or a URL, to the picture or video. */
  media: string
  /** What the card is CALLED. Separate from the path, which carries an index to
   *  keep two cards made from one file apart — a name read back off that path
   *  would show the bookkeeping and grow a prefix on every reload. */
  name?: string
  width: number
  height: number
  transform: SceneStageTransform
}

export type SceneAssetsDoc = {
  /** [0] is the primary model; may be empty. */
  models: SceneModelDoc[]
  /** Camera VMD — overrides `settings.camera` while enabled. */
  cameraAnimation?: string | null
  /** Media planes, in the order they were added. Absent means none. */
  planes?: ScenePlaneDoc[]
  audio?: string | null
  /**
   * The track's companions, NAMED rather than inferred.
   *
   * These used to be found by filename — X.mp3 pairs with X.mid — which meant
   * the app loaded files nobody chose, renamed the ones you did choose so they
   * would keep pairing, and could not tell "this track has no lyrics" apart
   * from "I have not found them yet". Every other asset here is named by the
   * document; these are now too. Written explicitly as null when absent, so a
   * reader never has to guess whether a missing key means empty or old.
   */
  midi?: string | null
  lyrics?: string | null
  /** Two slots, as in the Assets panel. Mutually exclusive at runtime — a set
   *  backdrop wins over a set skybox, matching the editor's replace behaviour. */
  backdrop?: string | null
  skybox?: string | null
  /** The HDRI. NOT one of the pair above: those two are what you see, and this
   *  is what lights. A scene can have one of them and this.
   *
   *  Named for the file rather than for the seat it fills, because `world` is
   *  already taken — settings.world is the flat colour and the strength dial. */
  hdri?: string | null
  /**
   * URL of the scene's asset zip. Paths above that don't start with "/" or a
   * scheme are relative to this bundle; site-served demo assets keep absolute
   * paths and are never re-uploaded.
   */
  bundle?: string | null
}

/**
 * Everything the Scene tab governs, camera and background effect included — the
 * effect sits inside `background` exactly where the UI puts it, at the same level
 * as the grade rather than floating outside the settings.
 */
export type SceneSettingsDoc = Omit<SceneSettings, "background"> & {
  camera: SceneCamera
  background: SceneSettings["background"] & {
    /**
     * The scene's effects, in LAYER ORDER — each a pin to a published effect, a
     * snapshot while it is still a draft, or a built-in's name for this repo's
     * own documents.
     *
     * Order is meaning, not preference: a full-cover backdrop drawn last erases
     * everything under it, so the list is the composition.
     */
    effects?: SceneEffect[] | null
  }
}

/** One model's Materials-tab state: the COMPLETE group list, exactly as shown.
 *  Self-contained by design — a scene renders the same even if the engine's
 *  auto-grouping heuristic changes under it. */
export type SceneModelMaterialsDoc = {
  groups: StyleGroupDoc[]
  /** Material names the user has hidden. */
  hidden?: string[]
}

export type SceneDoc = {
  /** FORMAT version — what migrations key on. */
  version: number
  /** Engine version that authored the document. Advisory provenance for diagnosing
   *  "my old scene looks different", never used to alter behaviour. */
  engine?: string
  name: string
  assets: SceneAssetsDoc
  settings: SceneSettingsDoc
}

/**
 * Mint an engine key from a .pmx filename ("miku.pmx" → "miku", "miku-2" on
 * collision). The ONLY way model keys come to exist — documents never author them,
 * so there is no id to keep unique, remember, or get wrong. Filename-derived
 * rather than positional so stored per-model state can only ever reattach to the
 * same model, not to whatever occupies the slot next time.
 */
export function modelKey(file: string, taken: Iterable<string>): string {
  const base = (file.split("/").pop() ?? file).replace(/\.pmx$/i, "") || "model"
  const used = new Set(taken)
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Split "/dir/file.pmx" into a folder source, route a .zip to its own kind, and
 *  read a relative path as living inside the scene's asset bundle. */
function parseModelSource(path: string): { source: ModelSource; file: string } {
  if (/\.zip$/i.test(path)) return { source: { kind: "zip", url: path }, file: path.split("/").pop() ?? path }
  if (!path.startsWith("/") && !/^https?:/.test(path)) {
    return { source: { kind: "bundle", path }, file: path.split("/").pop() ?? path }
  }
  const i = path.lastIndexOf("/")
  return { source: { kind: "folder", dir: path.slice(0, i) }, file: path.slice(i + 1) }
}

/** The published payloads a pin can resolve to — structurally, so this module
 *  needn't import the library's payload types. */
type LibraryPayloadLike = { graph?: ShaderGraph; wgsl?: string; spec?: unknown; name?: string }

/** A localStorage state stores RESOLVED effects rather than document forms.
 *  Absent means "this state predates the list" and the base scene's own effects
 *  stand; present-but-empty means the user removed them all, which is different
 *  and must survive a reload. */
function effectsFromStored(stored: unknown, fallback: AppliedEffect[]): AppliedEffect[] {
  if (!stored || typeof stored !== "object") return fallback
  const s = stored as { backgroundEffects?: AppliedEffect[] | null }
  if ("backgroundEffects" in s) return s.backgroundEffects ?? []
  return fallback
}

/** The applied effect a document describes: a pin, a snapshot, or a built-in name. */
function appliedEffect(
  applied: SceneEffect | null,
  resolveEffect: (name: string) => AppliedEffect,
  resolveRef?: (ref: ItemRef) => LibraryPayloadLike | undefined,
): AppliedEffect | null {
  if (!applied) return null
  // A MALFORMED entry drops out rather than throwing. Documents written before
  // an entry carried its timing hold the bare source here — a string or a pin
  // where an object with `.source` is expected — and reaching into it for a
  // name would take the whole scene down on load, in the viewer as well as the
  // editor. Those scenes open with no effects, which is the same answer an
  // unresolvable pin already gets; it is not a second document shape, because
  // nothing below reads the old one.
  if (typeof applied !== "object" || !("source" in applied)) return null
  const src = applied.source
  // The TIMING is this scene's, whatever the source turns out to be — carried
  // onto whichever branch below resolves, rather than into each of them.
  const when = {
    ...(applied.influence === undefined ? {} : { influence: applied.influence }),
    ...(applied.window === undefined ? {} : { window: applied.window }),
  }
  if (typeof src === "string") return { ...resolveEffect(src), ...when }
  if (isItemRef(src)) {
    const hit = resolveRef?.(src)
    // An unresolvable pin means no effect at all, rather than a wrong one. A
    // resolved one keeps its name: it is what the picker shows, and an effect
    // applied under an empty label left that control blank and unclickable.
    return hit?.wgsl ? { id: src.id, name: hit.name ?? "", wgsl: hit.wgsl, ...when } : null
  }
  // A snapshot's runtime id is its name, the same aliasing built-ins use.
  return { id: src.name, name: src.name, wgsl: src.wgsl, ...when }
}

/**
 * Every effect a document describes, in layer order.
 *
 * Entries that will not resolve — a pin to something unpublished — drop out
 * rather than taking the rest of the list with them.
 *
 * There is no fallback to the old single `effect` field. Documents written
 * before a scene could hold several will read as having none and get their
 * effects re-applied by hand; that is a handful of scenes, and carrying a
 * second document shape forever to avoid it is the more expensive half.
 */
function appliedEffects(
  background: SceneSettingsDoc["background"],
  resolveEffect: (name: string) => AppliedEffect,
  resolveRef?: (ref: ItemRef) => LibraryPayloadLike | undefined,
): AppliedEffect[] {
  return (background.effects ?? [])
    .map((e) => appliedEffect(e, resolveEffect, resolveRef))
    .filter((e): e is AppliedEffect => e !== null)
}

/** Role → engine pass integration, both directions of the round trip. */
const ROLE_INTEGRATION = {
  hair: { renderClass: "hair" },
  eye: { renderClass: "eye" },
  stockings: { alphaMode: "hashed" },
} as const satisfies Record<string, Pick<StyleGroup, "renderClass" | "alphaMode">>

const roleOf = (g: StyleGroup): StyleGroupDoc["role"] =>
  g.renderClass === "hair" || g.renderClass === "eye" ? g.renderClass : g.alphaMode === "hashed" ? "stockings" : undefined

/** The assets half of the document round trip — used alone by local persistence,
 *  and by parseSceneDoc for the whole document. */
/**
 * The stage half of a model entry, spread-if-present.
 *
 * `stage`, `transform` and `morphs` are structurally identical on `SceneModel`
 * and `SceneModelDoc`, so one helper serves both directions of the round trip.
 * Written once because there are three sites — parse, the local-persistence
 * writer, and the publish writer — and a field added to only two of them
 * silently stops round-tripping on the third.
 */
function stageFieldsOf(m: Pick<SceneModel, "stage" | "transform" | "morphs">) {
  return {
    ...(m.stage ? { stage: true as const } : {}),
    ...(m.transform ? { transform: m.transform } : {}),
    // An empty map is the same as no switches — don't write `"morphs": {}`.
    ...(m.morphs && Object.keys(m.morphs).length > 0 ? { morphs: m.morphs } : {}),
  }
}

export function parseAssetsDoc(a: SceneAssetsDoc): SceneAssets {
  const ids: string[] = []
  const models = a.models.map((m) => {
    const { source, file } = parseModelSource(m.model)
    const id = modelKey(file, ids)
    ids.push(id)
    return {
      model: { id, file, source },
      animation: m.animation ? assetFromPath(m.animation) : null,
      morph: m.morph ? assetFromPath(m.morph) : null,
      // Spread-if-present, so a cast member parses to the same shape a pre-stage
      // build produced.
      ...stageFieldsOf(m),
    }
  })
  return {
    models,
    cameraAnimation: a.cameraAnimation ? assetFromPath(a.cameraAnimation) : null,
    audio: a.audio ? assetFromPath(a.audio) : null,
    // A document written before these existed parses to null — the same value a
    // document that deliberately has none writes. That is the whole point of
    // naming them: "no lyrics" stops being a thing the reader has to infer.
    midi: a.midi ? assetFromPath(a.midi) : null,
    lyrics: a.lyrics ? assetFromPath(a.lyrics) : null,
    // Absent parses to null, which is also what a scene with no HDRI writes —
    // so "this scene lights itself with a flat world" is something the document
    // says rather than something a reader infers.
    hdri: a.hdri ? assetFromPath(a.hdri) : null,
    background: a.backdrop
      ? { kind: "backdrop", asset: assetFromPath(a.backdrop) }
      : a.skybox
        ? { kind: "skybox", asset: assetFromPath(a.skybox) }
        : null,
    // Absent parses to no cards, which is what every document written before
    // them says and what one with none says too.
    ...(a.planes?.length
      ? {
          planes: a.planes.map((p) => ({
            // The stored name when there is one; the path's tail otherwise, for
            // a document written before the two were separate.
            asset: p.name ? { name: p.name, url: p.media } : assetFromPath(p.media),
            // Guarded rather than trusted: a document is a file on someone
            // else's disk, and a card with a zero or missing dimension is a
            // divide-by-zero in the size control rather than a small card.
            width: Number.isFinite(p.width) && p.width > 0 ? p.width : 1,
            height: Number.isFinite(p.height) && p.height > 0 ? p.height : 1,
            transform: p.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
          })),
        }
      : {}),
    bundle: a.bundle ?? null,
  }
}

/** The inverse: live assets back to their authored form. Ids are dropped — parse
 *  re-mints the same ones from the same filenames, which is the round trip's whole
 *  contract. */
export function assetsDocOf(a: SceneAssets): SceneAssetsDoc {
  return {
    models: a.models.map((m) => ({
      model: modelPath(m.model),
      animation: m.animation?.url ?? null,
      morph: m.morph?.url ?? null,
      ...stageFieldsOf(m),
    })),
    cameraAnimation: a.cameraAnimation?.url ?? null,
    audio: a.audio?.url ?? null,
    midi: a.midi?.url ?? null,
    lyrics: a.lyrics?.url ?? null,
    hdri: a.hdri?.url ?? null,
    backdrop: a.background?.kind === "backdrop" ? a.background.asset.url : null,
    skybox: a.background?.kind === "skybox" ? a.background.asset.url : null,
    // Written only when there are any: a scene with no cards should read the
    // same as every scene written before they existed.
    ...(a.planes?.length ? { planes: a.planes.map(planeDocOf) } : {}),
    bundle: a.bundle,
  }
}

/** A card, as the document stores it: the path to its picture and where it
 *  stands. Size travels with it because it came from the picture's own
 *  proportions, and re-deriving it on load would restretch a placed card
 *  whenever the file behind it changed. */
export const planeDocOf = (p: ScenePlane) => ({
  media: p.asset.url,
  name: p.asset.name,
  width: p.width,
  height: p.height,
  transform: p.transform,
})

/**
 * Inflate the authored document into the runtime scene.
 *
 * `resolveGraph` turns a library id into a graph. It's injected rather than
 * imported so this module stays independent of where content comes from — the
 * same reason `resolveEffect` is a parameter.
 */
export function parseSceneDoc(
  doc: SceneDoc,
  resolveEffect: (name: string) => AppliedEffect,
  resolveGraph?: (name: string) => ShaderGraph | undefined,
  /** Resolves a pin to its published payload. Built-ins come from the app bundle;
   *  community items must be fetched first (see resolveSceneRefs). */
  resolveRef?: (ref: ItemRef) => LibraryPayloadLike | undefined,
): Scene {
  // Engine keys for groups are minted here the way newGroupId mints them in the
  // editor: a slug of the label (role as fallback), deduped within the model.
  const resolveGroups = (gs: StyleGroupDoc[]): StyleGroup[] => {
    const ids = new Set<string>()
    return gs
      .map((g): StyleGroup | null => {
        // A pin resolves to the published item, so the group wears that item's
        // NAME — not the name sitting inside the payload, which is whatever the
        // author's draft happened to be called when they published it. The two
        // drift the moment someone publishes under a different title, and the
        // group then answers to a name no library lists.
        const pinned = isItemRef(g.graph) ? resolveRef?.(g.graph) : undefined
        const graph = isItemRef(g.graph)
          ? pinned?.graph && pinned.name
            ? { ...pinned.graph, name: pinned.name }
            : pinned?.graph
          : typeof g.graph === "string"
            ? resolveGraph?.(g.graph)
            : g.graph
        // A group whose graph can't be resolved is dropped rather than rendered
        // with the wrong look — its materials fall back to the engine default,
        // which is visibly neutral instead of visibly wrong.
        if (!graph) return null
        const base =
          (g.label ?? g.role ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group"
        let id = base
        for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
        ids.add(id)
        return { id, label: g.label, materials: g.materials, graph, ...(g.role ? ROLE_INTEGRATION[g.role] : {}) }
      })
      .filter((g): g is StyleGroup => g !== null)
  }

  const { camera: docCamera, background, ...settings } = doc.settings
  // Pre-angle documents (and forks copied from them) get the stock angles the
  // engine always used — identical framing to what they had. Same for the lens.
  const camera: SceneCamera = {
    ...docCamera,
    alpha: docCamera.alpha ?? CAMERA_DEFAULT_ALPHA,
    beta: docCamera.beta ?? CAMERA_DEFAULT_BETA,
    fov: docCamera.fov ?? CAMERA_DEFAULT_FOV,
  }

  const assets = parseAssetsDoc(doc.assets)
  // Keys were minted by parseAssetsDoc in document order — the doc itself is id-free.
  const ids = assets.models.map((m) => m.model.id)
  const materials = doc.assets.models.flatMap((m, i) => (m.materials ? [[ids[i], m.materials] as const] : []))
  const hidden = materials.filter(([, m]) => m.hidden?.length)

  return {
    version: doc.version,
    assets,
    state: {
      // A parsed document is not yet a saved scene; hydrateScene supplies the
      // stored id, or mints one for a first-time visitor.
      id: "",
      name: doc.name,
      camera,
      // Published documents all carry a physics block (backfilled 2026-08-04,
      // see scripts/db-patch-physics.mjs), so the type requires one. The merge
      // stays because a *file* exported before the section existed cannot be
      // backfilled — spreading an absent block is a no-op and the defaults
      // stand, which is still air at MMD gravity: exactly how those scenes
      // already looked.
      settings: {
        ...settings,
        physics: { ...DEFAULT_PHYSICS, ...settings.physics },
        // Same merge, same reason: a document written before the 0.4.0 chrome
        // carries neither block, and spreading an absent one is a no-op that
        // leaves the defaults — no blur, no outlines, exactly how it looked.
        dof: { ...DEFAULT_DOF, ...settings.dof },
        outline: { ...DEFAULT_OUTLINE, ...settings.outline },
        // Likewise for the view transform: absent means the scene was authored
        // under the engine's Filmic default, which is what DEFAULT_VIEW restates.
        view: { ...DEFAULT_VIEW, ...settings.view },
        background: { color: background.color },
      },
      backgroundEffects: appliedEffects(background, resolveEffect, resolveRef),
      groups: materials.length ? Object.fromEntries(materials.map(([id, m]) => [id, resolveGroups(m.groups)])) : null,
      hidden: hidden.length ? Object.fromEntries(hidden.map(([id, m]) => [id, m.hidden!])) : null,
    },
  }
}

/** Join a folder URL and a filename. No encoding — see AssetRef.url. */
export function assetUrl(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, "")}/${file}`
}

/** An AssetRef for a served path whose URL still carries the filename */
export function assetFromPath(url: string): AssetRef {
  return { name: decodeURIComponent(url.split("/").pop() ?? url), url }
}

/** The .pmx URL for a folder-sourced model — the engine resolves its textures against it. */
export function modelPmxUrl(model: ModelRef): string | null {
  return model.source.kind === "folder" ? assetUrl(model.source.dir, model.file) : null
}

/**
 * The local scene's bundle "URL": its files live in IndexedDB rather than behind a
 * fetch. One invariant keeps mixed cases impossible: whenever ANY of the working
 * scene's assets are local bytes — uploads, or a fork's files adopted from its zip —
 * the whole bundle is the idb one. There is never an R2 bundle and an idb bundle in
 * play at once.
 */
export const idbBundleOf = (sceneId: string): string => `idb:${sceneId}`

/** The scene id inside an idb bundle URL, or null for a fetchable one. */
export const idbBundleId = (bundle: string | null): string | null =>
  bundle?.startsWith("idb:") ? bundle.slice(4) : null

/** Path a model loads from — the inverse of parseModelSource. */
function modelPath(m: ModelRef): string {
  if (m.source.kind === "zip") return m.source.url
  if (m.source.kind === "bundle") return m.source.path
  return `${m.source.dir}/${m.file}`
}

/** The pinned engine dependency ("^0.26.0" → "0.26.0") — stamped into documents. */
const ENGINE_VERSION = pkg.dependencies["reze-engine"].replace(/^[~^]/, "")

/**
 * Snapshot the live editor into the AUTHORED document — the inverse of
 * parseSceneDoc, and the form a scene is shared/served as.
 *
 * Everything travels BY VALUE: graphs, the background shader, the grade spec. A
 * published scene is a finished piece, so nothing about how it renders may depend
 * on content that someone else can still rename, retune or delete.
 */
export function serializeSceneDoc(
  live: {
    models: SceneModel[]
    cameraAnimation: AssetRef | null
    audio: AssetRef | null
    midi: AssetRef | null
    lyrics: AssetRef | null
    background: SceneBackground
    hdri: AssetRef | null
    planes: ScenePlane[]
    /** Public URL of the uploaded asset zip, or null for a bundle-free scene. */
    bundle: string | null
    name: string
    camera: SceneCamera
    settings: SceneSettings
    backgroundEffects: AppliedEffect[]
    groups: Record<string, StyleGroup[]>
    hidden: Record<string, string[]>
  },
  /** Recognises published content by value, so it can be pinned instead of copied. */
  refs?: {
    graph: (graph: ShaderGraph) => ItemRef | undefined
    effect: (wgsl: string) => ItemRef | undefined
  },
): SceneDoc {
  const toDoc = (g: StyleGroup): StyleGroupDoc => ({
    label: g.label,
    materials: g.materials,
    // A pin when this is exactly some published graph; the whole thing when it
    // isn't — an unpublished draft, or one the user has since edited.
    graph: refs?.graph(g.graph) ?? g.graph,
    role: roleOf(g),
  })
  return {
    version: SCENE_FORMAT_VERSION,
    engine: ENGINE_VERSION,
    name: live.name,
    assets: {
      // Through assetsDocOf, NOT field by field. Listing them here a second
      // time is exactly how the track's companions went missing: `midi` and
      // `lyrics` were added to the live assets and to assetsDocOf, and this
      // copy kept writing the six fields it already knew — so a scene packed
      // the .mid and .lrc into its zip and then shipped a document that never
      // named them. Import read no lyrics from a file that contained them, and
      // every publish did the same to its viewer.
      ...assetsDocOf({
        models: live.models,
        cameraAnimation: live.cameraAnimation,
        audio: live.audio,
        midi: live.midi,
        lyrics: live.lyrics,
        background: live.background,
        hdri: live.hdri,
        planes: live.planes,
        bundle: live.bundle,
      }),
      // The one thing that mapping cannot carry: material groups belong to the
      // editor's document rather than to the asset, so the models are rebuilt
      // here with their looks attached.
      models: live.models.map((m) => {
        const hidden = live.hidden[m.model.id]
        const groups = live.groups[m.model.id]
        return {
          model: modelPath(m.model),
          animation: m.animation?.url ?? null,
          morph: m.morph?.url ?? null,
          ...stageFieldsOf(m),
          ...(groups ? { materials: { groups: groups.map(toDoc), ...(hidden?.length ? { hidden } : {}) } } : {}),
        }
      }),
    },
    settings: {
      camera: live.camera,
      ...live.settings,
      background: {
        ...live.settings.background,
        // The list, in layer order — the only shape written or read. The old
        // single `effect` field is gone from both ends; documents predating
        // the list open with no effects rather than with their one.
        //
        // The TIMING travels with the entry, and omits itself when it is the
        // default: an unscheduled effect writes exactly what it wrote before
        // strips existed, so a scene nobody has scheduled produces the same
        // document and does not churn on save.
        effects: live.backgroundEffects.map((e) => ({
          source: refs?.effect(e.wgsl) ?? { name: e.name, wgsl: e.wgsl },
          ...(e.influence === undefined || e.influence === 1 ? {} : { influence: e.influence }),
          ...(e.window?.length ? { window: e.window } : {}),
        })),
      },
    },
  }
}

/**
 * Every published item this document pins. Written to `scene_uses` at publish, so
 * "used in N scenes" is a join rather than a scan through JSON — and so a preset
 * page can list the scenes using it.
 */
export function sceneRefs(doc: SceneDoc): ItemRef[] {
  const found = new Map<string, ItemRef>()
  const add = (v: unknown) => {
    if (isItemRef(v)) found.set(v.id, v)
  }
  // EVERY effect, not the first: each is its own pin, and a scene that used
  // four of them recorded none once this became a list.
  //
  // The SOURCE, not the entry. An entry carries this scene's timing around the
  // pin now, so `add(e)` reaches an object that is not an ItemRef and quietly
  // records nothing — and `add` takes unknown, so nothing would have said so
  // until a published scene stopped counting against the effects it uses.
  for (const e of doc.settings.background.effects ?? []) add(e.source)
  add(doc.settings.grade.from)
  for (const m of doc.assets.models) for (const g of m.materials?.groups ?? []) add(g.graph)
  return [...found.values()]
}

// ── Local persistence: the `state` half only. ──────────────────────────────────

/** Minted client-side: waiting for the server would leave local scenes anonymous. */
export function newSceneId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `scn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

// ".4": the graph socket vocabulary moved to Blender 5.2 (base_color,
// specular_ior_level, sheen_weight). migrateGraph used to rewrite the old names
// on every read; it was removed once the rename was baked into the database,
// which was right for published rows and left every BROWSER holding pre-5.2
// groups that no longer compile. The engine drops a graph it cannot compile
// rather than render it wrongly, so those users saw a fully grouped model with
// no look and one console line per group.
//
// A stored blob is not migrated, it is retired: the key carries the vocabulary
// it was written under, so an old one is simply never read, and boot falls back
// to the default scene. ".3" and older are swept below so the quota they held is
// returned rather than stranded forever.
export const STATE_KEY = storageKey("sceneState")
// Everything an older build wrote under this app's name. The hand-numbered
// series predates storage.ts; nothing new joins it, because a version bump now
// retires a whole generation of keys at once rather than one at a time.
const RETIRED_KEYS = [
  "reze-design.sceneState.4",
  "reze-design.sceneState.3",
  "reze-design.sceneState.2",
  "reze-design.sceneState.1",
  "reze-design.sceneAssets.1",
  "reze-design.drafts.1",
  "reze-design.gradeIntensity.1",
  "reze-design.look",
  "reze-design.fork",
]

/**
 * Drop blobs written under a vocabulary this build no longer reads.
 *
 * Called once per boot, before anything reads storage. Cheap, idempotent, and
 * the only thing standing between a user and a few hundred KB of dead JSON they
 * cannot see or clear without opening devtools.
 */
export function sweepRetiredState(): void {
  if (typeof window === "undefined") return
  for (const key of RETIRED_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // storage blocked — nothing to reclaim, and nothing depends on this
    }
  }
}

/**
 * Model ids are minted from the .pmx filename (see `modelKey`), so re-importing
 * the same model gets the same id back and its saved material work can be
 * reclaimed. That only holds if the work survives the model's ABSENCE: on reload
 * the base document is the bundled demo, `hydrateScene` keeps only the entries
 * whose model is present, and a straight write of that pruned map would persist
 * the loss before the user gets a chance to re-import. So entries for models not
 * currently in the scene are carried through rather than dropped — pruned at
 * use, retained at rest.
 *
 * Bounded, because localStorage is a ~5MB budget shared with everything else and
 * this map would otherwise grow once per model ever opened.
 */
const RETAINED_MODELS = 24

function retain<T>(next: Record<string, T> | null, prev: Record<string, T> | undefined): Record<string, T> | null {
  if (!prev) return next
  // `next` first: the live scene's entries are the ones worth keeping when the
  // cap bites, and its values win for any id present in both.
  const merged = { ...prev, ...(next ?? {}) }
  const keys = [...new Set([...Object.keys(next ?? {}), ...Object.keys(prev)])].slice(0, RETAINED_MODELS)
  return keys.length ? Object.fromEntries(keys.map((k) => [k, merged[k]])) : next
}

export function saveSceneState(state: SceneState) {
  try {
    const prev = loadStoredState()
    // Stamped with the format version so a future default/semantic change can MIGRATE the blob
    window.localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        version: SCENE_FORMAT_VERSION,
        ...state,
        groups: retain(state.groups, prev?.groups ?? undefined),
        hidden: retain(state.hidden, prev?.hidden ?? undefined),
      }),
    )
  } catch {
    // storage full/blocked — edits just won't persist
  }
}

type StoredState = Partial<SceneState>

function loadStoredState(): StoredState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    return raw ? (JSON.parse(raw) as StoredState) : null
  } catch {
    return null
  }
}

/**
 * The material work saved for a model that is not in the scene right now.
 *
 * Assets are not persisted, so a model the user imported themselves is never in the
 * boot document and `hydrateScene` cannot restore its groups. Re-importing the same
 * .pmx mints the same id (see `modelKey`), which is what makes the saved work
 * reachable again — but only through a lookup like this one.
 */
export function storedGroupsFor(modelId: string): StyleGroup[] | null {
  return loadStoredState()?.groups?.[modelId] ?? null
}

/**
 * The working scene's ASSETS, as an authored doc. The other half of persistence:
 * `saveSceneState` stores how the scene looks, this stores what it is made of. Both
 * carry the scene id, and both must agree before either is believed — a stale assets
 * record under a different id is ignored, never merged.
 *
 * The doc is tiny (paths, not bytes; uploaded files live in the IndexedDB bundle the
 * `idb:` bundle URL points at), so localStorage holds it and boot reads it
 * synchronously — which is what lets the boot document be decided before the engine
 * exists, with no async gap for a demo model to flash through.
 */
export const ASSETS_KEY = storageKey("sceneAssets")

export function saveSceneAssets(sceneId: string, assets: SceneAssetsDoc): void {
  try {
    window.localStorage.setItem(ASSETS_KEY, JSON.stringify({ sceneId, assets }))
  } catch {
    // storage full/blocked — the next boot falls back to the demo
  }
}

function loadStoredAssets(sceneId: string): SceneAssetsDoc | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ASSETS_KEY)
    if (!raw) return null
    const rec = JSON.parse(raw) as { sceneId: string; assets: SceneAssetsDoc }
    return rec.sceneId === sceneId ? rec.assets : null
  } catch {
    return null
  }
}

/**
 * The boot document: `base` (the bundled default) with the user's stored values
 * merged over.
 *
 * The try/catch is not defensive noise — it is the difference between a failed
 * restore and a dead site. This runs inside the editor's `useState` initializer,
 * so it runs DURING A RENDER: a throw in here does not fail the load, it stops
 * the page mounting, and it does so again on every refresh, because the blob
 * that caused it is still there. The user's only escape is clearing site data,
 * which is not something anyone should have to guess at.
 *
 * And the blob is not trustworthy input just because this code wrote it. It may
 * have been written by an earlier version whose shape has since moved on (the
 * stamped `version` is not checked on this path, only on file import), or by a
 * build that stored a field this one parses differently. Restoring is a
 * convenience; booting is not.
 */
export function hydrateScene(base: Scene): Scene {
  try {
    // Before anything reads storage: return the quota held by blobs written
    // under a vocabulary this build no longer reads.
    sweepRetiredState()
    return restored(base)
  } catch (e) {
    // Loud: this is the user losing their working scene, and the console line is
    // what the crash report carries when they ask why.
    console.error("[reze] stored scene could not be restored — booting the default instead:", e)
    return base
  }
}

function restored(base: Scene): Scene {
  const stored = loadStoredState()
  // The stored assets record replaces the demo's cast outright — presence is the
  // signal, so an empty record (a New scene) is an empty cast, not a fallthrough to
  // the demo. Absent (first visit, or a cleared browser), the demo stands.
  const storedAssets = stored?.id ? loadStoredAssets(stored.id) : null
  const assets = storedAssets ? parseAssetsDoc(storedAssets) : base.assets
  const settingsBase = stored?.settings ?? base.state.settings
  // Groups restore PER MODEL: an entry only applies when its model id is in the scene (groups
  const storedGroups = stored?.groups ?? null
  const baseIds = new Set(assets.models.map((m) => m.model.id))
  const usableGroups = storedGroups
    ? Object.fromEntries(Object.entries(storedGroups).filter(([id]) => baseIds.has(id)))
    : null
  const groupsUsable = usableGroups != null && Object.keys(usableGroups).length > 0

  return {
    ...base,
    assets,
    state: {
      ...base.state,
      // Blobs stored before ids existed get one here. The demo's identity is never
      // adopted — an edited demo is the user's own scene.
      id: stored?.id ?? newSceneId(),
      name: stored?.name ?? base.state.name,
      // A stored blob is not read through parseSceneDoc, so the lens backfill
      // has to happen here too — a camera saved before the field existed would
      // otherwise come back with no fov, and every reader would need its own
      // fallback.
      camera: stored?.camera ? { ...stored.camera, fov: stored.camera.fov ?? CAMERA_DEFAULT_FOV } : base.state.camera,
      // Model-independent (unlike groups) — restores across model swaps.
      // A localStorage state written before scenes held several says
      // backgroundEffect; read it as a list of one, same migration as the
      // document takes.
      backgroundEffects: effectsFromStored(stored, base.state.backgroundEffects),
      settings: {
        world: { ...base.state.settings.world, ...settingsBase.world },
        sun: { ...base.state.settings.sun, ...settingsBase.sun },
        bloom: { ...base.state.settings.bloom, ...settingsBase.bloom },
        dof: { ...base.state.settings.dof, ...settingsBase.dof },
        outline: { ...base.state.settings.outline, ...settingsBase.outline },
        view: { ...base.state.settings.view, ...settingsBase.view },
        background: { ...base.state.settings.background, ...settingsBase.background },
        grade: { ...base.state.settings.grade, ...settingsBase.grade },
        ground: { ...base.state.settings.ground, ...settingsBase.ground },
        physics: { ...base.state.settings.physics, ...settingsBase.physics },
      },
      groups: groupsUsable ? usableGroups : base.state.groups,
      // Same per-model gate as groups
      hidden: stored?.hidden
        ? Object.fromEntries(Object.entries(stored.hidden).filter(([id]) => baseIds.has(id)))
        : base.state.hidden,
    },
  }
}
