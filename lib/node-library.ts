// The node-graph library: packs of reusable material looks. A graph is tagged by
// the roles it suits, but never locked to one — applying retargets it to the
// slot being edited (see the graph editor's import path). The built-ins ship as
// one official pack; user/community packs slot in later with the same shape.

import type { MaterialPreset, StyleGraph } from "reze-engine"
import { SLOT_GRAPHS, SLOT_LABELS } from "@/lib/materials"

export type LibraryEntry = {
  id: string
  name: string
  /** Author's notes: what this graph is for, how it's tuned, when to reach for it. */
  description: string
  /** Roles this look is designed for (drives filtering + "recommended"). */
  tags: MaterialPreset[]
  author: string
  /** ISO-ish date for the "created" column. */
  created: string
  graph: StyleGraph
}

// Author notes per built-in look — shown in the library detail panel.
const ROLE_NOTES: Partial<Record<MaterialPreset, string>> = {
  hair: "Anisotropic hair with soft NPR shadow banding and a warm rim light. Tune the ramp for sharper or softer cel steps.",
  body: "Gentle skin shading — a soft diffuse ramp that keeps shadow terminators smooth and avoids muddy occlusion.",
  face: "Face-specific ramp tuned to suppress harsh nose and brow shadows while keeping a clean cheek gradient.",
  eye: "Bright, saturated iris. Pairs with the Eye render class so eyes read cleanly through overlapping hair.",
  cloth_smooth: "Smooth fabric with a tight, clean specular sheen — good for satin, leather, and coated surfaces.",
  cloth_rough: "Matte fabric: broad diffuse, minimal spec. Reach for cotton, wool, and other non-shiny cloth.",
  stockings: "Semi-sheer weave using hashed alpha for a stable see-through look at grazing angles.",
  metal: "Sharp anisotropic metal highlights with a darkened base for jewelry and hardware.",
  default: "Neutral fallback shading — a sensible starting point for anything without a dedicated look.",
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
    description: ROLE_NOTES[role] ?? "",
    tags: [role],
    author: "Amyang",
    created: "2026-07-22",
    graph: SLOT_GRAPHS[role] as StyleGraph,
  })),
}

export const LIBRARY_PACKS: LibraryPack[] = [AETHER_GAZER]

/** Flat list of every entry across packs (for search / grid). */
export const ALL_LIBRARY_ENTRIES: LibraryEntry[] = LIBRARY_PACKS.flatMap((p) => p.entries)
