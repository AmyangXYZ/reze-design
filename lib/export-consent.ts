// Whether this browser reports what an export was made OF.
//
// Off until someone turns it on. Exporting is the one thing this app does that
// never touches the network — the render, the encode and the file all happen on
// the user's machine — so a report about it is a favour, asked for and granted,
// never a default.
//
// NOT under storageKey(). That scheme bakes STORAGE_VERSION into the key so a
// new build simply stops seeing what an old one wrote, which is right for scene
// documents and wrong for this: a release would silently revoke every consent
// on file and the numbers would die with no cause to find.
const KEY = "reze-design.export-stats-consent"

/**
 * What the answer was given ABOUT.
 *
 * A yes recorded today covers today's list — resolution, aspect, model files,
 * effects, graphs, grade, look. Widening that list means asking again, so bump
 * this and a stored answer from before the change reads as no. The whole point
 * of keeping the flag forever is that it keeps meaning what it meant.
 */
const CONSENT_VERSION = 1

type Stored = { v: number; on: boolean }

// Read once and remembered, because useSyncExternalStore asks on every render and
// a JSON.parse per frame of an export is a silly way to answer a question whose
// answer only changes when someone flips the switch.
let cached: boolean | null = null
const listeners = new Set<() => void>()

/**
 * Every path that is not a stored, current, affirmative yes reads as no: a
 * private window, cleared site data, a browser that throws on the accessor, a
 * half-written value, an answer given about an older list. Failing closed is
 * the only failure mode a consent flag is allowed to have.
 */
export function exportStatsAllowed(): boolean {
  if (typeof window === "undefined") return false
  if (cached !== null) return cached
  try {
    const raw = window.localStorage.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as Partial<Stored>) : null
    cached = s?.v === CONSENT_VERSION && s.on === true
  } catch {
    cached = false
  }
  return cached
}

export function setExportStatsAllowed(on: boolean): void {
  cached = on
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: CONSENT_VERSION, on } satisfies Stored))
  } catch {
    // Storage blocked. The switch still reads on for this session; the next one
    // starts from off, which is the safe direction for it to drift.
  }
  for (const l of listeners) l()
}

export function subscribeExportStats(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** What the SERVER renders. Off, always — so the markup React sends and the
 *  markup it hydrates agree, and the one value painted before anybody has read
 *  this browser's answer is the safe one. */
export const exportStatsServerSnapshot = (): boolean => false
