// What a finished export was made OF, for the people tuning the presets.
//
// The question this answers: which models, effects, graphs and grades survive
// all the way to a rendered video. The library's `usageCount` only ever saw the
// scenes that were PUBLISHED here, which is the minority path — most finished
// work leaves as a file and goes up on bilibili, and everything it used was
// invisible.
//
// The rule for what travels, and the only one worth remembering: THIS repo's
// things go, the user's things do not. A pinned library id, a built-in's name,
// the dials moved on one of our effects — ours. A .pmx filename is the one
// exception, asked for by name, because which game's models people bring is the
// single most useful thing to know when deciding which presets to tune next.
//
// Motion, music, the scene document, the file the user chose, its size: never.
// Those describe the video someone is making, not the toolkit they made it
// with, and an unreleased video is not ours to know about.

import { isItemRef, type SceneDoc } from "@/lib/scene"
import type { EffectParamValue } from "reze-engine"

/** Stands in for a draft — an unpublished effect or graph. Its source is the
 *  user's own authored WGSL and never leaves the browser, but that a draft was
 *  used is worth knowing: it says the library did not have what they needed. */
export const DRAFT = "(draft)"

export type ExportStats = {
  /** "16:9", "9:16" — which platform the finished file is cut for. */
  aspect: string
  quality: string
  width: number
  height: number
  /** Rendering style, from this browser's look preference. */
  look: string
  /** .pmx filenames, primary first. */
  models: string[]
  effects: { id: string; params?: Record<string, EffectParamValue> }[]
  /** Material shader graph ids, deduplicated across the cast. */
  graphs: string[]
  grade: { id: string; intensity: number } | null
}

// Caps, enforced on both sides. The client cannot produce a scene near any of
// these; the route uses them to bound what one request can touch.
export const MAX_MODELS = 8
export const MAX_EFFECTS = 16
export const MAX_GRAPHS = 32

/**
 * The .pmx (or .zip) name, out of the path the document stores.
 *
 * The LAST segment only. A document holds a whole path — a URL for a hosted
 * model, a bundle-relative path for one the user brought — and the folders
 * leading to it are theirs, not part of the model's identity. Which model it is
 * is the whole question this answers; where it sat on somebody's disk is not.
 */
function modelFileName(path: string): string {
  const clean = path.split(/[?#]/)[0]
  const last = clean.split("/").pop() ?? clean
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/** A pinned id, a built-in's name, or the draft marker — never the content. */
function sourceId(src: unknown): string | null {
  if (isItemRef(src)) return src.id
  if (typeof src === "string") return src
  return DRAFT
}

/**
 * Everything the report says about the scene, read off the same document a
 * publish would write — so what is counted here and what `sceneRefs` counts
 * there are the same pins, and the two numbers can sit in one row.
 */
export function sceneExportStats(doc: SceneDoc): Pick<ExportStats, "models" | "effects" | "graphs" | "grade"> {
  const graphs = new Set<string>()
  for (const m of doc.assets.models) {
    for (const g of m.materials?.groups ?? []) {
      const id = sourceId(g.graph)
      if (id) graphs.add(id)
    }
  }

  const effects = (doc.settings.background.effects ?? []).flatMap((e) => {
    const id = sourceId(e.source)
    if (!id) return []
    // Dials only for something of ours: a draft's params describe a shader that
    // exists on one machine, and mean nothing to anybody reading these rows.
    const params = id !== DRAFT && e.params && Object.keys(e.params).length ? e.params : undefined
    return [{ id, ...(params ? { params } : {}) }]
  })

  const grade = doc.settings.grade
  return {
    models: doc.assets.models.slice(0, MAX_MODELS).map((m) => modelFileName(m.model)),
    effects: effects.slice(0, MAX_EFFECTS),
    graphs: [...graphs].slice(0, MAX_GRAPHS),
    grade: grade.from ? { id: grade.from.id, intensity: grade.intensity } : null,
  }
}

/**
 * Post it and forget it.
 *
 * Never awaited by the export and never able to fail it: the file is already on
 * disk by the time this runs, and a statistics endpoint having a bad day is not
 * something a finished render should ever hear about. `keepalive` so closing the
 * tab on a finished video still delivers it.
 */
export function reportExport(stats: ExportStats): void {
  try {
    void fetch("/api/export-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stats),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Offline, blocked, no fetch — the export is unaffected, which is the point.
  }
}
