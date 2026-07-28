// The scene document — one JSON bundle describing everything a scene is. Three
// consumers, one shape: the bundled demo (lib/default-scene.ts) is an instance
// of it, the user's working scene persists as one, and later it exports/imports
// and gets served from a permanent URL.
//
// The `assets` / `state` split is the DURABILITY boundary, not cosmetic grouping:
//
//   assets — every reference to a file. While the user works, their uploads are
//            `blob:` object URLs backed by File objects, which die on reload —
//            so assets are NEVER written to localStorage. They become durable
//            URLs only on export (or once uploaded to blob storage).
//   state  — plain values the user edited. Reload-safe, so localStorage carries
//            the latest as their working scene.
//
// Keeping that split STRUCTURAL (rather than a hand-listed field subset at each
// call site) is the point: adding a field later can't accidentally leak an asset
// path into storage, where it would restore as a dead blob: URL.

import type { MaterialPresetMap, StyleGroup } from "reze-engine"
import type { AppliedBackgroundEffect } from "@/lib/background-effects"
import { loadLegacySceneSettings, type SceneSettings } from "@/lib/scene-settings"

export const SCENE_FORMAT_VERSION = 1

/** A file the scene points at.
 *
 *  `url` is anything fetchable, and which kind it is tracks the asset's lifecycle:
 *  a bundled "/animations/x.vmd" for the demo, a "blob:…" object URL while the
 *  user is working, an absolute "https://cdn.example.com/…/x.vmd" once uploaded.
 *  Stored RAW (never hand-encoded) so the JSON stays readable — fetch and the URL
 *  parser percent-encode spaces and non-ASCII on their own.
 *
 *  `name` is the display label AND the engine's clip key, so it stays the
 *  original filename even when the url is an opaque blob/CDN path. */
export type AssetRef = { name: string; url: string }

/** Where a model's files come from. A model is never ONE file — the .pmx resolves
 *  its texture paths relative to its own location, so the whole set travels
 *  together — but there are two ways to ship that set, with real trade-offs:
 *
 *    folder — each file served individually. Streams progressively (the .pmx can
 *             parse while textures arrive), and the CDN caches per file, which
 *             matters because the standard toon/sphere maps (toon2, toon3, mc1,
 *             mc3) are byte-identical across unrelated models.
 *    zip    — one archive, expanded client-side (lib/uploads.ts). One atomic PUT
 *             per upload instead of one per file, but nothing renders until the
 *             whole archive lands, and no cross-model texture cache.
 *
 *  Both are expressible so the serve path can change — zip on day one, unpacked
 *  on ingest later — without invalidating scenes already saved. */
export type ModelSource =
  | { kind: "folder"; dir: string }  // folder URL, no trailing slash
  | { kind: "zip"; url: string }     // archive URL

export type ModelRef = {
  /** Engine key for this model instance. ASCII, arbitrary, never shown. */
  id: string
  /** .pmx filename inside the folder/archive — also what the Assets panel shows. */
  file: string
  source: ModelSource
  /** Additive corrections to autoStyleGroups' built-in JP/CN/EN name hints, which
   *  already handle the standard names. List only what the hints get wrong. */
  presets?: MaterialPresetMap
}

/** The background's BASE layer: a backdrop (flat image behind the canvas) or a
 *  skybox (360° equirect, drawn by the engine) — mutually exclusive, since a
 *  flat layer behind an opaque skybox is invisible; one tagged field makes that
 *  state unrepresentable. `null` = the solid background color from settings.
 *
 *  This is only HALF the background: a WGSL effect layer can float over it
 *  (state.backgroundEffect — a value, so it lives on the other side of the
 *  durability boundary from these file-backed assets). */
export type SceneBackground = { kind: "backdrop" | "skybox"; asset: AssetRef } | null

/** One character in the scene: the model plus ITS motion clip. Clips are per
 *  model instance in the engine, so a multi-model scene attaches one each —
 *  formations typically reuse the same VMD across entries. */
export type SceneModel = {
  model: ModelRef
  animation: AssetRef | null
}

export type SceneAssets = {
  /** ≥1 entry; [0] is the PRIMARY model — boot camera framing is tuned to it and
   *  it anchors the master clock fallback when no model has a longer clip. */
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
  /** WGSL effect layered between the base background and the model (stars,
   *  water…). Stored as a full snapshot (wgsl + params), not a library
   *  reference, so a saved or shared scene reproduces exactly even if the
   *  library entry changes later — same philosophy as `groups`. */
  backgroundEffect: AppliedBackgroundEffect | null
  /** Per-group shader graphs — the user's actual creative work — keyed by the
   *  ModelRef.id they were authored against. Groups name MATERIALS, and those
   *  exist in exactly one model, so restoring a model's groups is gated on its
   *  id being present in the key set; models without an entry auto-group from
   *  material names at load. `null` = auto-group everything (the demo's mode —
   *  it re-derives whenever the bundled model is swapped). */
  groups: Record<string, StyleGroup[]> | null
}

export type Scene = {
  version: number
  assets: SceneAssets
  state: SceneState
}

/** Join a folder URL and a filename. No encoding — see AssetRef.url. */
export function assetUrl(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, "")}/${file}`
}

/** An AssetRef for a served path whose URL still carries the filename — bundled
 *  assets, or any CDN layout that keeps readable keys. Derives `name` so the two
 *  can't disagree (they already did once: an "IRIS OUT.vmd" name on a "One More
 *  Last Time" url). Assets whose URL has NO recoverable name — blob: object URLs
 *  while the user works, content-addressed CDN keys — must pass `name` explicitly
 *  instead; that's why AssetRef carries it at all. */
export function assetFromPath(url: string): AssetRef {
  return { name: decodeURIComponent(url.split("/").pop() ?? url), url }
}

/** The .pmx URL for a folder-sourced model — the engine resolves its textures
 *  against it. Zip sources have no such URL: fetch `source.url` and expand it
 *  (expandUploadFiles in lib/uploads.ts) into the File[] loadModel takes. */
export function modelPmxUrl(model: ModelRef): string | null {
  return model.source.kind === "folder" ? assetUrl(model.source.dir, model.file) : null
}

/** Snapshot the live editor into a document. Centralises the version stamp and
 *  the `groupsFor` derivation so callers can't forget either. */
export function serializeScene(live: {
  models: SceneModel[]
  cameraAnimation: AssetRef | null
  audio: AssetRef | null
  background: SceneBackground
  name: string
  camera: SceneState["camera"]
  settings: SceneSettings
  backgroundEffect: AppliedBackgroundEffect | null
  groups: Record<string, StyleGroup[]>
}): Scene {
  return {
    version: SCENE_FORMAT_VERSION,
    assets: {
      models: live.models,
      cameraAnimation: live.cameraAnimation,
      audio: live.audio,
      background: live.background,
    },
    state: {
      name: live.name,
      camera: live.camera,
      settings: live.settings,
      backgroundEffect: live.backgroundEffect,
      groups: live.groups,
    },
  }
}

// ── Local persistence: the `state` half only. ──────────────────────────────────

// ".2": earlier builds autosaved backgroundEffect:null before effects existed,
// and the explicit-null-preserving hydrate (correctly) kept honoring it — so the
// demo's default effect could never land for anyone who had run an old build.
// Bumping the key re-seeds everyone from the current defaults once.
const STATE_KEY = "reze-design.sceneState.2"

export function saveSceneState(state: SceneState) {
  try {
    // Stamped with the format version so a future default/semantic change can
    // MIGRATE the blob surgically instead of bumping STATE_KEY (which wipes the
    // user's whole working scene — their groups and effects, not just our
    // defaults). New FIELDS never need either: hydrateScene's per-section merge
    // fills them from the current defaults automatically.
    window.localStorage.setItem(STATE_KEY, JSON.stringify({ version: SCENE_FORMAT_VERSION, ...state }))
  } catch {
    // storage full/blocked — edits just won't persist
  }
}

/** Stored blobs from before the multi-model format carry `groups` as an ARRAY
 *  plus a `groupsFor` model id — lift them into the per-model-id record. */
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

/** The boot document: `base` (the bundled default) with the user's stored values
 *  merged over it. Assets always come from `base` — nothing about them is stored.
 *
 *  Settings merge per-section against `base`'s own — not a global constant — so a
 *  doc gaining a new setting doesn't leave users with a stored blob missing it,
 *  and an imported scene fills its gaps from ITS defaults rather than the demo's.
 *  (It also keeps this module from importing lib/default-scene.ts, which imports
 *  the Scene type from here — a value-level cycle waiting to happen.) */
export function hydrateScene(base: Scene): Scene {
  const stored = loadStoredState()
  // No new-format state yet: lift the pre-format settings-only blob, so an
  // existing user's saved look survives the upgrade.
  const settingsBase = stored?.settings ?? loadLegacySceneSettings() ?? base.state.settings
  // Groups restore PER MODEL: an entry only applies when its model id is in the
  // scene (groups name materials, which exist in exactly one model). Ids from
  // removed/renamed uploads simply don't match and fall back to auto-grouping.
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
      // Model-independent (unlike groups) — restores across model swaps. `in`
      // check, not ??: a stored NULL is the user having REMOVED the effect, and
      // must not resurrect the demo default on reload; only a blob from before
      // the field existed falls through.
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
    },
  }
}
