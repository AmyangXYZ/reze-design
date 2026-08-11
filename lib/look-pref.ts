import { LOOK_PACK_ORDER, type LookPack } from "@/lib/materials"

// Which rendering style this browser prefers.
//
// A preference, not scene state: the scene document already carries the graphs
// and the transform a style applied, so a saved scene reopens exactly as it was
// whatever this says. What this answers is the other question — what a model you
// load NEXT should be styled as, so bringing in a second character does not dress
// it in a style you switched away from an hour ago.
//
// Aether Gazer by default, because that is what the engine's own auto-grouping
// fills a fresh model with; anything else would mean a first-time scene disagreed
// with the presets it shipped with.
const KEY = "reze-design.look"
export const DEFAULT_LOOK: LookPack = "ag"

export function loadLookPref(): LookPack {
  if (typeof window === "undefined") return DEFAULT_LOOK
  try {
    const raw = window.localStorage.getItem(KEY)
    return LOOK_PACK_ORDER.includes(raw as LookPack) ? (raw as LookPack) : DEFAULT_LOOK
  } catch {
    return DEFAULT_LOOK
  }
}

export function saveLookPref(pack: LookPack): void {
  try {
    window.localStorage.setItem(KEY, pack)
  } catch {
    // Non-fatal: the choice still applies to this session.
  }
}
