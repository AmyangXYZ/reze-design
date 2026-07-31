// The scene document — one JSON bundle describing everything a scene is.

import type { ShaderGraph, StyleGroup } from "reze-engine"
import pkg from "@/package.json"
import type { AppliedBackgroundEffect } from "@/lib/background-effects"
import type { SceneSettings } from "@/lib/scene-settings"

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

/** One character in the scene: the model plus ITS motion clip. */
export type SceneModel = {
  model: ModelRef
  animation: AssetRef | null
}

export type SceneAssets = {
  /** ≥1 entry; [0] is the PRIMARY model */
  models: SceneModel[]
  /** Camera VMD — drives target/rotation/distance/fov, overriding `state.camera`. */
  cameraAnimation: AssetRef | null
  audio: AssetRef | null
  background: SceneBackground
  /** Asset zip these models/clips live in, or null when every path is site-served. */
  bundle: string | null
}

/**
 * A pin to a published library item, at an exact immutable version.
 *
 * Versions never change once published, so a pinned scene renders the same
 * forever while its author keeps iterating — and one pin costs a few bytes where
 * a snapshot costs kilobytes. Resolution is two-tier: built-ins ship in the app
 * bundle and resolve with no network, everything else through /api/library/resolve.
 */
export type ItemRef = { id: string; version: number }

/** An effect stored BY VALUE: for a draft, which has no published version to pin. */
export type EffectSnapshot = { name: string; wgsl: string }

/** Orbit framing: how far the camera sits and what it looks at. */
export type SceneCamera = {
  distance: number
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
  /** WGSL effect layered between the base background and the model (stars, water…). */
  backgroundEffect: AppliedBackgroundEffect | null
  /** Per-group shader graphs — the user's actual creative work */
  groups: Record<string, StyleGroup[]> | null
  /** Materials the user has hidden, per model id. */
  hidden: Record<string, string[]> | null
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

/** Distinguishes the three `graph` forms without inspecting a ShaderGraph's shape. */
export const isItemRef = (v: unknown): v is ItemRef =>
  typeof v === "object" && v !== null && "id" in v && "version" in v

export type SceneModelDoc = {
  /** Path to the .pmx, or to a .zip containing it. */
  model: string
  /** Path to this model's motion, or null. */
  animation?: string | null
  /** This model's Materials-tab state. Absent = auto-group at load. */
  materials?: SceneModelMaterialsDoc
}

/** Every file the scene points at — and nothing else. */
export type SceneAssetsDoc = {
  /** ≥1 entry; [0] is the primary model. */
  models: SceneModelDoc[]
  /** Camera VMD — overrides `settings.camera` while enabled. */
  cameraAnimation?: string | null
  audio?: string | null
  /** Two slots, as in the Assets panel. Mutually exclusive at runtime — a set
   *  backdrop wins over a set skybox, matching the editor's replace behaviour. */
  backdrop?: string | null
  skybox?: string | null
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
     * A pin to a published effect, a snapshot when it is still a draft, or a
     * built-in's name for this repo's own documents.
     */
    effect?: ItemRef | EffectSnapshot | string | null
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

/** The applied effect a document describes: a pin, a snapshot, or a built-in name. */
function appliedEffect(
  applied: SceneSettingsDoc["background"]["effect"],
  resolveEffect: (name: string) => AppliedBackgroundEffect,
  resolveRef?: (ref: ItemRef) => LibraryPayloadLike | undefined,
): AppliedBackgroundEffect | null {
  if (!applied) return null
  if (typeof applied === "string") return resolveEffect(applied)
  if (isItemRef(applied)) {
    const hit = resolveRef?.(applied)
    // An unresolvable pin means no effect at all, rather than a wrong one. A
    // resolved one keeps its name: it is what the picker shows, and an effect
    // applied under an empty label left that control blank and unclickable.
    return hit?.wgsl ? { id: applied.id, name: hit.name ?? "", wgsl: hit.wgsl } : null
  }
  // A snapshot's runtime id is its name, the same aliasing built-ins use.
  return { id: applied.name, name: applied.name, wgsl: applied.wgsl }
}

/** Role → engine pass integration, both directions of the round trip. */
const ROLE_INTEGRATION = {
  hair: { renderClass: "hair" },
  eye: { renderClass: "eye" },
  stockings: { alphaMode: "hashed" },
} as const satisfies Record<string, Pick<StyleGroup, "renderClass" | "alphaMode">>

const roleOf = (g: StyleGroup): StyleGroupDoc["role"] =>
  g.renderClass === "hair" || g.renderClass === "eye" ? g.renderClass : g.alphaMode === "hashed" ? "stockings" : undefined

/**
 * Inflate the authored document into the runtime scene.
 *
 * `resolveGraph` turns a library id into a graph. It's injected rather than
 * imported so this module stays independent of where content comes from — the
 * same reason `resolveEffect` is a parameter.
 */
export function parseSceneDoc(
  doc: SceneDoc,
  resolveEffect: (name: string) => AppliedBackgroundEffect,
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
        const graph = isItemRef(g.graph)
          ? (resolveRef?.(g.graph) as { graph?: ShaderGraph } | undefined)?.graph
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

  const { camera, background, ...settings } = doc.settings
  const applied = background.effect

  // Keys are minted here, in document order — the doc itself is id-free.
  const ids: string[] = []
  const models = doc.assets.models.map((m) => {
    const { source, file } = parseModelSource(m.model)
    const id = modelKey(file, ids)
    ids.push(id)
    return {
      model: { id, file, source },
      animation: m.animation ? assetFromPath(m.animation) : null,
    }
  })
  const materials = doc.assets.models.flatMap((m, i) => (m.materials ? [[ids[i], m.materials] as const] : []))
  const hidden = materials.filter(([, m]) => m.hidden?.length)

  return {
    version: doc.version,
    assets: {
      models,
      cameraAnimation: doc.assets.cameraAnimation ? assetFromPath(doc.assets.cameraAnimation) : null,
      audio: doc.assets.audio ? assetFromPath(doc.assets.audio) : null,
      background: doc.assets.backdrop
        ? { kind: "backdrop", asset: assetFromPath(doc.assets.backdrop) }
        : doc.assets.skybox
          ? { kind: "skybox", asset: assetFromPath(doc.assets.skybox) }
          : null,
      bundle: doc.assets.bundle ?? null,
    },
    state: {
      // A parsed document is not yet a saved scene; hydrateScene supplies the
      // stored id, or mints one for a first-time visitor.
      id: "",
      name: doc.name,
      camera,
      settings: { ...settings, background: { color: background.color } },
      backgroundEffect: appliedEffect(applied, resolveEffect, resolveRef),
      groups: materials.length ? Object.fromEntries(materials.map(([id, m]) => [id, resolveGroups(m.groups)])) : null,
      hidden: hidden.length ? Object.fromEntries(hidden.map(([id, m]) => [id, m.hidden!])) : null,
    },
  }
}

/** Join a folder URL and a filename. No encoding — see AssetRef.url. */
function assetUrl(dir: string, file: string): string {
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
    background: SceneBackground
    /** Public URL of the uploaded asset zip, or null for a bundle-free scene. */
    bundle: string | null
    name: string
    camera: SceneCamera
    settings: SceneSettings
    backgroundEffect: AppliedBackgroundEffect | null
    groups: Record<string, StyleGroup[]>
    hidden: Record<string, string[]>
  },
  /** Recognises published content by value, so it can be pinned instead of copied. */
  refs?: {
    graph: (graph: ShaderGraph) => ItemRef | undefined
    effect: (wgsl: string) => ItemRef | undefined
  },
): SceneDoc {
  const applied = live.backgroundEffect
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
      models: live.models.map((m) => {
        const hidden = live.hidden[m.model.id]
        const groups = live.groups[m.model.id]
        return {
          model: modelPath(m.model),
          animation: m.animation?.url ?? null,
          ...(groups ? { materials: { groups: groups.map(toDoc), ...(hidden?.length ? { hidden } : {}) } } : {}),
        }
      }),
      cameraAnimation: live.cameraAnimation?.url ?? null,
      audio: live.audio?.url ?? null,
      backdrop: live.background?.kind === "backdrop" ? live.background.asset.url : null,
      skybox: live.background?.kind === "skybox" ? live.background.asset.url : null,
      bundle: live.bundle,
    },
    settings: {
      camera: live.camera,
      ...live.settings,
      background: {
        ...live.settings.background,
        effect: applied ? (refs?.effect(applied.wgsl) ?? { name: applied.name, wgsl: applied.wgsl }) : null,
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
  add(doc.settings.background.effect)
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

// ".3": name-keyed references and the {preset, intensity} grade — older blobs
// don't parse into this shape, and there are no compatibility shims by design.
const STATE_KEY = "reze-design.sceneState.3"

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

/** The boot document: `base` (the bundled default) with the user's stored values merged over */
export function hydrateScene(base: Scene): Scene {
  const stored = loadStoredState()
  const settingsBase = stored?.settings ?? base.state.settings
  // Groups restore PER MODEL: an entry only applies when its model id is in the scene (groups
  const storedGroups = stored?.groups ?? null
  const baseIds = new Set(base.assets.models.map((m) => m.model.id))
  const usableGroups = storedGroups
    ? Object.fromEntries(Object.entries(storedGroups).filter(([id]) => baseIds.has(id)))
    : null
  const groupsUsable = usableGroups != null && Object.keys(usableGroups).length > 0

  return {
    ...base,
    state: {
      ...base.state,
      // Blobs stored before ids existed get one here. The demo's identity is never
      // adopted — an edited demo is the user's own scene.
      id: stored?.id ?? newSceneId(),
      name: stored?.name ?? base.state.name,
      camera: stored?.camera ?? base.state.camera,
      // Model-independent (unlike groups) — restores across model swaps.
      backgroundEffect: stored && "backgroundEffect" in stored ? stored.backgroundEffect ?? null : base.state.backgroundEffect,
      settings: {
        world: { ...base.state.settings.world, ...settingsBase.world },
        sun: { ...base.state.settings.sun, ...settingsBase.sun },
        bloom: { ...base.state.settings.bloom, ...settingsBase.bloom },
        background: { ...base.state.settings.background, ...settingsBase.background },
        grade: { ...base.state.settings.grade, ...settingsBase.grade },
        ground: { ...base.state.settings.ground, ...settingsBase.ground },
      },
      groups: groupsUsable ? usableGroups : base.state.groups,
      // Same per-model gate as groups
      hidden: stored?.hidden
        ? Object.fromEntries(Object.entries(stored.hidden).filter(([id]) => baseIds.has(id)))
        : base.state.hidden,
    },
  }
}
