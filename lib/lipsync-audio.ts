// Lip sync from the music itself, for songs with no lyrics: DSP over the mix,
// no model. The voice is found by two properties instruments lack together:
//
//   1. It sits in the CENTRE of the stereo image (left and right agree in level
//      and phase), so panned instruments and reverb fall away bin by bin.
//   2. Its pitch MOVES: glides and vibrato bend its partials frame to frame,
//      where a piano or a synth holds each partial at one frequency.
//
// The energy of centred, moving partials is the vocal envelope. The mouth
// follows it: open while a vowel sounds, a dip at each consonant (the l of "la",
// the d of "da"), shut in the gaps. Every syllable is あ, which is what
// "lalala / dadada" is; picking vowels from the spectrum is a later step.

import { FPS, type MorphKeyframe } from "reze-engine"
import { mouthVmdFile } from "./lipsync"
import { fetchMedia } from "./net"

const N = 4096
/** Partials are tracked over this band: above the bass, below the sibilants. */
const F_LO = 300
const F_HI = 3500
/** A partial whose frequency shifts more than this between frames is moving. */
const MOVE = 0.0025
/** A partial with no neighbour within this ratio in the next/previous frame is noise. */
const LINK = 0.04

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len
    const wr = Math.cos(a)
    const wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k
        const q = p + len / 2
        const tr = re[q] * cr - im[q] * ci
        const ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr
        im[q] = im[p] - ti
        re[p] += tr
        im[p] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

function median(v: Float32Array, w: number): Float32Array {
  const out = new Float32Array(v.length)
  const h = w >> 1
  const buf: number[] = []
  for (let i = 0; i < v.length; i++) {
    buf.length = 0
    for (let k = Math.max(0, i - h); k <= Math.min(v.length - 1, i + h); k++) buf.push(v[k])
    buf.sort((a, b) => a - b)
    out[i] = buf[buf.length >> 1]
  }
  return out
}

function percentile(v: Float32Array, p: number): number {
  const s = Float32Array.from(v).sort()
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

/** Per 30fps frame: the energy of centred partials that move, and of those that hold. */
export function vocalEnergy(left: Float32Array, right: Float32Array, sampleRate: number) {
  const hop = sampleRate / FPS
  const frames = Math.max(0, Math.floor((left.length - N) / hop) + 1)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const lo = Math.floor((F_LO * N) / sampleRate)
  const hi = Math.ceil((F_HI * N) / sampleRate)
  const lr = new Float32Array(N)
  const li = new Float32Array(N)
  const rr = new Float32Array(N)
  const ri = new Float32Array(N)
  const c = new Float32Array(hi + 2)
  const peaks: { f: Float32Array; a: Float32Array }[] = []

  for (let t = 0; t < frames; t++) {
    const o = Math.round(t * hop)
    for (let i = 0; i < N; i++) {
      lr[i] = left[o + i] * win[i]
      rr[i] = right[o + i] * win[i]
    }
    li.fill(0)
    ri.fill(0)
    fft(lr, li)
    fft(rr, ri)
    // The centre: the mid signal, kept where both channels agree in level and phase.
    for (let k = lo - 1; k <= hi + 1; k++) {
      const aL = Math.hypot(lr[k], li[k])
      const aR = Math.hypot(rr[k], ri[k])
      const mid = Math.hypot(lr[k] + rr[k], li[k] + ri[k]) / 2
      const level = 1 - Math.abs(aL - aR) / (aL + aR + 1e-9)
      const phase = Math.max(0, (lr[k] * rr[k] + li[k] * ri[k]) / (aL * aR + 1e-9))
      c[k] = mid * level ** 4 * phase ** 2
    }
    // Spectral peaks above this frame's 90th percentile, placed to a fraction of
    // a bin by a parabola through the log magnitudes.
    const band = c.subarray(lo, hi)
    const floor = percentile(band, 90)
    const f: number[] = []
    const a: number[] = []
    for (let k = lo; k < hi; k++) {
      if (c[k] <= floor || c[k] <= c[k - 1] || c[k] < c[k + 1]) continue
      const y0 = Math.log(c[k - 1] + 1e-7)
      const y1 = Math.log(c[k] + 1e-7)
      const y2 = Math.log(c[k + 1] + 1e-7)
      const p = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 - 1e-9)
      f.push(((k + p) * sampleRate) / N)
      a.push(c[k])
    }
    peaks.push({ f: Float32Array.from(f), a: Float32Array.from(a) })
  }

  const move = new Float32Array(frames)
  const steady = new Float32Array(frames)
  const nearest = (fs: Float32Array, x: number): number => {
    let best = Infinity
    for (const y of fs) best = Math.min(best, Math.abs(y - x) / x)
    return best
  }
  for (let t = 1; t < frames - 1; t++) {
    const { f, a } = peaks[t]
    for (let i = 0; i < f.length; i++) {
      const back = nearest(peaks[t - 1].f, f[i])
      const fwd = nearest(peaks[t + 1].f, f[i])
      if (back > LINK || fwd > LINK) continue
      if (Math.max(back, fwd) > MOVE) move[t] += a[i]
      else steady[t] += a[i]
    }
  }
  return { move, steady, frames }
}

/** The mouth's peak あ weight. */
const CEIL = 0.5
/** The voice gate: level to open, level to stay open, and the moving share it needs. */
const GATE_ON = 0.28
const GATE_OFF = 0.14
const SHARE = 0.45
/** Follower coefficients per frame: opens in about a frame, falls over about three. */
const ATTACK = 0.8
const RELEASE = 0.35
/** How fast a held note is learned (per frame, about 0.25s), and how much of it the mouth keeps. */
const HOLD_RATE = 0.12
const HOLD = 0.35

/** Per 30fps frame, the あ weight the vocal calls for. */
export function mouthFromVocal(move: Float32Array, steady: Float32Array): Float32Array {
  const n = move.length
  const mouth = new Float32Array(n)
  if (n === 0) return mouth
  const top = percentile(move, 98) || 1
  const level = median(move, 5).map((v) => Math.min(1, v / top))
  const share = median(
    move.map((m, i) => m / (m + steady[i] + 1e-9)),
    9,
  )
  // Two followers on the level: a fast one that is the voice, and a slow one
  // that is the part of it being held. The mouth is the fast one less most of
  // the slow one, so it opens on every rise, sinks to a low hold while a note
  // is sustained, and shuts with the gate between phrases.
  const open = new Uint8Array(n)
  let gate = false
  let fast = 0
  let slow = 0
  for (let t = 0; t < n; t++) {
    gate = gate ? level[t] > GATE_OFF : level[t] > GATE_ON && share[t] > SHARE
    open[t] = gate ? 1 : 0
    fast += (level[t] > fast ? ATTACK : RELEASE) * (level[t] - fast)
    slow = gate ? slow + HOLD_RATE * (fast - slow) : 0
    mouth[t] = gate ? Math.max(0, fast - (1 - HOLD) * slow) : 0
  }
  // Scaled so a full-voiced syllable reaches the ceiling.
  const voiced = mouth.filter((_, t) => open[t])
  const peak = voiced.length ? percentile(voiced, 98) || 1 : 1
  for (let t = 0; t < n; t++) mouth[t] = CEIL * Math.min(1, mouth[t] / peak)
  return steadyMouth(mouth)
}

/** A shut mouth is a weight below this. */
const SHUT = 0.02 * CEIL
/** A closure shorter than this (frames) between two openings is bridged. */
const MIN_CLOSE = 3
/** An opening shorter than this (frames), or peaking below MIN_PEAK, is dropped. */
const MIN_OPEN = 5
const MIN_PEAK = 0.4 * CEIL

/** The openings between closures, as [start, end) frame pairs. */
function openings(mouth: Float32Array): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let t = 0; t <= mouth.length; t++) {
    const open = t < mouth.length && mouth[t] > SHUT
    if (open && start < 0) start = t
    if (!open && start >= 0) {
      out.push([start, t])
      start = -1
    }
  }
  return out
}

/** No flicker: bridge the briefest closures, then drop the briefest and smallest openings. */
function steadyMouth(raw: Float32Array): Float32Array {
  // A [¼ ½ ¼] pass first, which takes out the one-frame wobbles inside an opening.
  const mouth = raw.map((w, t) => (t === 0 || t === raw.length - 1 ? w : 0.25 * raw[t - 1] + 0.5 * w + 0.25 * raw[t + 1]))
  const spans = openings(mouth)
  for (let i = 1; i < spans.length; i++) {
    const [, prevEnd] = spans[i - 1]
    const [start] = spans[i]
    if (start - prevEnd >= MIN_CLOSE) continue
    const a = mouth[prevEnd - 1]
    const b = mouth[start]
    for (let t = prevEnd; t < start; t++) mouth[t] = a + ((b - a) * (t - prevEnd + 1)) / (start - prevEnd + 1)
  }
  for (const [start, end] of openings(mouth)) {
    let top = 0
    for (let t = start; t < end; t++) top = Math.max(top, mouth[t])
    if (end - start < MIN_OPEN || top < MIN_PEAK) mouth.fill(0, start, end)
  }
  return mouth
}

/** The あ track for a decoded song. */
export function lipSyncFromAudio(buffer: AudioBuffer): { tracks: Map<string, MorphKeyframe[]>; frameCount: number } {
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const { move, steady, frames } = vocalEnergy(left, right, buffer.sampleRate)
  const mouth = mouthFromVocal(move, steady)
  // A key wherever the weight changes, and the frames either side of a change,
  // so the engine's linear interpolation draws the same curve.
  const keys: MorphKeyframe[] = []
  for (let t = 0; t < frames; t++) {
    const w = mouth[t]
    const same = t > 0 && t < frames - 1 && w === mouth[t - 1] && w === mouth[t + 1]
    if (!same) keys.push({ morphName: "あ", frame: t, weight: Math.round(w * 1000) / 1000 })
  }
  const tracks = new Map<string, MorphKeyframe[]>()
  if (mouth.some((w) => w > 0)) tracks.set("あ", keys)
  return { tracks, frameCount: frames }
}

/** The music at `url` as a mouth VMD named after `name`, merged over `existing`. */
export async function lipSyncVmdFromMusic(url: string, name: string, existing?: ArrayBuffer): Promise<File | null> {
  const ac = new AudioContext()
  try {
    const buffer = await ac.decodeAudioData(await (await fetchMedia(url)).arrayBuffer())
    const { tracks, frameCount } = lipSyncFromAudio(buffer)
    return mouthVmdFile(tracks, frameCount, name.replace(/\.[^.]+$/, ""), existing)
  } finally {
    void ac.close()
  }
}
