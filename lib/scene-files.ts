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

/** The bundle-relative path a model file is stored (and later resolved) under. */
export function modelFilePath(f: File): string {
  const rel = f.webkitRelativePath || f.name
  // Folder picks include the picked directory itself — strip it so the bundle
  // layout matches what a zip expansion produces.
  const i = rel.indexOf("/")
  return f.webkitRelativePath && i !== -1 ? rel.slice(i + 1) : rel
}
