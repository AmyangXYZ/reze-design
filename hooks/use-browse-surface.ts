"use client"

// Which browse surface is open: a shader-graph library, a grade library, an
// effect library, or the scene gallery.
//
// These were four independent booleans plus a groupId, and every opener had to
// remember to clear the other three — `showLibrary` cleared two and the gallery,
// `showGrades` cleared two and the gallery, and so on. Nothing enforced it, so a
// fifth surface would have silently opened on top of a fourth.
//
// One nullable union instead. Mutual exclusion is structural: there is exactly
// one slot, so opening anything closes whatever was there. That is also the tab
// state for folding the three libraries into a single dialog — the facet travels
// with the surface rather than beside it.
//
// The gallery is deliberately in the same slot even though it will not be a tab:
// it is still a full-window browse surface, and having it open behind a library
// was never wanted.

import { useCallback, useState } from "react"
import type { LibraryFacet } from "@/lib/library"

export type BrowseSurface =
  /** Shader graphs. `groupId` is the style group a pick applies to, or null when
   *  opened for browsing rather than for a specific group. */
  | { kind: "graph"; groupId: string | null }
  | { kind: "grade" }
  | { kind: "effect" }
  | { kind: "gallery" }

export type BrowseKind = BrowseSurface["kind"]

export function useBrowseSurface() {
  const [browse, setBrowse] = useState<BrowseSurface | null>(null)
  const [facet, setFacet] = useState<LibraryFacet>("all")

  // Deliberately effect-free: which surface is open is all this owns. Anything a
  // particular surface needs done first — the grade library snapshots the
  // viewport to preview against — stays at its own call site, where it is
  // visible, rather than becoming a hook option every opener silently triggers.
  const open = useCallback((surface: BrowseSurface, nextFacet: LibraryFacet = "all") => {
    setFacet(nextFacet)
    setBrowse(surface)
  }, [])

  const close = useCallback(() => setBrowse(null), [])

  /** Close only if `kind` is what is currently open — so a stale onOpenChange
   *  from a surface that already lost the slot cannot close its replacement. */
  const closeIf = useCallback(
    (kind: BrowseKind) => setBrowse((s) => (s?.kind === kind ? null : s)),
    [],
  )

  return {
    browse,
    facet,
    setFacet,
    open,
    close,
    closeIf,
    // Derived views, so call sites read as what they are asking about.
    graphLibrary: browse?.kind === "graph" ? browse : null,
    gradesOpen: browse?.kind === "grade",
    effectsOpen: browse?.kind === "effect",
    galleryOpen: browse?.kind === "gallery",
  }
}
