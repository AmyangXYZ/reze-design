// Numbers about a frame, for an agent that judges looks.
//
// A vision model sees the picture; these say what it is made of, in terms that
// compare across two frames — a render against a reference, or a render against
// the last one. Every figure is computed in sRGB/Oklab from the pixels the
// viewer sees, not from scene values: "the shadows are blue" is a fact about
// the picture.
//
// Cheap on purpose: a 512px frame, one pass for the histograms and a sampled
// grid for the palette. Runs in the tab between two tool calls.

export type FrameMetrics = {
  /** Luminance percentiles, 0–1 (Oklab L): where the shadows, midtones and highlights sit. */
  luminance: { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number }
  /** Share of pixels at the ends: crushed blacks and blown highlights. */
  clipped: { black: number; white: number }
  /** Oklab chroma: mean, and how colourful the brightest tenth is. */
  saturation: { mean: number; highlights: number }
  /** The average colour of the darkest and brightest quarters — the tint of shadows and lights. */
  tint: { shadows: string; highlights: string }
  /** Dominant colours by share, most first. */
  palette: { color: string; share: number }[]
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** sRGB bytes → Oklab. */
export function oklab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = toLin(r8 / 255)
  const g = toLin(g8 / 255)
  const b = toLin(b8 / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/**
 * Measure an RGBA frame. Fully transparent pixels (an alpha export, nothing
 * drawn) are skipped, so a transparent background does not read as black.
 */
export function measureFrame(data: Uint8ClampedArray, width: number, height: number): FrameMetrics {
  const n = width * height
  const L = new Float32Array(n)
  const C = new Float32Array(n)
  const idx: number[] = []
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (data[p + 3] === 0) continue
    const [l, a, b] = oklab(data[p], data[p + 1], data[p + 2])
    L[idx.length] = l
    C[idx.length] = Math.hypot(a, b)
    idx.push(p)
  }
  const count = idx.length
  if (count === 0) {
    return {
      luminance: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0 },
      clipped: { black: 0, white: 0 },
      saturation: { mean: 0, highlights: 0 },
      tint: { shadows: "#000000", highlights: "#000000" },
      palette: [],
    }
  }

  const order = Array.from({ length: count }, (_, i) => i).sort((x, y) => L[x] - L[y])
  const at = (q: number) => L[order[Math.min(count - 1, Math.floor(q * count))]]

  let sumL = 0
  let sumC = 0
  let black = 0
  let white = 0
  for (let i = 0; i < count; i++) {
    sumL += L[i]
    sumC += C[i]
    const p = idx[i]
    if (data[p] <= 3 && data[p + 1] <= 3 && data[p + 2] <= 3) black++
    if (data[p] >= 252 && data[p + 1] >= 252 && data[p + 2] >= 252) white++
  }

  // Tint: the mean colour of the darkest and brightest quarters.
  const quarter = Math.max(1, Math.floor(count / 4))
  const meanRgb = (from: number, to: number) => {
    let r = 0
    let g = 0
    let b = 0
    for (let k = from; k < to; k++) {
      const p = idx[order[k]]
      r += data[p]
      g += data[p + 1]
      b += data[p + 2]
    }
    const m = to - from
    return hex(r / m, g / m, b / m)
  }
  let hiC = 0
  const tenth = Math.max(1, Math.floor(count / 10))
  for (let k = count - tenth; k < count; k++) hiC += C[order[k]]

  return {
    luminance: {
      p5: round(at(0.05)),
      p25: round(at(0.25)),
      p50: round(at(0.5)),
      p75: round(at(0.75)),
      p95: round(at(0.95)),
      mean: round(sumL / count),
    },
    clipped: { black: round(black / count), white: round(white / count) },
    saturation: { mean: round(sumC / count), highlights: round(hiC / tenth) },
    tint: { shadows: meanRgb(0, quarter), highlights: meanRgb(count - quarter, count) },
    palette: palette(data, idx),
  }
}

/** Dominant colours: a coarse 4-bit-per-channel histogram over sampled
 *  pixels, neighbouring bins merged, the top five by share. */
function palette(data: Uint8ClampedArray, idx: number[], top = 5): { color: string; share: number }[] {
  const step = Math.max(1, Math.floor(idx.length / 20000))
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  let sampled = 0
  for (let i = 0; i < idx.length; i += step) {
    const p = idx[i]
    const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4)
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += data[p]
    bin.g += data[p + 1]
    bin.b += data[p + 2]
    bins.set(key, bin)
    sampled++
  }
  // Greedy merge: take the biggest bin, fold in every bin perceptually close to
  // it, repeat — so one gradient does not fill all five slots.
  const list = [...bins.values()].map((b) => ({ ...b, lab: oklab(b.r / b.n, b.g / b.n, b.b / b.n) })).sort((x, y) => y.n - x.n)
  const out: { color: string; share: number }[] = []
  const used = new Set<number>()
  for (let i = 0; i < list.length && out.length < top; i++) {
    if (used.has(i)) continue
    const head = list[i]
    const acc = { n: head.n, r: head.r, g: head.g, b: head.b }
    used.add(i)
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue
      const o = list[j]
      if (Math.hypot(head.lab[0] - o.lab[0], head.lab[1] - o.lab[1], head.lab[2] - o.lab[2]) < 0.08) {
        acc.n += o.n
        acc.r += o.r
        acc.g += o.g
        acc.b += o.b
        used.add(j)
      }
    }
    out.push({ color: hex(acc.r / acc.n, acc.g / acc.n, acc.b / acc.n), share: round(acc.n / sampled, 2) })
  }
  return out.sort((x, y) => y.share - x.share)
}
