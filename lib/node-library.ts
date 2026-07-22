// The node-graph library: packs of reusable material looks. A graph is tagged by
// the roles it suits, but never locked to one — applying retargets it to the
// slot being edited (see the graph editor's import path). The built-ins ship as
// one official pack; user/community packs slot in later with the same shape.

import type { MaterialPreset, StyleGraph } from "reze-engine"
import { SLOT_GRAPHS, SLOT_LABELS } from "@/lib/materials"

export type LibraryEntry = {
  id: string
  name: string
  /** Roles this look is designed for (drives filtering + "recommended"). */
  tags: MaterialPreset[]
  author: string
  /** ISO-ish date for the "created" column. */
  created: string
  graph: StyleGraph
}

export type LibraryPack = {
  id: string
  name: string
  author: string
  description: string
  entries: LibraryEntry[]
}

// The official pack — Aether-Gazer-style NPR looks, one entry per built-in graph.
const AETHER_GAZER: LibraryPack = {
  id: "aether-gazer",
  name: "仿深空之眼 Aether-Gazer",
  author: "Amyang",
  description: "Aether-Gazer-style anime/NPR looks — one per material kind, editable and remixable.",
  entries: (Object.keys(SLOT_GRAPHS) as MaterialPreset[]).map((role) => ({
    id: `aether-gazer-${role}`,
    name: SLOT_LABELS[role],
    tags: [role],
    author: "Amyang",
    created: "2026-07-22",
    graph: SLOT_GRAPHS[role] as StyleGraph,
  })),
}

export const LIBRARY_PACKS: LibraryPack[] = [AETHER_GAZER]

/** Flat list of every entry across packs (for search / grid). */
export const ALL_LIBRARY_ENTRIES: LibraryEntry[] = LIBRARY_PACKS.flatMap((p) => p.entries)
