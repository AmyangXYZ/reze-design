// The source Files behind the current scene's uploaded assets, kept for
// zip-on-publish. Loading hands bytes to the engine and used to drop them; a
// publish that asks the user to re-upload what the scene is already showing
// would be absurd, so the app retains what it was given.
//
// In-memory only — reloading the page drops uploads anyway (the engine can't
// reload them either), so persisting this would promise more than it keeps.

export type ModelFiles = {
  pmx: File
  /** Every file of the model, texture folders included. Relative paths live in
   *  webkitRelativePath (folder picks) or name (zip expansion). */
  files: File[]
}

export const sceneFiles = {
  /** Keyed by engine model id. */
  models: new Map<string, ModelFiles>(),
  audio: null as File | null,
  camera: null as File | null,
}

/**
 * Bundle-relative paths for one model's files, with a wrapper directory removed.
 *
 * A folder pick carries the picked directory in `webkitRelativePath`; a zip
 * carries its own root inside `File.name`. Either way, a first segment that EVERY
 * file shares is packaging rather than structure, and keeping it nested the model
 * one level deeper than its own id — `models/<id>/<same-name-again>/model.pmx`.
 */
export function modelFilePaths(files: File[]): Map<File, string> {
  const rel = (f: File) => (f.webkitRelativePath || f.name).replace(/\\/g, "/")
  const roots = new Set(files.map((f) => rel(f).split("/")[0]))
  // One shared root AND at least one file actually inside it — a flat pick of
  // loose files would otherwise lose its only filename.
  const strip = roots.size === 1 && files.every((f) => rel(f).includes("/"))
  return new Map(files.map((f) => [f, strip ? rel(f).slice(rel(f).indexOf("/") + 1) : rel(f)]))
}
