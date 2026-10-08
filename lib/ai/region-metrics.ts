// What a lighting artist reads off a render, region by region.
//
// image-metrics.ts measures the whole picture. This splits the frame by what
// drew each pixel — a character, one of her material groups (face, hair,
// skin, clothes), or the background — using the engine's read-back of the
// frame (Engine.readAovs): its ids, its linear colour, its depth, and the light
// arriving at each pixel. So the answers are the ones an MMD artist asks:
// is her face in the sun's shadow, how many stops apart are she and the
// background, which light is carrying the hair, is she cut off at the top.
//
// Pure arithmetic over arrays, so it is tested in node with synthetic frames
// (region-metrics.test.mts) and runs in the tab between two tool calls.

import { oklab, hex } from "@/lib/ai/image-metrics"

/** The read-back as this module needs it — Engine's SceneAovs is one. */
export type AovFrame = {
  width: number
  height: number
  stride: number
  fields: readonly string[]
  data: Float32Array
  ids: Uint32Array
  exposure: number
}

/** A region: what to call it, and which (object, material) pixels are it. */
export type RegionSpec = {
  name: string
  kind: "character" | "group" | "background"
  /** For a group, the character it belongs to (its region name). */
  of?: string
  has: (objectId: number, materialId: number) => boolean
}

export type RegionMetrics = {
  name: string
  kind: RegionSpec["kind"]
  of?: string
  /** Share of the frame. */
  coverage: number
  /** Where it sits, 0–1 from the top-left. */
  box: { left: number; top: number; right: number; bottom: number }
  /** Frame edges it touches — a character touching "top" has her head cut. */
  cut: ("top" | "bottom" | "left" | "right")[]
  /** Linear luminance in stops from mid-grey, after the view's exposure:
   *  0 is mid-grey, +2.5 is about where a toon transform starts to blow out.
   *  The SCENE's light — before tone mapping, and before any effect drawn over
   *  the finished frame; `look` is what is shown. Drawn pixels only. */
  stops: { p10: number; p50: number; p90: number }
  /** Share brighter than 1.0 after exposure — past white before tone mapping. */
  over: number
  /** As the viewer sees it (sRGB): Oklab lightness, colourfulness, mean colour. */
  look: { lightness: number; chroma: number; color: string }
  /** The light arriving: in the sun (lit and facing it), in a caster's shadow,
   *  turned from the sun; and each source's share of the light here. */
  light: { inSun: number; castShadow: number; turnedAway: number; sun: number; lamps: number; ambient: number }
  /** Median distance from the camera, world units — compare with the focus. */
  depth: number
}

export type CharacterSeparation = {
  name: string
  /** Her median brightness minus the background's, in stops AS DISPLAYED
   *  (after tone mapping, over the backdrop): how far she stands out. */
  stops: number
  /** Mean displayed stops difference across her silhouette edge — low means
   *  she melts into what is behind her. */
  edge: number
}

export type RegionReport = {
  regions: RegionMetrics[]
  separation: CharacterSeparation[]
  /** Pixels nothing drew (sky, backdrop) — measured with the background. */
  empty: number
}

const r2 = (v: number) => Math.round(v * 100) / 100
const r1 = (v: number) => Math.round(v * 10) / 10
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Stops from mid-grey of a linear luminance after `exposure` stops. */
export const toStops = (y: number, exposure: number) => Math.log2(Math.max(y * 2 ** exposure, 1e-5) / 0.18)

const srgbToLinear = (c8: number) => {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

/**
 * Measure `regions` over one read-back frame and the sRGB pixels the viewer saw
 * (same size). `sun` is the sun's light, colour times strength, as
 * Engine.getSun gives it.
 */
export function measureRegions(frame: AovFrame, rgba: Uint8ClampedArray, sun: [number, number, number], regions: RegionSpec[]): RegionReport {
  const { width: w, height: h, stride, data, ids, exposure } = frame
  const f = (name: string) => frame.fields.indexOf(name)
  const iR = f("r")
  const iDepth = f("depth")
  const iShadow = f("sunShadow")
  const iFacing = f("sunFacing")
  const iLamp = f("lampR")
  const iAmb = f("ambR")
  const sunY = lum(sun[0], sun[1], sun[2])
  const n = w * h

  // Every pixel's stops, once. `stops` is the scene's light before tone
  // mapping; `shown` is what the viewer sees, which is the only place the
  // backdrop and sky exist — they are composited after the scene, so where
  // nothing drew the scene's buffer is black.
  const stops = new Float32Array(n)
  const shown = new Float32Array(n)
  let empty = 0
  for (let i = 0; i < n; i++) {
    const o = i * stride
    stops[i] = toStops(lum(data[o + iR], data[o + iR + 1], data[o + iR + 2]), exposure)
    const p = i * 4
    shown[i] = toStops(lum(srgbToLinear(rgba[p]), srgbToLinear(rgba[p + 1]), srgbToLinear(rgba[p + 2])), 0)
    if (ids[i] === 0) empty++
  }

  const members = regions.map(() => [] as number[])
  for (let i = 0; i < n; i++) {
    const obj = ids[i] >>> 16
    const mat = ids[i] & 0xffff
    for (let k = 0; k < regions.length; k++) if (regions[k].has(obj, mat)) members[k].push(i)
  }

  const out: RegionMetrics[] = regions.map((spec, k) => {
    const px = members[k]
    const count = px.length
    const base = { name: spec.name, kind: spec.kind, ...(spec.of ? { of: spec.of } : {}) }
    if (count === 0) {
      return {
        ...base,
        coverage: 0,
        box: { left: 0, top: 0, right: 0, bottom: 0 },
        cut: [],
        stops: { p10: 0, p50: 0, p90: 0 },
        over: 0,
        look: { lightness: 0, chroma: 0, color: "#000000" },
        light: { inSun: 0, castShadow: 0, turnedAway: 0, sun: 0, lamps: 0, ambient: 0 },
        depth: 0,
      }
    }
    let x0 = w
    let y0 = h
    let x1 = 0
    let y1 = 0
    let over = 0
    let L = 0
    let C = 0
    let cr = 0
    let cg = 0
    let cb = 0
    let lit = 0
    let litN = 0
    let shadowed = 0
    let away = 0
    let eSun = 0
    let eLamp = 0
    let eAmb = 0
    const s: number[] = []
    const depths: number[] = []
    for (let j = 0; j < count; j++) {
      const i = px[j]
      const x = i % w
      const y = (i - x) / w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const p = i * 4
      const [l, a, b] = oklab(rgba[p], rgba[p + 1], rgba[p + 2])
      L += l
      C += Math.hypot(a, b)
      cr += rgba[p]
      cg += rgba[p + 1]
      cb += rgba[p + 2]
      const o = i * stride
      const shadow = data[o + iShadow]
      if (shadow < 0) continue // nothing drew here: no surface, no light
      s.push(stops[i])
      if (stops[i] > Math.log2(1 / 0.18)) over++
      litN++
      const facing = data[o + iFacing]
      if (facing <= 0) away++
      else if (shadow < 0.5) shadowed++
      else lit++
      eSun += sunY * Math.max(facing, 0) * shadow
      eLamp += lum(data[o + iLamp], data[o + iLamp + 1], data[o + iLamp + 2])
      eAmb += lum(data[o + iAmb], data[o + iAmb + 1], data[o + iAmb + 2])
      depths.push(data[o + iDepth])
    }
    s.sort((p, q) => p - q)
    depths.sort((p, q) => p - q)
    const drawn = s.length || 1
    const total = eSun + eLamp + eAmb || 1
    const cut: RegionMetrics["cut"] = []
    if (y0 === 0) cut.push("top")
    if (y1 === h - 1) cut.push("bottom")
    if (x0 === 0) cut.push("left")
    if (x1 === w - 1) cut.push("right")
    return {
      ...base,
      coverage: r2(count / n),
      box: { left: r2(x0 / w), top: r2(y0 / h), right: r2((x1 + 1) / w), bottom: r2((y1 + 1) / h) },
      cut,
      stops: { p10: r1(quantile(s, 0.1)), p50: r1(quantile(s, 0.5)), p90: r1(quantile(s, 0.9)) },
      over: r2(over / drawn),
      look: { lightness: r2(L / count), chroma: r2(C / count), color: hex(cr / count, cg / count, cb / count) },
      light: {
        inSun: r2(litN ? lit / litN : 0),
        castShadow: r2(litN ? shadowed / litN : 0),
        turnedAway: r2(litN ? away / litN : 0),
        sun: r2(eSun / total),
        lamps: r2(eLamp / total),
        ambient: r2(eAmb / total),
      },
      depth: r1(depths.length ? depths[Math.floor(depths.length / 2)] : 0),
    }
  })

  // Separation: each character against everything that is no character.
  const charIdx = regions.map((r, k) => (r.kind === "character" ? k : -1)).filter((k) => k >= 0)
  const isChar = new Uint8Array(n)
  for (const k of charIdx) for (const i of members[k]) isChar[i] = 1
  const bgStops: number[] = []
  for (let i = 0; i < n; i++) if (!isChar[i]) bgStops.push(shown[i])
  bgStops.sort((p, q) => p - q)
  const bgMedian = bgStops.length ? bgStops[Math.floor(bgStops.length / 2)] : 0
  const separation = charIdx.map((k) => {
    const mine = new Uint8Array(n)
    const herShown: number[] = []
    for (const i of members[k]) {
      mine[i] = 1
      herShown.push(shown[i])
    }
    herShown.sort((p, q) => p - q)
    let edge = 0
    let edges = 0
    for (const i of members[k]) {
      const x = i % w
      const y = (i - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (mine[ni] || isChar[ni]) continue
        edge += Math.abs(shown[i] - shown[ni])
        edges++
      }
    }
    const herMedian = herShown.length ? herShown[Math.floor(herShown.length / 2)] : 0
    return { name: regions[k].name, stops: r1(herMedian - bgMedian), edge: r1(edges ? edge / edges : 0) }
  })

  return { regions: out, separation, empty: r2(empty / n) }
}
