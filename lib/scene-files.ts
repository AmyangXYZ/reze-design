// The source Files behind the current scene's uploaded assets, kept for
// zip-on-publish. Loading hands bytes to the engine and used to drop them; a
// publish that asks the user to re-upload what the scene is already showing
// would be absurd, so the app retains what it was given.
//
// In-memory only — reloading the page drops uploads anyway (the engine can't
// reload them either), so persisting this would promise more than it keeps.

import { fileSafe } from "@/lib/material-maps"

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
  /** The track's companions, retained WHEREVER they loaded from — a served
   *  path, or a published bundle. Kept so collect can pack them: the document
   *  names them, and a scene that depended on them being site-served only
   *  worked for the site's own tracks. */
  score: null as File | null,
  lyrics: null as File | null,
  camera: null as File | null,
  /** Media planes, keyed by model id — the picture each card is made of. */
  planes: new Map<string, File>(),
}

/**
 * Bundle-relative paths for one model's files, with a wrapper directory removed.
 *
 * A folder pick carries the picked directory in `webkitRelativePath`; a zip
 * carries its own root inside `File.name`. Either way, a first segment that EVERY
 * file shares is packaging rather than structure, and keeping it nested the model
 * one level deeper than its own id — `models/<id>/<same-name-again>/model.pmx`.
 */
/** Where a kept File sits relative to its upload: folder picks carry the path in
 *  webkitRelativePath, zip expansion in name. The one rule, spelled once. */
export const relFilePath = (f: File) => (f.webkitRelativePath || f.name).replace(/\\/g, "/")

/**
 * The files a loaded model actually needs, out of everything the upload held.
 *
 * WHAT WAS PICKED IS NOT WHAT IS USED. A folder pick takes the whole directory,
 * so a stage folder hands over its `.blend`, a second `.glb`, the author's
 * readme and their source PSDs — and all of it was being retained, zipped into
 * every autosave and uploaded with every publish. X340's folder came to 458 MB
 * of which the model referenced less than half.
 *
 * KEPT: the .pmx, everything its texture table names, the maps the naming rule
 * binds, and the two side files a stage reads after it loads — its world and
 * its lighting rig. Nothing else.
 *
 * Texture paths are matched by their full path AND by basename, because that is
 * how the engine resolves them: a PMX naming `tex\body.png` finds a file the
 * folder put elsewhere. Keeping a stray file costs bytes; dropping a live one
 * costs the texture, so where the two rules disagree this keeps both.
 */
export function referencedFiles(
  files: File[],
  pmx: File,
  model: { getTextures(): { path: string }[]; getMaterials(): { name: string }[] },
  mapPaths: string[],
): File[] {
  const pmxPath = relFilePath(pmx)
  const dir = pmxPath.slice(0, pmxPath.lastIndexOf("/") + 1)
  const stem = pmxPath.replace(/\.pmx$/i, "")
  const keep = new Set([pmxPath, `${stem}.hdr`, `${stem}.lights.json`, ...mapPaths])
  const bases = new Set<string>()
  for (const t of model.getTextures()) {
    const p = t.path.replace(/\\/g, "/")
    keep.add(p)
    keep.add(dir + p)
    bases.add((p.split("/").pop() ?? p).toLowerCase())
  }
  // And this model's own `maps/`, by the material's name. mapPaths is what the
  // loader binds TODAY, which skips a slot whose siblings are absent; the folder
  // is the model's regardless, and a map dropped here comes back as white with
  // nothing to say it ever existed.
  const owned = model.getMaterials().map((m) => `${dir}maps/${fileSafe(m.name)}_`.toLowerCase())
  return files.filter((f) => {
    const p = relFilePath(f)
    if (keep.has(p) || bases.has((p.split("/").pop() ?? p).toLowerCase())) return true
    const lower = p.toLowerCase()
    return owned.some((o) => lower.startsWith(o))
  })
}

export function modelFilePaths(files: File[]): Map<File, string> {
  const rel = relFilePath
  const roots = new Set(files.map((f) => rel(f).split("/")[0]))
  // One shared root AND at least one file actually inside it — a flat pick of
  // loose files would otherwise lose its only filename.
  const strip = roots.size === 1 && files.every((f) => rel(f).includes("/"))
  return new Map(files.map((f) => [f, strip ? rel(f).slice(rel(f).indexOf("/") + 1) : rel(f)]))
}
