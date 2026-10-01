// A scene PATCH: a document that changes the current scene instead of replacing it.
//
// ag-rip writes a game sequence — its stage, the props it moves, its particle
// effects, the camera and the voice — as a zip that is MEANT to land on a scene
// the user already has, character and motion included. A full document would
// take all of that away on import, so it says `"patch": true` and only the
// fields it owns.
//
// JSON Merge Patch (RFC 7386), with two keyed lists:
//
//   - a field with a value overwrites; objects merge recursively, so
//     `settings.sun.elevation` alone changes only that
//   - a field set to null clears it
//   - an absent field keeps the current scene's value
//   - other lists replace wholesale, except:
//       assets.models — merged by model id (the key the scene mints from the
//         .pmx filename, or an explicit `id`). A listed model is added, or
//         replaces the one with its id in place; `{ id, remove: true }` deletes
//         one; unlisted models stay. `assets.cast: null` first clears every
//         model that is neither stage nor prop — the cast.
//       settings.background.effects — appended, after taking out every
//         current effect that carries one of the patch's tags.
//
// CAST MOTION: `assets.castMotion` is the primary cast member's motion slot —
// the first model that is neither stage nor prop, the one the camera follows
// (firstCastId). `{ animation, morph? }`, paths in the document's own form,
// replaces the slot whole: `morph` absent is null, the new motion's own morphs,
// never the old clip's overlay. `castMotion: null` empties the slot. The model,
// its materials, placement and visibility stay. No cast member: nothing to set,
// and the field is dropped.
//
// TAGS: what a patch brings carries a tag — an effect its `stage`, a model its
// `origin` — and a patch replaces everything it finds with its own tags. So the
// second take of a sequence over the first replaces the first's props and
// effects rather than piling on top of them. The patch's own tag is its
// top-level `origin`, stamped on every model and effect it lists that carries
// none. Tagged models drop only when the patch lists models, and tagged effects
// only when it lists effects: a patch that only moves the sun leaves both alone.
//
// Pure: no engine, no DOM. The caller turns the merged document into a scene
// with the same parse every other document goes through.

import { modelKey, type SceneDoc } from "@/lib/scene"

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type JsonObject = { [k: string]: Json }

/** A model entry as a patch lists it: a document entry, or a removal. */
export type PatchModelDoc = { [k: string]: Json } & { id?: string; remove?: boolean; model?: string; origin?: string }

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether a parsed scene.json is a patch rather than a whole scene. */
export const isScenePatch = (doc: unknown): boolean => isObject(doc) && doc.patch === true

/** RFC 7386 MergePatch(target, patch). Returns a new value; neither input is touched. */
export function mergePatch(target: Json | undefined, patch: Json): Json {
  if (!isObject(patch)) return structuredClone(patch)
  const out: JsonObject = isObject(target) ? { ...target } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

/** A model entry's key: its explicit id, or the one the scene mints from its file. */
const keyOf = (m: PatchModelDoc): string => (typeof m.id === "string" && m.id ? m.id : modelKey(String(m.model ?? ""), []))

/** A path in the document's form; an `{ url }` AssetRef is read for its url. */
const pathOf = (v: Json | undefined): string | null =>
  typeof v === "string" && v ? v : isObject(v) && typeof v.url === "string" && v.url ? v.url : null

/** `assets.castMotion` as the slot it sets; undefined when it is not one. */
function castMotionOf(v: Json): { animation: string | null; morph: string | null } | undefined {
  if (v === null) return { animation: null, morph: null }
  if (!isObject(v)) return undefined
  return { animation: pathOf(v.animation), morph: pathOf(v.morph) }
}

/** Every tag the patch stands for: its own, and whatever its entries carry. */
export function patchTags(patch: JsonObject): Set<string> {
  const tags = new Set<string>()
  if (typeof patch.origin === "string" && patch.origin) tags.add(patch.origin)
  const assets = isObject(patch.assets) ? patch.assets : {}
  for (const m of Array.isArray(assets.models) ? assets.models : [])
    if (isObject(m) && typeof m.origin === "string" && m.origin) tags.add(m.origin)
  const bg = isObject(patch.settings) && isObject(patch.settings.background) ? patch.settings.background : {}
  for (const e of Array.isArray(bg.effects) ? bg.effects : [])
    if (isObject(e) && typeof e.stage === "string" && e.stage) tags.add(e.stage)
  return tags
}

/**
 * The scene the patch describes: `base` with `patch` applied.
 *
 * The base's models are keyed the way parseAssetsDoc keys them — in order,
 * a second model of one filename taking `-2` — so an id a patch names is the
 * id the editor shows.
 */
export function mergeScenePatch(base: SceneDoc, patchDoc: unknown): SceneDoc {
  if (!isObject(patchDoc)) throw new Error("scene patch: not an object")
  const patch = patchDoc
  const origin = typeof patch.origin === "string" && patch.origin ? patch.origin : null
  const tags = patchTags(patch)
  const assetsP = isObject(patch.assets) ? patch.assets : null
  const settingsP = isObject(patch.settings) ? patch.settings : null
  const bgP = settingsP && isObject(settingsP.background) ? settingsP.background : null

  // Everything but the keyed lists goes through the plain merge. The patch's
  // own bookkeeping never lands in the scene, and neither does the version: the
  // base is the document this build wrote.
  const plain: JsonObject = { ...patch }
  delete plain.patch
  delete plain.origin
  delete plain.version
  delete plain.engine
  if (assetsP) {
    const a: JsonObject = { ...assetsP }
    delete a.models
    delete a.cast
    delete a.castMotion
    // Where the files are is the importer's to say, never the patch's.
    delete a.bundle
    plain.assets = a
  }
  if (settingsP && bgP) {
    const b: JsonObject = { ...bgP }
    delete b.effects
    plain.settings = { ...settingsP, background: b }
  }
  const merged = mergePatch(base as unknown as Json, plain) as unknown as SceneDoc

  // ── assets.models, by id ──
  const ids: string[] = []
  let rows = base.assets.models.map((m) => {
    const id = modelKey(m.model, ids)
    ids.push(id)
    return { id, doc: structuredClone(m) as unknown as PatchModelDoc }
  })
  if (assetsP && "cast" in assetsP && assetsP.cast === null) rows = rows.filter((r) => r.doc.stage || r.doc.prop)
  if (assetsP && Array.isArray(assetsP.models)) {
    const listed = assetsP.models.filter(isObject) as PatchModelDoc[]
    const keys = new Set(listed.map(keyOf))
    // The previous take's: carrying one of this patch's tags and not listed again.
    rows = rows.filter((r) => !(typeof r.doc.origin === "string" && tags.has(r.doc.origin) && !keys.has(r.id)))
    for (const m of listed) {
      const key = keyOf(m)
      if (m.remove === true) {
        rows = rows.filter((r) => r.id !== key)
        continue
      }
      if (typeof m.model !== "string" || !m.model) continue
      const doc: PatchModelDoc = structuredClone(m)
      delete doc.id
      delete doc.remove
      if (origin && !doc.origin) doc.origin = origin
      const at = rows.findIndex((r) => r.id === key)
      if (at >= 0) rows[at] = { id: key, doc }
      else rows.push({ id: key, doc })
    }
  }
  // ── assets.castMotion, onto the primary cast member ──
  if (assetsP && "castMotion" in assetsP) {
    const motion = castMotionOf(assetsP.castMotion)
    const lead = rows.find((r) => !r.doc.stage && !r.doc.prop)
    if (motion === undefined) console.warn("[scene patch] castMotion: neither an object nor null; ignored")
    else if (!lead) console.info("[scene patch] castMotion: the scene has no cast member to move; ignored")
    else lead.doc = { ...lead.doc, animation: motion.animation, morph: motion.morph }
  }
  merged.assets.models = rows.map((r) => r.doc as unknown as SceneDoc["assets"]["models"][number])

  // ── settings.background.effects, by tag ──
  if (bgP && "effects" in bgP) {
    if (bgP.effects === null) merged.settings.background.effects = []
    else if (Array.isArray(bgP.effects)) {
      const kept = (base.settings.background.effects ?? []).filter((e) => !(e && typeof e.stage === "string" && tags.has(e.stage)))
      const added = bgP.effects.filter(isObject).map((e) => {
        const c = structuredClone(e) as JsonObject
        if (origin && !c.stage) c.stage = origin
        return c as unknown as NonNullable<SceneDoc["settings"]["background"]["effects"]>[number]
      })
      merged.settings.background.effects = [...kept, ...added]
    }
  }
  return merged
}

/**
 * The folders a patch brings whole: its game stage, and each model's own
 * folder. The current scene's files under them are the previous take's copy
 * and go, so a stage or a prop that lost a file since does not keep it.
 */
export function patchRoots(patchDoc: unknown): string[] {
  if (!isObject(patchDoc) || !isObject(patchDoc.assets)) return []
  const a = patchDoc.assets
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1)
  const roots: string[] = []
  if (typeof a.nativeStage === "string" && a.nativeStage)
    roots.push(a.nativeStage.endsWith("/") ? a.nativeStage : `${a.nativeStage}/`)
  for (const m of Array.isArray(a.models) ? a.models : []) {
    if (!isObject(m) || m.remove === true || typeof m.model !== "string") continue
    // Only bundle-relative ones: a served model's folder is the site's.
    if (/^(?:\/|https?:|blob:|data:)/.test(m.model)) continue
    const d = dir(m.model)
    if (d) roots.push(d)
  }
  return [...new Set(roots)]
}

/**
 * One bundle out of two: the current scene's files and the patch's.
 *
 * The patch's win where both have a path, and the current scene's files under a
 * folder the patch brings whole are dropped. Everything else of the current
 * scene's stays — the next repack keeps only what the merged document names.
 */
export function mergePatchFiles<F extends { path: string }>(base: F[], patch: F[], roots: string[]): F[] {
  const incoming = new Set(patch.map((f) => f.path))
  const kept = base.filter((f) => !incoming.has(f.path) && !roots.some((r) => f.path.startsWith(r)))
  return [...kept, ...patch]
}
