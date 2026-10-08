// Tests for region-metrics, over synthetic read-back frames.
//
//   npx esbuild lib/ai/region-metrics.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=analysis/agent/rm.mjs && node analysis/agent/rm.mjs

import assert from "node:assert/strict"
import { measureRegions, toStops, type AovFrame, type RegionSpec } from "./region-metrics"

let failures = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

const FIELDS = ["r", "g", "b", "depth", "sunShadow", "sunFacing", "lampR", "lampG", "lampB", "ambR", "ambG", "ambB"] as const

type Px = { obj: number; mat: number; y?: number; shadow?: number; facing?: number; lamp?: number; amb?: number; depth?: number; shown?: number }

/** A w×h frame from a function of (x, y). Nothing drawn is obj 0. */
function frame(w: number, h: number, at: (x: number, y: number) => Px, exposure = 0) {
  const stride = FIELDS.length
  const data = new Float32Array(w * h * stride)
  const ids = new Uint32Array(w * h)
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = at(x, y)
      const o = i * stride
      const v = p.y ?? 0.18
      data.set([v, v, v, p.depth ?? 10, p.obj ? (p.shadow ?? 1) : -1, p.facing ?? 1, p.lamp ?? 0, p.lamp ?? 0, p.lamp ?? 0, p.amb ?? 0, p.amb ?? 0, p.amb ?? 0], o)
      ids[i] = (p.obj << 16) | p.mat
      const c = p.shown ?? 128
      rgba.set([c, c, c, 255], i * 4)
    }
  }
  const f: AovFrame = { width: w, height: h, stride, fields: FIELDS, data, ids, exposure }
  return { f, rgba }
}

const her: RegionSpec = { name: "Reze", kind: "character", has: (o) => o === 1 }
const face: RegionSpec = { name: "face", kind: "group", of: "Reze", has: (o, m) => o === 1 && m === 2 }
const bg: RegionSpec = { name: "background", kind: "background", has: (o) => o !== 1 }

await test("mid-grey at exposure 0 is 0 stops; one stop up is +1", () => {
  assert.equal(Math.round(toStops(0.18, 0) * 100) / 100, 0)
  assert.equal(Math.round(toStops(0.36, 0) * 100) / 100, 1)
  assert.equal(Math.round(toStops(0.18, 1) * 100) / 100, 1)
})

await test("coverage, box and a cut at the top", () => {
  // She fills columns 1–2 of a 4×4 frame, top to row 2.
  const { f, rgba } = frame(4, 4, (x, y) => (x >= 1 && x <= 2 && y <= 2 ? { obj: 1, mat: 1 } : { obj: 0, mat: 0 }))
  const r = measureRegions(f, rgba, [1, 1, 1], [her, bg]).regions[0]
  assert.equal(r.coverage, 0.38) // 6 of 16
  assert.deepEqual(r.box, { left: 0.25, top: 0, right: 0.75, bottom: 0.75 })
  assert.deepEqual(r.cut, ["top"])
})

await test("a face in the sun's shadow reads as cast shadow, not lit", () => {
  const { f, rgba } = frame(2, 2, () => ({ obj: 1, mat: 2, shadow: 0.1, facing: 0.8 }))
  const r = measureRegions(f, rgba, [1, 1, 1], [face]).regions[0]
  assert.equal(r.light.castShadow, 1)
  assert.equal(r.light.inSun, 0)
})

await test("which light carries a region: sun vs lamps vs ambient", () => {
  // Sun 1 × facing 1 × lit 1 = 1; lamp 3; ambient 0 → the lamps carry 75%.
  const { f, rgba } = frame(2, 2, () => ({ obj: 1, mat: 1, lamp: 3 }))
  const r = measureRegions(f, rgba, [1, 1, 1], [her]).regions[0]
  assert.equal(r.light.lamps, 0.75)
  assert.equal(r.light.sun, 0.25)
})

await test("over-white counts drawn pixels only", () => {
  // Half her pixels at 2.0 linear (past 1.0), half at mid-grey.
  const { f, rgba } = frame(2, 2, (x) => ({ obj: 1, mat: 1, y: x === 0 ? 2 : 0.18 }))
  assert.equal(measureRegions(f, rgba, [1, 1, 1], [her]).regions[0].over, 0.5)
})

await test("separation uses what is shown: a dark figure on a bright backdrop", () => {
  // She shows at 40/255, the backdrop (nothing drawn) at 230/255.
  const { f, rgba } = frame(4, 4, (x) => (x === 1 || x === 2 ? { obj: 1, mat: 1, shown: 40 } : { obj: 0, mat: 0, shown: 230 }))
  const sep = measureRegions(f, rgba, [1, 1, 1], [her, bg]).separation[0]
  assert.ok(sep.stops < -3, `she should sit well below the backdrop, got ${sep.stops}`)
  assert.ok(sep.edge > 3, `her edge should be a strong step, got ${sep.edge}`)
})

await test("an empty region answers zeros rather than NaN", () => {
  const { f, rgba } = frame(2, 2, () => ({ obj: 0, mat: 0 }))
  const r = measureRegions(f, rgba, [1, 1, 1], [her]).regions[0]
  assert.equal(r.coverage, 0)
  assert.ok(Object.values(r.stops).every(Number.isFinite))
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
console.log("\nall passing")
