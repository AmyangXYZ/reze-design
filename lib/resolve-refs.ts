// Turning a document's pins into content, in two tiers.
//
// Built-ins ship in the app bundle, so a pin to one costs nothing and works with
// no database — that is what keeps a clone of this repo running. Everything else
// is fetched in a single request, whatever the document pins.

import type { ShaderGraph } from "reze-engine"
import { EFFECTS } from "@/lib/effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import type { ItemRef, SceneDoc } from "@/lib/scene"
import { sceneRefs } from "@/lib/scene"

type Payload = { graph?: ShaderGraph; wgsl?: string; spec?: unknown }

/** What a pin resolves to: the content, plus the name it is known by. An effect
 *  has nowhere else to carry its label — a graph keeps one inside itself — and a
 *  nameless effect leaves the picker with nothing to show. */
type Resolved = Payload & { name: string }

const bundled = new Map<string, { version: number; resolved: Resolved }>()
for (const i of [...GRAPH_LIBRARY, ...EFFECTS, ...GRADE_PRESETS]) {
  bundled.set(i.id, { version: i.version, resolved: { ...(i.payload as Payload), name: i.name } })
}

/** Pins this document has that the app bundle does not carry. */
function missingRefs(doc: SceneDoc): ItemRef[] {
  return sceneRefs(doc).filter((r) => {
    const hit = bundled.get(r.id)
    // A pinned version the bundle doesn't carry (retuned since) still has to be
    // fetched — the pin means that exact version, not "whatever ships today".
    return !hit || hit.version !== r.version
  })
}

/**
 * The resolver WITHOUT the request — null when this document needs one.
 *
 * A scene wearing only built-in looks pins nothing the app has not already
 * shipped, which is the common case. Saying so synchronously lets a host parse
 * its document during the first render, so the canvas is in that render and the
 * engine starts on mount: no awaited tick, no second pass, and nothing to show
 * in the meantime.
 */
export function resolveSceneRefsSync(doc: SceneDoc): ((ref: ItemRef) => Resolved | undefined) | null {
  if (missingRefs(doc).length > 0) return null
  return (ref) => {
    const hit = bundled.get(ref.id)
    return hit && hit.version === ref.version ? hit.resolved : undefined
  }
}

/** A resolver for every pin in the document, built with one request at most. */
export async function resolveSceneRefs(doc: SceneDoc): Promise<(ref: ItemRef) => Resolved | undefined> {
  const remote = new Map<string, Resolved>()
  const missing = missingRefs(doc)

  if (missing.length > 0) {
    try {
      const res = await fetch("/api/library/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refs: missing }),
      })
      if (res.ok) {
        const { payloads } = (await res.json()) as {
          payloads?: Record<string, { payload: Payload; name: string }>
        }
        for (const [key, v] of Object.entries(payloads ?? {})) remote.set(key, { ...v.payload, name: v.name })
      }
    } catch {
      // Unresolved pins render as the engine default — degraded, never broken.
    }
  }

  return (ref) => {
    const hit = bundled.get(ref.id)
    if (hit && hit.version === ref.version) return hit.resolved
    return remote.get(`${ref.id}@${ref.version}`)
  }
}
