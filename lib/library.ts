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
// EVERY item has a permanent uuid, and it is the only identity that matters.
// Built-ins carry theirs in content/*.json (authored once, never regenerated —
// otherwise a reseed would orphan every like and usage stat pointing at one);
// drafts mint one at creation and keep it through publishing, so a preset is the
// same entity before and after it becomes public. Names are display only: they
// are unique per author for that author's sanity, and they can change freely.

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
  /** Permanent uuid. Never shown to users, never reused, never changes — a
   *  renamed, republished or forked item keeps it. */
  id: string
  kind: K
  /** Display name — unique per author, and free to change. The UI prefers a
   *  localized override when one exists; community items simply have none. */
  name: string
  /** Display name, denormalized so a snapshot needs no join to render. */
  author: string
  description: string
  tags: string[]
  owner: LibraryOwner
  payload: P
}

/** `local` is an unpublished draft, held in localStorage — see lib/drafts.ts. */
export type LibraryOwner = "builtin" | "user" | "local"

/** Client-side flag on community rows: the signed-in user's own published work.
 *  Never stored — it depends on who is asking. */
export type MaybeMine = { mine?: boolean }

export type GradeItem = LibraryItem<"grade", GradePayload>
export type GraphItem = LibraryItem<"graph", GraphPayload>
export type EffectItem = LibraryItem<"effect", EffectPayload>
export type SceneItem = LibraryItem<"scene", ScenePayload>

// ── Names ────────────────────────────────────────────────────────────────────
// The name is the human key, and the editor resolves by it: the quick switch
// matches a group to a library row by name, and applying one looks it up by
// name. Two rows answering to the same name therefore aren't a cosmetic clash —
// one of them becomes unreachable, and which one you get is list order.
//
// So a name is compared by MEANING, not by bytes: "Neon Hair", "neon hair" and
// "Neon  Hair" are one name, and only one thing may hold it.

/** What a typed name becomes: trimmed, inner whitespace collapsed. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ")
}

/** The comparison form — case and spacing folded away. */
export function nameKey(raw: string): string {
  return normalizeName(raw).toLowerCase()
}

/** The existing name `wanted` would collide with, if any. Returned rather than a
 *  boolean so the refusal can name what is already there. */
export function conflictingName(wanted: string, taken: Iterable<string>): string | undefined {
  const key = nameKey(wanted)
  for (const name of taken) if (nameKey(name) === key) return name
  return undefined
}

/**
 * Put the item's name inside a graph payload, where a ShaderGraph carries one of
 * its own.
 *
 * Two names for one thing, and the row's is the real one: it is what the library
 * lists, what the quick switch matches a group against, and what the publish
 * dialog asks for. The payload's copy came from whatever the draft was called,
 * so publishing "Hair 2 17" as "3D质感头发" left a scene wearing a look named
 * after the draft — selected in the quick switch, findable in no library.
 *
 * Applied wherever the row's name is decided (publish, rename) and again when a
 * pin resolves, so rows written before this stay right too.
 */
export function withGraphName<T>(payload: T, name: string): T {
  const p = payload as { graph?: { name?: string } } | null
  if (!p || typeof p !== "object" || !p.graph || typeof p.graph !== "object") return payload
  return { ...p, graph: { ...p.graph, name } } as T
}

/** Rail facets are about PROVENANCE, not taxonomy: a short list that never grows,
 *  where tags are many and overlapping and belong in search instead. `community`
 *  and `liked` arrive with the server. */
export type LibraryFacet = "all" | "builtin" | "yours" | "liked"

export const LIBRARY_FACETS: LibraryFacet[] = ["all", "builtin", "yours", "liked"]

export function matchesFacet(item: LibraryItem & MaybeMine, facet: LibraryFacet, liked?: boolean): boolean {
  if (facet === "all") return true
  // Named for what it does. It always filtered to built-ins; calling that
  // "Featured" promised a curation nobody was doing.
  if (facet === "builtin") return item.owner === "builtin"
  // Liked depends on who is asking, so it is passed in rather than read off the item.
  if (facet === "liked") return liked === true
  // "Yours" means yours — drafts AND your published rows, not everyone's
  // community items. Splitting drafts into their own facet made "Yours" exclude
  // work in progress, which reads as a bug.
  return item.owner === "local" || item.mine === true
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
  if (process.env.NODE_ENV !== "production") {
    for (const key of ["id", "name"] as const) {
      const dupes = items.map((i) => i[key]).filter((v, x, a) => a.indexOf(v) !== x)
      if (dupes.length) throw new Error(`duplicate builtin ${key}: ${dupes.join(", ")}`)
    }
  }
  return items.map((i) => ({ ...i, owner: "builtin" }) as T)
}

/**
 * What belongs in a quick-switch list, as opposed to the full library.
 *
 * All the built-ins — they're curated, few, and the reason presets exist — plus
 * your most recent drafts, since work in progress is the likeliest next pick. The
 * applied item is always present even if it would otherwise be cut, because a
 * selector that can't show what's selected is broken. Everything else is a click
 * away behind "Browse all…", which is what that escape hatch is for.
 */
export function quickPickItems<T extends LibraryItem>(
  builtins: T[],
  drafts: T[],
  appliedId: string | null,
  maxDrafts = 4,
): T[] {
  // Built-ins lead (name order — content file order), drafts follow in creation
  // order, so a new draft appears at the end rather than reshuffling the list.
  const list = [...builtins, ...drafts.slice(-maxDrafts)]
  if (appliedId && !list.some((i) => i.id === appliedId)) {
    const applied = drafts.find((i) => i.id === appliedId)
    if (applied) list.push(applied)
  }
  return list
}

/**
 * Community rows for a quick-pick: all of them, newest first.
 *
 * Cut to three at first, on the theory that nobody recognises these names so
 * only the recent work is worth showing. But three is not a list you browse —
 * it is a teaser for the full library, and it put a dialog between someone and
 * every published look past the newest few. The section scrolls, so the cut
 * bought nothing that the scrollbar does not.
 */
export function communityQuickPickItems<T extends LibraryItem>(
  items: T[],
): { id: string; label: string; section: "community" }[] {
  return items.map((i) => ({ id: i.name, label: i.name, section: "community" as const }))
}
