"use client"

// A document's clips — each cast member's motion, and the morph track that
// dresses it — loaded onto the engine the one way every page that shows a scene
// loads them.
//
// The editor and the viewer each had a loader, and they disagreed in ways that
// only showed in one of them: the viewer never trimmed a morph track to its
// motion (a longer face track stretched the loop), and revealed every model at
// frame 0 whether its visibility track had it on stage or not (a costume change
// flashed both costumes); the editor waited for the WHOLE cast before posing
// anyone, so the first character stood hidden behind the last one's download.
// This is the union of what each got right.

import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import type { AssetRef, Scene } from "@/lib/scene"
import { visibleAt } from "@/lib/visibility"

type Loader = (modelId: string, file: File) => Promise<string | null>
type UrlLoader = (modelId: string, name: string, url: string) => Promise<string | null>

export function useSceneClips({
  engineRef,
  scene,
  bundleReady,
  models,
  bundleFile,
  loadVmdFile,
  loadVmdUrl,
  loadMorphFile,
  loadMorphUrl,
  onMotion,
  onMorph,
}: {
  engineRef: RefObject<Engine | null>
  scene: Scene
  bundleReady: boolean
  /** The engine's loaded models, as useEngine reports them — a clip is loaded
   *  the moment its model has landed, not once the whole cast has. */
  models: { id: string }[]
  bundleFile: (path: string) => File | null
  loadVmdFile: Loader
  loadVmdUrl: UrlLoader
  loadMorphFile: Loader
  loadMorphUrl: UrlLoader
  /** A motion is on its model. `src` is what actually loaded — the bundled
   *  File, else the URL — which the editor's clip rows keep for the next save. */
  onMotion?: (modelId: string, clip: AssetRef, src: File | string) => void
  /** Likewise for a morph track. */
  onMorph?: (modelId: string, clip: AssetRef, src: File | string) => void
}) {
  /** Cast ids whose motion is on, in DOCUMENT order — AnimPlayer reads index 0
   *  as the master clock, so arrival order would hand the clock to whoever
   *  downloaded first. Kept with the document it belongs to. */
  const [loaded, setLoaded] = useState<{ scene: Scene; ids: ReadonlySet<string> }>(() => ({
    scene,
    ids: new Set(),
  }))

  // Which models this document has already started on. A ref, not state: it
  // guards work, it does not render. Replaced — never cleared — when the
  // document changes, so a pass still running for the old one can tell.
  const claimed = useRef<{ scene: Scene; ids: Set<string> }>({ scene, ids: new Set() })
  // One pass at a time, appended to whatever is still in flight: models land in
  // their own time and no pass may start a load the previous one is doing.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const callbacks = useRef({ onMotion, onMorph })
  useEffect(() => {
    callbacks.current = { onMotion, onMorph }
  })

  useEffect(() => {
    // On the BUNDLE, not on the whole scene: a packed clip resolves the moment
    // the zip is out, and its model is the only other thing it needs.
    if (!bundleReady) return
    const engine = engineRef.current
    if (!engine) return
    if (claimed.current.scene !== scene) claimed.current = { scene, ids: new Set() }
    const mine = claimed.current
    const present = new Set(models.map((m) => m.id))
    // Scenery carries no clip; a model the engine does not hold yet is left for
    // the pass its arrival triggers.
    const fresh = scene.assets.models.filter(
      (e) => !e.stage && !mine.ids.has(e.model.id) && present.has(e.model.id) && engine.getModel(e.model.id),
    )
    if (fresh.length === 0) return
    for (const e of fresh) mine.ids.add(e.model.id)
    const stale = () => claimed.current !== mine

    queue.current = queue.current.then(async () => {
      for (const entry of fresh) {
        const clip = entry.animation
        if (!clip) continue
        const packed = bundleFile(clip.url)
        const name = await (packed ? loadVmdFile(entry.model.id, packed) : loadVmdUrl(entry.model.id, clip.name, clip.url))
        if (stale()) return
        if (name) {
          callbacks.current.onMotion?.(entry.model.id, clip, packed ?? clip.url)
          setLoaded((prev) =>
            prev.scene === scene ? { scene, ids: new Set([...prev.ids, entry.model.id]) } : { scene, ids: new Set([entry.model.id]) },
          )
        } else {
          // A failed LOAD must not retract the document's CLAIM: the editor
          // writes the document from its clip rows, so dropping the row here
          // would persist `animation: null` for what was only a transient miss.
          console.warn(`[scene] motion failed to load for ${entry.model.id}, keeping its claim:`, clip.name)
        }
        // Hidden since load so bind pose never shows — revealed on the clip's
        // first pose, or anyway if it failed: a bind-pose model beats none. At
        // frame 0 of its own track, so a costume that opens the scene off stage
        // is never on screen for the frame before the first tick.
        engine.setModelTransform(entry.model.id, { visible: visibleAt(entry.visibility, 0) })
      }
      // Morphs AFTER the motions, in their own pass: a morph merges INTO its
      // model's clip, and a motion arriving afterwards rebuilds that clip and
      // drops the merge.
      for (const entry of fresh) {
        const expr = entry.morph
        if (!expr) continue
        const packed = bundleFile(expr.url)
        const name = await (packed
          ? loadMorphFile(entry.model.id, packed)
          : loadMorphUrl(entry.model.id, expr.name, expr.url))
        if (stale()) return
        if (name) callbacks.current.onMorph?.(entry.model.id, expr, packed ?? expr.url)
        else console.warn(`[scene] morph failed to load for ${entry.model.id}, keeping its claim:`, expr.name)
      }
    }).catch((e) => {
      // One pass that throws must not stall every pass queued behind it.
      console.error("[scene] clip pass failed:", e)
    })
  }, [bundleReady, scene, models, engineRef, bundleFile, loadVmdFile, loadVmdUrl, loadMorphFile, loadMorphUrl])

  // Stable between arrivals: the clock effects downstream re-arm on it.
  const animated = useMemo(
    () => (loaded.scene === scene ? scene.assets.models.filter((e) => loaded.ids.has(e.model.id)).map((e) => e.model.id) : []),
    [loaded, scene],
  )
  return { animated }
}
