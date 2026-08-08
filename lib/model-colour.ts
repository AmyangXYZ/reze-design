// Pick a model's identity colour out of its textures.
//
// Android's Palette API (and its JS port, Vibrant.js): quantize the pixels, then
// SCORE each bucket rather than take the biggest one —
//
//     score = w_sat · closeness(chroma,    target)
//           + w_lum · closeness(luminance, target)
//           + w_pop · (population / largest population)
//
// with hard bounds outside which a bucket cannot win at all. Android weights
// luminance highest (6), then saturation (3), then population (1), and targets
// MID luminance with HIGH saturation — the colour a designer would pick to stand
// for the image.
//
// Two hand-rolled attempts came before this and both failed in ways scoring does
// not:
//
//   - skin was blacklisted by hue and lightness, so RED AND PINK CLOTHING was
//     blacklisted with it. They occupy the same region of colour space and no
//     filter separates them. Scoring never has to.
//   - buckets were hue-only, discarding the saturation and luminance that decide
//     whether a hue means anything at all. A white dress with a lilac cast
//     scored as confidently blue as a genuinely blue one.
//
// KNOWN GAP: a white or very light garment still resolves to the hue of its
// shadows, because anime texture work paints white fabric with blue-violet
// shading and the near-white body of the garment is ruled out as colourless
// before the shadows are scored. Two attempts at fixing it (a minimum chromatic
// share, and replacing scoring with largest-family-wins) each broke a case this
// version gets right, so the gap stands rather than trading it for a worse one.

/** One coloured part of a model, and how much of the character it covers. */
export type TextureSource = {
  /** Null for a material with no texture: then the tint IS the colour. */
  src: string | Blob | null
  /** The material's diffuse, 0..1 per channel — multiplied into every texel.
   *  MMD routinely ships a white sheet and puts the colour here. */
  tint: [number, number, number]
  /** Vertices of every material using it — a proxy for mesh area. */
  weight: number
}

const SAMPLE = 48

// Buckets in HSL, not RGB. Android runs median-cut to merge its pixels down to
// roughly sixteen swatches; raw RGB buckets skip that merge, and a texture's
// baked-in shading then scatters ONE dye job across dozens of them so no single
// bucket is ever a meaningful share of the model. Banding hue coarsely and
// chroma/luminance very coarsely does the same job directly: every shade of the
// same dress lands together, while the dress and its trim stay apart.
const HUE_BANDS = 24 // 15° each
/** Chroma and lightness bands. */
const SL_BANDS = 4

// Android's targets, tried in order. Palette does not return nothing when
// VIBRANT finds nothing; it falls through to the darker, lighter and duller
// profiles, and only a genuinely colourless image exhausts them. Running VIBRANT
// alone is why navy, wine and dusty costumes all came back neutral: real MMD
// diffuse maps are unlit base art and sit well below mid luminance far more
// often than photographs do.
//
// DARK before LIGHT deliberately. A costume that misses the vibrant band is much
// more often deep (navy, wine, near-black with a tint) than pale, and the light
// band is exactly where skin lives — so trying it first would hand every model
// whose skin materials went unrecognised the same warm beige it kept producing.
const W_SAT = 3
const W_LUM = 6
const W_POP = 1

type Target = {
  name: string
  /** Bounds on CHROMA, not HSL saturation — see rgbToHcl. */
  sat: [min: number, target: number, max: number]
  lum: [min: number, target: number, max: number]
}

const TARGETS: Target[] = [
  { name: "vibrant", sat: [0.35, 1, 1], lum: [0.3, 0.5, 0.7] },
  { name: "dark vibrant", sat: [0.35, 1, 1], lum: [0, 0.26, 0.45] },
  // A higher floor than the others, because a tint genuinely IS less colourful
  // than the same hue at mid lightness — pastels read as "pale" before they read
  // as their hue. At 0.35 a very light blue dress earned the same confident blue
  // square as a navy one; the margin is what separates "blue dress" from "white
  // dress with a cool cast", which no amount of hue precision can.
  { name: "light vibrant", sat: [0.45, 1, 1], lum: [0.55, 0.74, 1] },
  // Muted keeps a chroma FLOOR, which Android's does not: without one a white or
  // silver costume matches on some near-grey bucket and reports its rounding
  // error as an identity. Colourless has to stay an available answer.
  { name: "muted", sat: [0.2, 0.3, 0.5], lum: [0.25, 0.5, 0.75] },
]

/** A winner has to be a real part of the model, not one bright pixel. */
const MIN_POPULATION_SHARE = 0.02

/**
 * Hue, CHROMA and lightness.
 *
 * The middle term is HSV saturation — (max − min) / max — and it is the one
 * thing here that departs from Android. HSL saturation divides by a denominator
 * that collapses as lightness approaches 1, so rgb(200 210 230) — a white with
 * the faintest cool cast — reports 0.38 and clears a 0.35 floor as a confident
 * light blue. Chroma calls that pixel 0.13, which is what it looks like. Anime
 * textures are largely near-white; the photographs Android was tuned against are
 * not, so the flaw never had to surface there.
 *
 * Lightness stays HSL's, since the luminance targets are calibrated against it.
 */
function rgbToHcl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, d / max, l]
}

async function bitmapOf(src: string | Blob): Promise<ImageBitmap | null> {
  try {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

/** 1 at the target, falling toward 0 with distance. Android's invertDiff. */
const closeness = (value: number, target: number) => 1 - Math.abs(value - target)

/**
 * The hue that best represents this model, or null when nothing qualifies.
 *
 * Null is a real answer: a white, black or silver character has no colour, and
 * the caller shows the neutral rather than inventing one.
 */
export async function dominantHue(sources: TextureSource[]): Promise<number | null> {
  if (typeof document === "undefined" || sources.length === 0) return null
  const canvas = document.createElement("canvas")
  canvas.width = SAMPLE
  canvas.height = SAMPLE
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null

  // Per bucket: population, plus running sums so the representative colour is
  // the mean of what actually landed there rather than the band's midpoint.
  const bucket = new Map<number, { pop: number; h: number; s: number; l: number }>()
  let total = 0

  const add = (h: number, chroma: number, lum: number, weight: number) => {
    total += weight
    const key =
      (Math.min(HUE_BANDS - 1, Math.floor(h / (360 / HUE_BANDS))) * SL_BANDS +
        Math.min(SL_BANDS - 1, Math.floor(chroma * SL_BANDS))) *
        SL_BANDS +
      Math.min(SL_BANDS - 1, Math.floor(lum * SL_BANDS))
    const b = bucket.get(key)
    if (b) {
      b.pop += weight
      b.h += h * weight
      b.s += chroma * weight
      b.l += lum * weight
    } else {
      bucket.set(key, {
        pop: weight,
        h: h * weight,
        s: chroma * weight,
        l: lum * weight,
      })
    }
  }

  for (const { src, tint, weight } of sources) {
    // No texture: the diffuse is the whole material. Counted at the same scale a
    // sheet contributes, so a flat-coloured cape weighs against a printed one.
    if (src === null) {
      const [h, chroma, lum] = rgbToHcl(tint[0] * 255, tint[1] * 255, tint[2] * 255)
      add(h, chroma, lum, weight * SAMPLE * SAMPLE)
      continue
    }
    const bmp = await bitmapOf(src)
    if (!bmp) continue
    // Middle 60%: edges are UV padding and transparent margin.
    const inset = 0.2
    ctx.clearRect(0, 0, SAMPLE, SAMPLE)
    ctx.drawImage(
      bmp,
      bmp.width * inset,
      bmp.height * inset,
      bmp.width * (1 - inset * 2),
      bmp.height * (1 - inset * 2),
      0,
      0,
      SAMPLE,
      SAMPLE,
    )
    bmp.close()
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      const [h, chroma, lum] = rgbToHcl(data[i] * tint[0], data[i + 1] * tint[1], data[i + 2] * tint[2])
      add(h, chroma, lum, weight)
    }
  }
  if (total === 0) return null

  let maxPop = 0
  for (const b of bucket.values()) if (b.pop > maxPop) maxPop = b.pop
  // Resolved once: every target scores the same buckets.
  const swatches = [...bucket.values()]
    .map((b) => ({
      h: b.h / b.pop,
      s: b.s / b.pop,
      l: b.l / b.pop,
      pop: b.pop,
      share: b.pop / total,
    }))
    .filter((b) => b.share >= MIN_POPULATION_SHARE)

  let winner: {
    target: string
    h: number
    share: number
    score: number
  } | null = null
  for (const t of TARGETS) {
    const [minS, targetS, maxS] = t.sat
    const [minL, targetL, maxL] = t.lum
    for (const b of swatches) {
      // Hard bounds first: outside them a colour cannot stand for the model
      // however much of it there is.
      if (b.s < minS || b.s > maxS || b.l < minL || b.l > maxL) continue
      const score = closeness(b.s, targetS) * W_SAT + closeness(b.l, targetL) * W_LUM + (b.pop / maxPop) * W_POP
      if (!winner || score > winner.score) winner = { target: t.name, h: b.h, share: b.share, score }
    }
    // Each target is a whole profile, not a scoring tweak: the best DARK vibrant
    // is a better answer than a runner-up light one, so stop at the first that
    // matches rather than comparing scores across profiles.
    if (winner) break
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[cast colour] ${sources.length} parts, ${swatches.length}/${bucket.size} swatches →`,
      winner === null
        ? "no colour in any profile — neutral"
        : `${winner.target} hue ${Math.round(winner.h)} · ${Math.round(winner.share * 100)}% of mesh · score ${winner.score.toFixed(2)}`,
    )
  }
  return winner?.h ?? null
}
