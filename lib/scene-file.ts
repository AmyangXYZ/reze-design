// The legacy `.reze.json` config format: the `state` half of a Scene, never the
// assets. The app no longer WRITES it — export produces the full `.reze.zip` with the
// document beside its files — but files people already exported must keep importing,
// so the reader stays.
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

import type { AppliedEffect } from "@/lib/effects"
import { SCENE_FORMAT_VERSION, type SceneState } from "@/lib/scene"

/** Tag so a stray .json is refused with a reason rather than half-applied. */
export const SCENE_FILE_KIND = "reze-design/scene-config"

/** Everything but the scene's identity — an imported config joins the scene you are in
 *  rather than replacing which scene that is. */
export type SceneConfig = Omit<SceneState, "id">

export type SceneFile = { kind: string; version: number } & SceneConfig

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
  if ("backgroundEffects" in f) config.backgroundEffects = (f.backgroundEffects as AppliedEffect[]) ?? []
  if (f.groups && typeof f.groups === "object") config.groups = f.groups
  if (f.hidden && typeof f.hidden === "object") config.hidden = f.hidden
  return config
}

export const slug = (s: string, fallback = "scene") =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback

/** The FULL export: doc + assets in one zip, named the way video exports are —
 *  reze-design-<scene>-<stamp> — so a downloads folder sorts a session's artifacts
 *  together. The stamp carries the LOCAL time of day down to seconds: exporting is
 *  cheap enough to do many times a day, and identical names would shadow each other
 *  as "(1)" copies. Dashes, not colons — Windows forbids colons in filenames. */
export function sceneZipFileName(name: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  return `reze-design-${slug(name)}-${stamp}.zip`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
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
