// Turning a document's pins into content, in two tiers.
//
// Built-ins are on the shelf (lib/builtins) before any scene opens, so a pin to
// one costs nothing. Everything else is fetched in a single request, whatever
// the document pins.

import type { ShaderGraph } from "reze-engine"
import { builtinEffects, builtinGrades, builtinGraphs, builtinsVersion } from "@/lib/builtins"
import type { ItemRef, SceneDoc } from "@/lib/scene"
import { sceneRefs } from "@/lib/scene"
import { fetchJson } from "@/lib/net"

type Payload = { graph?: ShaderGraph; wgsl?: string; spec?: unknown }

/** What a pin resolves to: the content, plus the name it is known by. An effect
 *  has nowhere else to carry its label — a graph keeps one inside itself — and a
 *  nameless effect leaves the picker with nothing to show. */
type Resolved = Payload & { name: string }

let shelfAt = -1
let shelf = new Map<string, Resolved>()
/** The shelf by id, rebuilt when it changes. */
function onShelf(): Map<string, Resolved> {
  if (shelfAt !== builtinsVersion()) {
    shelf = new Map()
    for (const i of [...builtinGraphs(), ...builtinEffects(), ...builtinGrades()]) {
      shelf.set(i.id, { ...(i.payload as Payload), name: i.name })
    }
    shelfAt = builtinsVersion()
  }
  return shelf
}

/** Pins this document has that the shelf does not hold. */
function missingRefs(doc: SceneDoc): ItemRef[] {
  const held = onShelf()
  return sceneRefs(doc).filter((r) => !held.has(r.id))
}

/**
 * The resolver WITHOUT the request — null when this document needs one.
 *
 * A scene wearing only built-in looks pins nothing the shelf does not already
 * hold, which is the common case. Saying so synchronously lets a host parse
 * its document during the first render, so the canvas is in that render and the
 * engine starts on mount: no awaited tick, no second pass, and nothing to show
 * in the meantime.
 */
export function resolveSceneRefsSync(doc: SceneDoc): ((ref: ItemRef) => Resolved | undefined) | null {
  if (missingRefs(doc).length > 0) return null
  const held = onShelf()
  return (ref) => held.get(ref.id)
}

/** A resolver for every pin in the document, built with one request at most. */
export async function resolveSceneRefs(doc: SceneDoc): Promise<(ref: ItemRef) => Resolved | undefined> {
  const remote = new Map<string, Resolved>()
  const missing = missingRefs(doc)

  if (missing.length > 0) {
    try {
      // A lookup, so retrying the POST is safe (lib/net).
      const { payloads } = await fetchJson<{ payloads?: Record<string, { payload: Payload; name: string }> }>(
        "/api/library/resolve",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refs: missing }) },
      )
      for (const [key, v] of Object.entries(payloads ?? {})) remote.set(key, { ...v.payload, name: v.name })
    } catch {
      // Unresolved pins render as the engine default — degraded, never broken.
    }
  }

  const held = onShelf()
  return (ref) => held.get(ref.id) ?? remote.get(ref.id)
}
