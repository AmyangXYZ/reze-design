// Tests for lib/ai/image-metrics on drawn frames.
//
//   npx esbuild lib/ai/image-metrics.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/im.mjs && node /tmp/im.mjs

import assert from "node:assert/strict"
import { measureFrame } from "./image-metrics"

const W = 64
const H = 64
function frame(paint: (x: number, y: number) => [number, number, number, number?]) {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b, a = 255] = paint(x, y)
      d.set([r, g, b, a], (y * W + x) * 4)
    }
  return d
}

let failures = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

test("half black, half white: ends of the range, clipped both ways", () => {
  const m = measureFrame(frame((x) => (x < W / 2 ? [0, 0, 0] : [255, 255, 255])), W, H)
  assert.ok(m.luminance.p5 < 0.01 && m.luminance.p95 > 0.99, JSON.stringify(m.luminance))
  assert.equal(m.clipped.black, 0.5)
  assert.equal(m.clipped.white, 0.5)
  assert.equal(m.saturation.mean, 0)
})

test("blue shadows and warm highlights read as such", () => {
  const m = measureFrame(frame((x) => (x < W / 2 ? [20, 30, 90] : [250, 210, 160])), W, H)
  const [sr, , sb] = [1, 3, 5].map((i) => parseInt(m.tint.shadows.slice(i, i + 2), 16))
  const [hr, , hb] = [1, 3, 5].map((i) => parseInt(m.tint.highlights.slice(i, i + 2), 16))
  assert.ok(sb > sr, `shadows ${m.tint.shadows}`)
  assert.ok(hr > hb, `highlights ${m.tint.highlights}`)
})

test("palette finds the two colours, by share", () => {
  const m = measureFrame(frame((x) => (x < W / 4 ? [200, 30, 40] : [30, 160, 60])), W, H)
  assert.equal(m.palette.length, 2)
  assert.ok(m.palette[0].share > m.palette[1].share)
})

test("transparent pixels are not measured", () => {
  const m = measureFrame(frame((x) => (x < W / 2 ? [0, 0, 0, 0] : [255, 255, 255])), W, H)
  assert.equal(m.clipped.black, 0)
  assert.equal(m.clipped.white, 1)
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
