// npx esbuild lib/time-stretch.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs
//
// The export's music at a playback speed: the right length, the same pitch,
// no holes where windows meet.

import assert from "node:assert/strict"
import { timeStretch } from "./time-stretch"

const RATE = 48000

const tone = (hz: number, seconds: number, phase = 0) => {
  const a = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE + phase)
  return a
}

/** Frequency by upward zero crossings over the middle of the signal. */
const pitch = (a: Float32Array) => {
  const from = Math.floor(a.length * 0.1)
  const to = Math.floor(a.length * 0.9)
  let n = 0
  for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) n++
  return n / ((to - from) / RATE)
}

const rms = (a: Float32Array, from: number, to: number) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}

let failures = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    console.log("ok  ", name)
  } catch (e) {
    failures++
    console.log("FAIL", name, "\n   ", (e as Error).message)
  }
}

for (const speed of [0.25, 0.5, 0.75, 1.25, 1.5, 2]) {
  check(`${speed}×: length is input / speed, pitch is kept`, () => {
    const input = tone(440, 3)
    const [out] = timeStretch([input], RATE, speed)
    assert.equal(out.length, Math.round(input.length / speed))
    const hz = pitch(out)
    assert.ok(Math.abs(hz - 440) < 440 * 0.02, `pitch ${hz.toFixed(1)} Hz`)
  })
  check(`${speed}×: level holds across the windows (no holes, no beating)`, () => {
    const input = tone(220, 2)
    const [out] = timeStretch([input], RATE, speed)
    // 10 ms slices: a hole or a cancellation where windows meet shows as a dip.
    const slice = RATE / 100
    const expected = 0.5 / Math.SQRT2
    for (let i = slice * 5; i + slice < out.length - slice * 5; i += slice) {
      const r = rms(out, i, i + slice)
      assert.ok(r > expected * 0.8 && r < expected * 1.2, `rms ${r.toFixed(3)} at ${(i / RATE).toFixed(2)} s`)
    }
  })
}

check("stereo keeps its channels apart", () => {
  const l = tone(440, 1)
  const r = tone(660, 1)
  const [ol, or] = timeStretch([l, r], RATE, 0.5)
  assert.ok(Math.abs(pitch(ol) - 440) < 10, `left ${pitch(ol)}`)
  assert.ok(Math.abs(pitch(or) - 660) < 15, `right ${pitch(or)}`)
})

check("1× is a copy", () => {
  const input = tone(440, 0.5)
  const [out] = timeStretch([input], RATE, 1)
  assert.notEqual(out, input)
  assert.deepEqual(out, input)
})

check("a 3-minute stereo track stretches in reasonable time", () => {
  const l = tone(330, 180)
  const r = tone(331, 180)
  const t0 = performance.now()
  timeStretch([l, r], RATE, 0.5)
  const ms = performance.now() - t0
  assert.ok(ms < 8000, `${ms.toFixed(0)} ms`)
  console.log(`     (${ms.toFixed(0)} ms)`)
})

if (failures) {
  console.log(`\n${failures} failed`)
  process.exit(1)
}
console.log("\nall passed")
