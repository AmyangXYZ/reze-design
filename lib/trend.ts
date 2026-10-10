// Trending: recent attention. Every event — the publish itself, a like, and
// for a preset, another person publishing a scene that wears it — starts at
// weight 1 and halves every TREND_HALF_LIFE. An item's score is the sum.
//
// Kept as log2 of the weights measured against a FIXED epoch, so the score is
// a constant between events: every weight decays at the same rate, the order
// only changes when something happens, and the caches that hold the score stay
// right until the write that refreshes them.

export const TREND_EPOCH = Date.parse("2026-01-01T00:00:00Z")
export const TREND_HALF_LIFE = 14 * 86_400_000

/** One event's log2 weight. */
export const trendUnits = (t: number) => (t - TREND_EPOCH) / TREND_HALF_LIFE

/** log2 of the summed weights of events at these times (ms). */
export function trendScore(times: number[]): number {
  if (times.length === 0) return -Infinity
  const units = times.map(trendUnits)
  const top = Math.max(...units)
  return top + Math.log2(units.reduce((s, u) => s + 2 ** (u - top), 0))
}

/**
 * What a new scene wears without anyone choosing it: the demo scene's grade
 * and effects (lib/default-scene.ts) and the default look pack's graphs
 * (DEFAULT_LOOK in lib/look-pref.ts). Their uses measure the defaults, so they
 * are not counted as picks.
 */
export const DEFAULT_LOOKS = {
  grade: new Set(["Neutral"]),
  effect: new Set(["Floating Stars", "Hand Sparks", "Lyrics"]),
  graphTag: "aether-gazer",
}

export function isDefaultLook(kind: string, name: string, tags: string[]): boolean {
  if (kind === "grade") return DEFAULT_LOOKS.grade.has(name)
  if (kind === "effect") return DEFAULT_LOOKS.effect.has(name)
  if (kind === "graph") return tags.includes(DEFAULT_LOOKS.graphTag)
  return false
}
