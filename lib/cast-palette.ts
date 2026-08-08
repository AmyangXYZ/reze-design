// Swatch gradients for the cast list.
//
// A small fixed set, not a colour computed per model. Seventeen Tailwind
// families were tried and were worse: near-identical characters landed a family
// apart, and the odd hues between the good ones looked like mistakes. Six plus a
// neutral is enough to tell a cast apart, and every one is a colour somebody
// chose.
//
// Each runs 400 into 600 within one family: vivid at BOTH ends, so the square
// reads as its colour rather than as a value. 300→800 was tried and inverted the
// scale — rose ended at #9f1239 while slate began at #cbd5e1, so a red-dressed
// character came out darker than a black-dressed one. A colour has to look like
// that colour, and the neutral has to stay the darkest thing in the list.
//
// Two different hues in one square was tried too; it made every swatch busy and
// the list incoherent, which is the opposite of what an identity mark is for.

export type CastPaletteId = "violet" | "rose" | "amber" | "green" | "teal" | "sky" | "blue" | "slate"

export type CastPalette = {
  id: CastPaletteId
  /** The bright end, top-left. */
  from: string
  /** The saturated end, bottom-right — what the swatch actually reads as. */
  to: string
  /** Representative hue, for nearest-match. Null = not a hue at all. */
  hue: number | null
}

export const CAST_PALETTES: CastPalette[] = [
  { id: "rose", from: "#fb7185", to: "#e11d48", hue: 350 },
  { id: "amber", from: "#fbbf24", to: "#d97706", hue: 40 },
  { id: "green", from: "#4ade80", to: "#16a34a", hue: 140 },
  { id: "teal", from: "#2dd4bf", to: "#0d9488", hue: 175 },
  { id: "sky", from: "#38bdf8", to: "#0284c7", hue: 198 },
  /** Sky and violet sat 60° apart, so navy and indigo — among the commonest
   *  costume colours there are — landed on a coin flip between a cyan and a
   *  purple, and neither reads as the dress. */
  { id: "blue", from: "#60a5fa", to: "#2563eb", hue: 228 },
  { id: "violet", from: "#a78bfa", to: "#7c3aed", hue: 268 },
  /**
   * For characters with no colour of their own — white, silver, black. Forcing
   * one into a hue means reporting a faint tint as an identity, which is how a
   * white dress came out blue.
   *
   * A step darker and far duller than the rest, on purpose: it stands for the
   * absence of colour, so it must never out-brighten one.
   */
  { id: "slate", from: "#64748b", to: "#334155", hue: null },
]

const byId = new Map(CAST_PALETTES.map((p) => [p.id, p]))

export function castPalette(id: CastPaletteId | undefined): CastPalette {
  return (id && byId.get(id)) ?? byId.get("slate")!
}

/** Nearest palette to a hue, on the circle — 350° and 10° are neighbours. */
export function paletteForHue(hue: number): CastPalette {
  const h = ((hue % 360) + 360) % 360
  const hued = CAST_PALETTES.filter((p): p is CastPalette & { hue: number } => p.hue !== null)
  return hued.reduce((best, p) => {
    const d = (x: { hue: number }) => Math.min(Math.abs(h - x.hue), 360 - Math.abs(h - x.hue))
    return d(p) < d(best) ? p : best
  })
}

/** What a model gets when its textures carry no identifying colour. */
export const NEUTRAL_PALETTE: CastPaletteId = "slate"
