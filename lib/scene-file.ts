// A scene's CONFIG as a portable file — the `state` half of a Scene, never the assets.
//
// The split is one the types already draw: `Scene.assets` is what is loaded (models,
// motion, audio, backdrop) and `Scene.state` is how it looks. Only the second half
// travels. That keeps the file small and readable, and sidesteps asset resolution
// entirely — a config never points at a file that may not exist on the machine opening
// it, so there is nothing to go stale.
//
// Self-contained by construction, which is why no inlining step is needed here: a
// runtime `StyleGroup` carries its whole ShaderGraph by value, and an applied
// background effect carries its WGSL. The ItemRef pins live only in the DOCUMENT
// form used for publishing, where a server can resolve them. Grade travels as
// `{ preset, intensity }` — a name, matching how grades are keyed everywhere else.

import { SCENE_FORMAT_VERSION, type SceneState } from "@/lib/scene"

/** Tag so a stray .json is refused with a reason rather than half-applied. */
export const SCENE_FILE_KIND = "reze-design/scene-config"

/** Everything but the scene's identity — an imported config joins the scene you are in
 *  rather than replacing which scene that is. */
export type SceneConfig = Omit<SceneState, "id">

export type SceneFile = { kind: string; version: number } & SceneConfig

/** Listed field by field rather than spread-minus-id, so what leaves the app is
 *  explicit — and so a field added to SceneState later fails to compile here
 *  instead of silently joining every exported file. */
export function toSceneFile(state: SceneState): SceneFile {
  return {
    kind: SCENE_FILE_KIND,
    version: SCENE_FORMAT_VERSION,
    name: state.name,
    camera: state.camera,
    settings: state.settings,
    backgroundEffect: state.backgroundEffect,
    groups: state.groups,
    hidden: state.hidden,
  }
}

/**
 * Field-wise and forgiving: a file missing a key leaves that part of the scene
 * alone instead of failing the whole import, so a config saved before a field
 * existed still applies everything it does carry. Null only for "this is not one
 * of our files" — the one case with a useful message.
 */
export function parseSceneFile(raw: unknown): Partial<SceneConfig> | null {
  if (typeof raw !== "object" || raw === null) return null
  const f = raw as Partial<SceneFile>
  if (f.kind !== SCENE_FILE_KIND) return null
  // A newer format may have reshaped `settings`; applying it half-understood would
  // be worse than declining.
  if (typeof f.version === "number" && f.version > SCENE_FORMAT_VERSION) return null

  const config: Partial<SceneConfig> = {}
  if (typeof f.name === "string" && f.name.trim()) config.name = f.name
  if (f.camera && typeof f.camera === "object") config.camera = f.camera
  if (f.settings && typeof f.settings === "object") config.settings = f.settings
  if ("backgroundEffect" in f) config.backgroundEffect = f.backgroundEffect ?? null
  if (f.groups && typeof f.groups === "object") config.groups = f.groups
  if (f.hidden && typeof f.hidden === "object") config.hidden = f.hidden
  return config
}

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "scene"

export function sceneFileName(name: string): string {
  return `${slug(name)}.reze.json`
}

export function downloadSceneFile(state: SceneState): void {
  const blob = new Blob([JSON.stringify(toSceneFile(state), null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = sceneFileName(state.name)
  a.click()
  // Revoking in the same turn cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function readSceneFile(file: File): Promise<Partial<SceneConfig> | null> {
  try {
    return parseSceneFile(JSON.parse(await file.text()))
  } catch {
    return null // unparseable JSON reads the same as the wrong kind of file
  }
}
