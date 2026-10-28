// Format 1 → 2: a scene document as format 2 states it.
//
// Format 1 wrote neither model ids nor group ids, and kept a group's pass in a
// `role` that held hair, eye and hashed alpha and nothing else. A reader minted
// the ids from filenames and labels, in document order — which is what every
// format-1 scene has been opening with, so it is what the upgrade writes:
//
//   - each model's id: modelKey over its file, in document order;
//   - each group's id: a slug of its label (its role where it has none), deduped
//     within the model;
//   - `role` → renderClass hair / eye, or alphaMode hashed;
//   - the blend a format-1 writer dropped, where the group's own graph states
//     it: Glass's premultiplied (LOOK_STATE), and the additive light a glTF
//     stage's light sheets, fresnel glows and additive effect sheets are
//     (lib/gltf-stage.ts builds those graphs, and names and tags them so).
//
// Run where a format-1 document can still arrive: a file someone exported, and
// this browser's own working scene. Published scenes are upgraded in the
// database (scripts/db-patch-scene-ids.ts), through this same module.

import type { ShaderGraph, StyleGroup } from "reze-engine"
import { LOOK_STATE } from "@/lib/stage-style"
import { isItemRef, modelKey, type SceneAssetsDoc, type SceneDoc, type StyleGroupDoc } from "@/lib/scene"

type V1Group = Omit<StyleGroupDoc, "id"> & { id?: string; role?: "hair" | "eye" | "stockings" }
type V1Model = Omit<SceneAssetsDoc["models"][number], "id" | "materials"> & {
  id?: string
  materials?: { groups: V1Group[]; hidden?: string[] }
}
type V1Assets = Omit<SceneAssetsDoc, "models"> & { models: V1Model[] }
export type V1SceneDoc = Omit<SceneDoc, "assets"> & { assets: V1Assets }

const ROLE_FIELDS = {
  hair: { renderClass: "hair" },
  eye: { renderClass: "eye" },
  stockings: { alphaMode: "hashed" },
} as const satisfies Record<string, Pick<StyleGroup, "renderClass" | "alphaMode">>

/** The blend a group's graph states, which a format-1 document did not carry. */
function graphBlend(label: string | undefined, graph: V1Group["graph"]): StyleGroup["blend"] {
  const name = typeof graph === "string" ? graph : isItemRef(graph) ? undefined : graph.name
  // A look the auto-styler labels with its own name: pinned, or inline by name.
  if (label && label in LOOK_STATE && (isItemRef(graph) || name === label)) return LOOK_STATE[label]!.blend
  if (typeof graph !== "object" || isItemRef(graph)) return undefined
  const g = graph as ShaderGraph & { opacity?: unknown }
  if (!g.tags?.includes("effect") || !g.tags.includes("stage")) return undefined
  if (name?.startsWith("Stage Light Sheet ") || name?.startsWith("Glow ")) return "additive"
  if (name?.startsWith("Effect ") && g.opacity === undefined) return "additive"
  return undefined
}

function upgradeGroups(groups: V1Group[]): StyleGroupDoc[] {
  const ids = new Set<string>()
  return groups.map(({ role, ...g }) => {
    const base = (g.label ?? role ?? "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "group"
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)
    const blend = graphBlend(g.label, g.graph)
    return { ...g, id, ...(role ? ROLE_FIELDS[role] : {}), ...(blend && blend !== "over" ? { blend } : {}) }
  })
}

/** A format-1 assets record with its model ids. Groups are not part of it. */
export function upgradeAssetsDoc(assets: V1Assets): SceneAssetsDoc {
  const ids: string[] = []
  return {
    ...assets,
    models: assets.models.map(({ materials, ...m }) => {
      const id = modelKey(m.model, ids)
      ids.push(id)
      return { ...m, id, ...(materials ? { materials: { ...materials, groups: upgradeGroups(materials.groups) } } : {}) }
    }),
  }
}

/** A scene document in the current format. Format 2 comes back as it is. */
export function upgradeSceneDoc(doc: V1SceneDoc | SceneDoc): SceneDoc {
  if (doc.version >= 2) return doc as SceneDoc
  return { ...doc, version: 2, assets: upgradeAssetsDoc(doc.assets as V1Assets) }
}
