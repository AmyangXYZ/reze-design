// Tests for lib/ai/music — tempo, beat grid and sections from a drawn analysis.
//
//   npx esbuild lib/ai/music.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/mu.mjs && node /tmp/mu.mjs

import assert from "node:assert/strict"
import { summarizeMusic, tempoOf } from "./music"

const FPS = 60
const BANDS = 2

/** An analysis whose onset column pulses at `bpm` from `offset` seconds, with
 *  the level stepping through `levels` for equal stretches. */
function drawn(seconds: number, bpm: number, offset: number, levels: number[]) {
  const n = seconds * FPS
  const stride = 2 + BANDS
  const data = new Float32Array(n * stride)
  const period = (FPS * 60) / bpm
  for (let i = 0; i < n; i++) {
    const t = i - offset * FPS
    const onBeat = t >= 0 && Math.abs(t - Math.round(t / period) * period) < 1
    data[i * stride + 1] = onBeat ? 1 : 0.02
    data[i * stride] = levels[Math.min(levels.length - 1, Math.floor((i / n) * levels.length))]
  }
  return { data, bands: BANDS, secondsPerFrame: 1 / FPS }
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

test("finds 120 BPM", () => {
  const s = summarizeMusic(drawn(30, 120, 0.25, [0.5]))
  assert.ok(s.bpm && Math.abs(s.bpm - 120) < 2, `bpm ${s.bpm}`)
})

test("finds 96 BPM, not its double or half", () => {
  const s = summarizeMusic(drawn(30, 96, 0, [0.5]))
  assert.ok(s.bpm && Math.abs(s.bpm - 96) < 2, `bpm ${s.bpm}`)
})

test("the beat grid lands on the pulses", () => {
  const s = summarizeMusic(drawn(20, 120, 0.25, [0.5]))
  assert.ok(Math.abs(s.beats[0] - 0.25) < 0.05, `first beat ${s.beats[0]}`)
  assert.ok(Math.abs(s.beats[1] - s.beats[0] - 0.5) < 0.05)
})

test("downbeats are every fourth beat", () => {
  const s = summarizeMusic(drawn(20, 120, 0, [0.5]))
  assert.ok(s.downbeats.length >= Math.floor(s.beats.length / 4))
  assert.ok(Math.abs(s.downbeats[1] - s.downbeats[0] - 2) < 0.05)
})

test("quiet, loud, quiet sections", () => {
  const s = summarizeMusic(drawn(36, 120, 0, [0.1, 0.9, 0.1]))
  const kinds = s.sections.map((x) => x.loudness)
  assert.deepEqual(kinds, ["quiet", "loud", "quiet"], JSON.stringify(s.sections))
  assert.ok(Math.abs(s.sections[1].start - 12) < 2.5)
})

test("no tempo from silence", () => {
  const n = 10 * FPS
  assert.equal(tempoOf(new Float32Array(n), FPS), null)
})

test("hits are capped and in time order", () => {
  const s = summarizeMusic(drawn(30, 120, 0, [0.5]), 10)
  assert.equal(s.hits.length, 10)
  for (let i = 1; i < s.hits.length; i++) assert.ok(s.hits[i].time > s.hits[i - 1].time)
})

test("hits cover the whole song when every peak ties", () => {
  const s = summarizeMusic(drawn(30, 120, 0, [0.5]), 10)
  assert.ok(s.hits[0].time < 3, `first ${s.hits[0].time}`)
  assert.ok(s.hits[s.hits.length - 1].time >= 27, `last ${s.hits[s.hits.length - 1].time}`)
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
