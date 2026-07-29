// The one shape every library item wears — grades, shader graphs, background
// effects — so builtin and user-made content are the same thing with a different
// author, not two parallel systems.
//
// Split by what it has to survive:
//   ENVELOPE + PAYLOAD travel inside scene documents (we snapshot user content so
//     a published scene can't change under someone), so this shape is frozen once
//     scenes are in the wild.
//   Server-side columns — owner_id, like_count, visibility, timestamps, license,
//     moderation status — never leave the database and can be added freely.
//
// Builtins live in content/*.json and ship with the bundle; the database will
// hold only community items. Their ids can't collide (builtin ids are
// hand-written, user ids server-generated), so the two merge at runtime with no
// seeding step and no dedup — and a clone with no database still has a library.

import type { MaterialPreset, ShaderGraph } from "reze-engine"
import type { GradeSpec } from "@/lib/grade"
import type { SceneDoc } from "@/lib/scene"

// A published SCENE is a library item too — same envelope, same table, same
// permissions, and the gallery is just a facet query. Scenes ship no built-ins,
// so `content/` has no scenes.json; the kind exists so the server side is one
// shape rather than two.
export type LibraryKind = "grade" | "graph" | "effect" | "scene"

/** Nested rather than flat so a kind can grow a second field (a grade gaining a
 *  LUT, say) without touching the envelope. */
export type GradePayload = { spec: GradeSpec }
export type GraphPayload = {
  graph: ShaderGraph
  /** Slot this graph is the built-in default for. Absent on contributed graphs,
   *  which are applied to a group by hand. */
  role?: MaterialPreset
}
export type EffectPayload = { wgsl: string }
export type ScenePayload = { doc: SceneDoc }

export type LibraryItem<K extends LibraryKind = LibraryKind, P = unknown> = {
  id: string
  kind: K
  /** Canonical (English) name. The UI prefers a localized override when one
   *  exists for this id — community items simply have none. */
  name: string
  /** Display name, denormalized so a snapshot needs no join to render. */
  author: string
  description: string
  tags: string[]
  /** Bumped on edit. Distinct from SCENE_FORMAT_VERSION, which versions the
   *  document schema rather than this item's content. */
  version: number
  owner: LibraryOwner
  payload: P
}

export type LibraryOwner = "builtin" | "user"

export type GradeItem = LibraryItem<"grade", GradePayload>
export type GraphItem = LibraryItem<"graph", GraphPayload>
export type EffectItem = LibraryItem<"effect", EffectPayload>
export type SceneItem = LibraryItem<"scene", ScenePayload>

/** Rail facets are about PROVENANCE, not taxonomy: a short list that never grows,
 *  where tags are many and overlapping and belong in search instead. `community`
 *  and `liked` arrive with the server. */
export type LibraryFacet = "all" | "featured" | "yours"

export const LIBRARY_FACETS: LibraryFacet[] = ["all", "featured", "yours"]

export function matchesFacet(item: LibraryItem, facet: LibraryFacet): boolean {
  if (facet === "all") return true
  if (facet === "featured") return item.owner === "builtin"
  return item.owner === "user"
}

/** Name · author · tags, all case-insensitive. */
export function matchesQuery(item: LibraryItem, query: string, displayName = item.name): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    displayName.toLowerCase().includes(q) ||
    item.author.toLowerCase().includes(q) ||
    item.tags.some((t) => t.toLowerCase().includes(q))
  )
}

/** Stamp repo content as builtin at load — the JSON files stay lean. */
export function asBuiltins<T extends LibraryItem>(items: Omit<T, "owner">[]): T[] {
  return items.map((i) => ({ ...i, owner: "builtin" }) as T)
}
