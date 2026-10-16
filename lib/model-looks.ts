// A model's looks, saved in this browser for the next time it is uploaded.
//
// The Materials dock saves a model's style groups here (IndexedDB, through
// lib/asset-store), and every path that would auto-style that model takes these
// instead (autoStyleOnEngine, and a stage upload).
//
// A model is recognised by its MATERIALS: each one's name and vertex count, in
// order. That is what the groups are written against, it survives a renamed
// file or zip, and it changes when the mesh does.

import type { Model, StyleGroup } from "reze-engine"
import { sameGraphLook } from "@/lib/materials"

export function modelLooksKey(model: Pick<Model, "getMaterials">): string | null {
  const materials = model.getMaterials()
  if (!materials.length) return null
  // FNV-1a over the list, two 32-bit lanes: a short key for a list that can
  // run to hundreds of materials.
  const text = materials.map((m) => `${m.name}\u0000${m.vertexCount}`).join("\u0001")
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  return `v1:${materials.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

/** What is saved: the groups that hold materials. The empty drop targets are
 *  reseeded on load (withSpecialGroups). */
export function savableLooks(groups: StyleGroup[]): StyleGroup[] {
  return groups.filter((g) => g.materials.length > 0)
}

/** Saved groups fitted to the model they are applied to. */
export function fitLooks(saved: StyleGroup[], model: Pick<Model, "getMaterials">): StyleGroup[] {
  const names = new Set(model.getMaterials().map((m) => m.name))
  return saved.map((g) => ({ ...g, materials: g.materials.filter((n) => names.has(n)) })).filter((g) => g.materials.length > 0)
}

/** Whether `groups` are the saved looks: the same materials together, wearing
 *  the same look the same way. */
export function sameLooks(saved: StyleGroup[], groups: StyleGroup[]): boolean {
  const live = savableLooks(groups)
  if (live.length !== saved.length) return false
  const members = (g: StyleGroup) => [...g.materials].sort().join("\u0000")
  const byMembers = new Map(saved.map((g) => [members(g), g]))
  return live.every((g) => {
    const s = byMembers.get(members(g))
    return (
      !!s &&
      (s.label ?? s.id) === (g.label ?? g.id) &&
      (s.renderClass ?? "auto") === (g.renderClass ?? "auto") &&
      (s.alphaMode ?? "opaque") === (g.alphaMode ?? "opaque") &&
      (s.blend ?? "over") === (g.blend ?? "over") &&
      sameGraphLook(s.graph, g.graph)
    )
  })
}
