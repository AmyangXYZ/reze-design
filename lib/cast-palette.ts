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

export type CastPaletteId = "violet" | "rose" | "amber" | "green" | "teal" | "sky" | "blue" | "silver" | "slate"

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
   * TWO neutrals, because colourless spans white to black and one swatch cannot
   * say both — a white-dressed character behind a dark grey square reads as
   * mislabelled, and a black one has nothing darker left to claim. Silver is
   * the light absence, slate the dark one; extraction picks by which side of
   * mid-lightness holds more colourless mass.
   *
   * Both far duller than every colour, on purpose: brightness without chroma
   * does not compete with an identity, saturation does — so the neutrals may
   * bracket the colours in lightness but must never approach them in chroma.
   */
  { id: "silver", from: "#e2e8f0", to: "#94a3b8", hue: null },
  { id: "slate", from: "#475569", to: "#1e293b", hue: null },
]

const byId = new Map(CAST_PALETTES.map((p) => [p.id, p]))

export function castPalette(id: CastPaletteId | undefined): CastPalette {
  return (id && byId.get(id)) ?? byId.get("slate")!
}

/** What a model gets when its textures carry no identifying colour. */
export const NEUTRAL_PALETTE: CastPaletteId = "slate"
