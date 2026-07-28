// The scene document — one JSON bundle describing everything a scene is.

import type { MaterialPresetMap, StyleGroup } from "reze-engine"
import type { AppliedBackgroundEffect } from "@/lib/background-effects"
import { loadLegacySceneSettings, type SceneSettings } from "@/lib/scene-settings"

export const SCENE_FORMAT_VERSION = 1

/** A file the scene points at. */
export type AssetRef = { name: string; url: string }

/** Where a model's files come from. */
export type ModelSource =
  | { kind: "folder"; dir: string }  // folder URL, no trailing slash
  | { kind: "zip"; url: string }     // archive URL

export type ModelRef = {
  /** Engine key for this model instance. ASCII, arbitrary, never shown. */
  id: string
  /** .pmx filename inside the folder/archive — also what the Assets panel shows. */
  file: string
  source: ModelSource
  /** Seed style groups: group id → material names. See SceneModelDoc. */
  styleGroups?: MaterialPresetMap
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
}

export type SceneState = {
  name: string
  /** Boot framing. `target` is the orbit centre — tune to the model's height. */
  camera: { distance: number; target: [number, number, number] }
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

// ── Authored form ──

export type SceneModelDoc = {
  /** Engine key. ASCII, arbitrary, never shown. */
  id: string
  /** Path to the .pmx, or to a .zip containing it. */
  model: string
  /** Path to this model's motion, or null. */
  animation?: string | null
  /** Seed STYLE GROUPS for this model: group id → material names. */
  styleGroups?: MaterialPresetMap
}

export type SceneDoc = {
  version?: number
  models: SceneModelDoc[]
  cameraAnimation?: string | null
  audio?: string | null
  background?: { kind: "backdrop" | "skybox"; asset: string } | null
  name: string
  camera: SceneState["camera"]
  settings: SceneSettings
  /** Built-in id, or a full snapshot for an effect the user wrote or edited —
   *  an id-only field silently drops custom WGSL when a scene is shared. */
  backgroundEffect?: string | AppliedBackgroundEffect | null
  groups?: Record<string, StyleGroup[]> | null
  hidden?: Record<string, string[]> | null
}

/** Split "/dir/file.pmx" into a folder source, or route a .zip to its own kind. */
function parseModelSource(path: string): { source: ModelSource; file: string } {
  if (/\.zip$/i.test(path)) return { source: { kind: "zip", url: path }, file: path.split("/").pop() ?? path }
  const i = path.lastIndexOf("/")
  return { source: { kind: "folder", dir: path.slice(0, i) }, file: path.slice(i + 1) }
}

/** Inflate the authored document into the runtime scene. */
export function parseSceneDoc(doc: SceneDoc, resolveEffect: (id: string) => AppliedBackgroundEffect): Scene {
  return {
    version: doc.version ?? SCENE_FORMAT_VERSION,
    assets: {
      models: doc.models.map((m) => {
        const { source, file } = parseModelSource(m.model)
        return {
          model: { id: m.id, file, source, styleGroups: m.styleGroups },
          animation: m.animation ? assetFromPath(m.animation) : null,
        }
      }),
      cameraAnimation: doc.cameraAnimation ? assetFromPath(doc.cameraAnimation) : null,
      audio: doc.audio ? assetFromPath(doc.audio) : null,
      background: doc.background ? { kind: doc.background.kind, asset: assetFromPath(doc.background.asset) } : null,
    },
    state: {
      name: doc.name,
      camera: doc.camera,
      settings: doc.settings,
      backgroundEffect: !doc.backgroundEffect
        ? null
        : typeof doc.backgroundEffect === "string"
          ? resolveEffect(doc.backgroundEffect)
          : doc.backgroundEffect,
      groups: doc.groups ?? null,
      hidden: doc.hidden ?? null,
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

/** Snapshot the live editor into a document. */
/** Path a model loads from — the inverse of parseModelSource. */
function modelPath(m: ModelRef): string {
  return m.source.kind === "zip" ? m.source.url : `${m.source.dir}/${m.file}`
}

/** Snapshot the live editor into the AUTHORED document — the inverse of
 *  parseSceneDoc, and the form a scene is shared/served as. `isBuiltinEffect`
 *  decides whether an applied effect travels as an id or as a full snapshot. */
export function serializeSceneDoc(
  live: {
    models: SceneModel[]
    cameraAnimation: AssetRef | null
    audio: AssetRef | null
    background: SceneBackground
    name: string
    camera: SceneState["camera"]
    settings: SceneSettings
    backgroundEffect: AppliedBackgroundEffect | null
    groups: Record<string, StyleGroup[]>
    hidden: Record<string, string[]>
  },
  isBuiltinEffect: (fx: AppliedBackgroundEffect) => boolean,
): SceneDoc {
  const fx = live.backgroundEffect
  return {
    version: SCENE_FORMAT_VERSION,
    models: live.models.map((m) => ({
      id: m.model.id,
      model: modelPath(m.model),
      animation: m.animation?.url ?? null,
      styleGroups: m.model.styleGroups,
    })),
    cameraAnimation: live.cameraAnimation?.url ?? null,
    audio: live.audio?.url ?? null,
    background: live.background ? { kind: live.background.kind, asset: live.background.asset.url } : null,
    name: live.name,
    camera: live.camera,
    settings: live.settings,
    backgroundEffect: !fx ? null : isBuiltinEffect(fx) ? fx.id : fx,
    groups: live.groups,
    hidden: live.hidden,
  }
}

// ── Local persistence: the `state` half only. ──────────────────────────────────

// ".2": earlier builds autosaved backgroundEffect:null before effects existed
const STATE_KEY = "reze-design.sceneState.2"

export function saveSceneState(state: SceneState) {
  try {
    // Stamped with the format version so a future default/semantic change can MIGRATE the blob
    window.localStorage.setItem(STATE_KEY, JSON.stringify({ version: SCENE_FORMAT_VERSION, ...state }))
  } catch {
    // storage full/blocked — edits just won't persist
  }
}

/** Stored blobs from before the multi-model format carry `groups` as an ARRAY plus */
type StoredState = Omit<Partial<SceneState>, "groups"> & {
  groups?: Record<string, StyleGroup[]> | StyleGroup[] | null
  groupsFor?: string | null
}

function loadStoredState(): StoredState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    return raw ? (JSON.parse(raw) as StoredState) : null
  } catch {
    return null
  }
}

function migrateStoredGroups(stored: StoredState | null): Record<string, StyleGroup[]> | null {
  if (!stored?.groups) return null
  if (Array.isArray(stored.groups)) return stored.groupsFor ? { [stored.groupsFor]: stored.groups } : null
  return stored.groups
}

/** The boot document: `base` (the bundled default) with the user's stored values merged over */
export function hydrateScene(base: Scene): Scene {
  const stored = loadStoredState()
  // No new-format state yet: lift the pre-format settings-only blob, so an existing user's
  const settingsBase = stored?.settings ?? loadLegacySceneSettings() ?? base.state.settings
  // Groups restore PER MODEL: an entry only applies when its model id is in the scene (groups
  const storedGroups = migrateStoredGroups(stored)
  const baseIds = new Set(base.assets.models.map((m) => m.model.id))
  const usableGroups = storedGroups
    ? Object.fromEntries(Object.entries(storedGroups).filter(([id]) => baseIds.has(id)))
    : null
  const groupsUsable = usableGroups != null && Object.keys(usableGroups).length > 0

  return {
    ...base,
    state: {
      ...base.state,
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
