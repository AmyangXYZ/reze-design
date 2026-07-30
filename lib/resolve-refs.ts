// Turning a document's pins into content, in two tiers.
//
// Built-ins ship in the app bundle, so a pin to one costs nothing and works with
// no database — that is what keeps a clone of this repo running. Everything else
// is fetched in a single request, whatever the document pins.

import { BACKGROUND_EFFECTS } from "@/lib/background-effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import type { ItemRef, SceneDoc } from "@/lib/scene"
import { sceneRefs } from "@/lib/scene"

type Payload = { graph?: unknown; wgsl?: string; spec?: unknown }

const bundled = new Map<string, { version: number; payload: Payload }>()
for (const i of [...GRAPH_LIBRARY, ...BACKGROUND_EFFECTS, ...GRADE_PRESETS]) {
  bundled.set(i.id, { version: i.version, payload: i.payload as Payload })
}

/** A resolver for every pin in the document, built with one request at most. */
export async function resolveSceneRefs(doc: SceneDoc): Promise<(ref: ItemRef) => Payload | undefined> {
  const remote = new Map<string, Payload>()
  const missing = sceneRefs(doc).filter((r) => {
    const hit = bundled.get(r.id)
    // A pinned version the bundle doesn't carry (retuned since) still has to be
    // fetched — the pin means that exact version, not "whatever ships today".
    return !hit || hit.version !== r.version
  })

  if (missing.length > 0) {
    try {
      const res = await fetch("/api/library/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refs: missing }),
      })
      if (res.ok) {
        const { payloads } = (await res.json()) as Record<string, Record<string, { payload: Payload }>>
        for (const [key, v] of Object.entries(payloads ?? {})) remote.set(key, v.payload)
      }
    } catch {
      // Unresolved pins render as the engine default — degraded, never broken.
    }
  }

  return (ref) => {
    const hit = bundled.get(ref.id)
    if (hit && hit.version === ref.version) return hit.payload
    return remote.get(`${ref.id}@${ref.version}`)
  }
}
