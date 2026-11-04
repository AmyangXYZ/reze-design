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

import { FPS, type LyricLine, type MorphKeyframe } from "reze-engine"
import { lyricSpans, mouthVmdFile, visemeMorph } from "./lipsync"
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
  // Each frame's window is CENTRED on the frame's own time. Starting it there put
  // frame t's energy N/2 samples (46ms) into the future, and the mouth ran early.
  const frames = Math.max(0, Math.floor(left.length / hop))
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
    const o = Math.round(t * hop) - N / 2
    for (let i = 0; i < N; i++) {
      const s = o + i
      const inside = s >= 0 && s < left.length
      lr[i] = inside ? left[s] * win[i] : 0
      rr[i] = inside ? right[s] * win[i] : 0
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
const CEIL = 0.7
/** The voice gate: level to open, level to stay open, and the moving share it needs. */
const GATE_ON = 0.28
const GATE_OFF = 0.14
const SHARE = 0.45
/** Follower coefficients per frame: opens in about a frame, falls over about three. */
const ATTACK = 0.8
const RELEASE = 0.35
/** How fast a held note is learned (per frame, about 0.25s), and how much of it the mouth keeps. */
const HOLD_RATE = 0.12
const HOLD = 0.2
/**
 * The width curve: a square root, so a syllable sung at a quarter of the
 * loudest still opens the mouth halfway. Zero stays zero, so every closure
 * stays shut; a linear width left all but the loudest phrases a sliver.
 */
const LIFT = 0.5

/** The voice's level per 30fps frame, 0..1: the moving partials' energy, smoothed. */
export function voiceLevel(move: Float32Array): Float32Array {
  const top = percentile(move, 98) || 1
  return median(move, 5).map((v) => Math.min(1, v / top))
}

/**
 * Per 30fps frame, how wide the voice opens the mouth, 0..1.
 *
 * `sung` overrides the detector's gate where the timing is known some other
 * way: the lyric lines, which say when she sings better than a dense mix does.
 */
export function voiceWidth(move: Float32Array, steady: Float32Array, sung?: Uint8Array): Float32Array {
  const n = move.length
  const mouth = new Float32Array(n)
  if (n === 0) return mouth
  const level = voiceLevel(move)
  const share = median(
    move.map((m, i) => m / (m + steady[i] + 1e-9)),
    9,
  )
  // Two followers on the level: a fast one that is the voice, and a slow one
  // that is the part of it being held. The mouth is the fast one less most of
  // the slow one, so it opens on every rise, sinks while a note is sustained,
  // and shuts with the gate between phrases.
  const open = new Uint8Array(n)
  let gate = false
  let fast = 0
  let slow = 0
  for (let t = 0; t < n; t++) {
    gate = sung ? sung[t] === 1 : gate ? level[t] > GATE_OFF : level[t] > GATE_ON && share[t] > SHARE
    open[t] = gate ? 1 : 0
    fast += (level[t] > fast ? ATTACK : RELEASE) * (level[t] - fast)
    slow = gate ? slow + HOLD_RATE * (fast - slow) : 0
    mouth[t] = gate ? Math.max(0, fast - (1 - HOLD) * slow) : 0
  }
  // Scaled so a full-voiced syllable reaches 1.
  const voiced = mouth.filter((_, t) => open[t])
  const peak = voiced.length ? percentile(voiced, 98) || 1 : 1
  for (let t = 0; t < n; t++) mouth[t] = Math.min(1, mouth[t] / peak) ** LIFT
  return steadyMouth(mouth)
}

/** Per 30fps frame, the あ weight the vocal calls for. */
export function mouthFromVocal(move: Float32Array, steady: Float32Array): Float32Array {
  return voiceWidth(move, steady).map((w) => CEIL * w)
}

/** A shut mouth is a width below this. */
const SHUT = 0.02
/** A closure shorter than this (frames) between two openings is bridged. */
const MIN_CLOSE = 3
/** An opening shorter than this (frames), or peaking below MIN_PEAK, is dropped. */
const MIN_OPEN = 5
const MIN_PEAK = 0.4
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

/** A weight curve as keys: one wherever it changes, so linear interpolation draws the same curve. */
function keysOfCurve(name: string, curve: Float32Array): MorphKeyframe[] {
  const keys: MorphKeyframe[] = []
  const n = curve.length
  for (let t = 0; t < n; t++) {
    const w = curve[t]
    const same = t > 0 && t < n - 1 && w === curve[t - 1] && w === curve[t + 1]
    if (!same) keys.push({ morphName: name, frame: t, weight: Math.round(w * 1000) / 1000 })
  }
  return keys
}

function channels(buffer: AudioBuffer): [Float32Array, Float32Array] {
  const left = buffer.getChannelData(0)
  return [left, buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left]
}

/** The あ track for a decoded song. */
export function lipSyncFromAudio(buffer: AudioBuffer): { tracks: Map<string, MorphKeyframe[]>; frameCount: number } {
  const [left, right] = channels(buffer)
  const { move, steady, frames } = vocalEnergy(left, right, buffer.sampleRate)
  const mouth = mouthFromVocal(move, steady)
  const tracks = new Map<string, MorphKeyframe[]>()
  if (mouth.some((w) => w > 0)) tracks.set("あ", keysOfCurve("あ", mouth))
  return { tracks, frameCount: frames }
}

/** Seconds either side of a lyric syllable where the voice may open the mouth. */
const LYRIC_PAD = 0.2
/** Frames over which one vowel's shape turns into the next. */
const VOWEL_BLEND = 3
/** A lyric vowel's weight at full voice, as a multiple of its lyric-only peak. */
const LYRIC_SCALE = 1.4

/**
 * Lip sync from the lyrics AND the music: the lyrics say which vowel and when a
 * line is sung, the voice says when the mouth opens and how wide. The vowel on
 * each frame is the lyric syllable whose slot it falls in (lyricSpans).
 */
export function lipSyncFromLyricsAndAudio(
  lines: LyricLine[],
  buffer: AudioBuffer,
): { tracks: Map<string, MorphKeyframe[]>; frameCount: number } {
  const [left, right] = channels(buffer)
  const { move, steady, frames } = vocalEnergy(left, right, buffer.sampleRate)
  const spans = lyricSpans(lines)
  const frame = (t: number) => Math.max(0, Math.min(frames, Math.round(t * FPS)))
  // The mouth may open where a lyric line is sung.
  const sung = new Uint8Array(frames)
  for (const sp of spans) sung.fill(1, frame(sp.t0 - LYRIC_PAD), frame((sp.relEnd ?? sp.t1) + LYRIC_PAD))
  const width = voiceWidth(move, steady, sung)
  // Each frame wears the vowel of the syllable it falls in: the latest to start.
  const tracks = new Map<string, MorphKeyframe[]>()
  const by = new Map<string, Float32Array>()
  let i = 0
  for (let t = 0; t < frames; t++) {
    while (i + 1 < spans.length && spans[i + 1].t0 * FPS <= t) i++
    const sp = spans[i]
    if (!sp) break
    const name = visemeMorph(sp.viseme)
    const curve = by.get(name) ?? new Float32Array(frames)
    curve[t] = Math.min(1, sp.weight * LYRIC_SCALE)
    by.set(name, curve)
  }
  for (const [name, peak] of by) {
    // Blended across vowel changes, then opened by the voice.
    const blended = new Float32Array(frames)
    const h = VOWEL_BLEND >> 1
    for (let t = 0; t < frames; t++) {
      let sum = 0
      for (let k = t - h; k <= t + h; k++) sum += peak[Math.max(0, Math.min(frames - 1, k))]
      blended[t] = (sum / VOWEL_BLEND) * width[t]
    }
    if (blended.some((w) => w > 0)) tracks.set(name, keysOfCurve(name, blended))
  }
  return { tracks, frameCount: frames }
}

async function decode(url: string): Promise<AudioBuffer> {
  const ac = new AudioContext()
  try {
    return await ac.decodeAudioData(await (await fetchMedia(url)).arrayBuffer())
  } finally {
    void ac.close()
  }
}

/** The music at `url` as a mouth VMD named after `name`, merged over `existing`. */
export async function lipSyncVmdFromMusic(url: string, name: string, existing?: ArrayBuffer): Promise<File | null> {
  const { tracks, frameCount } = lipSyncFromAudio(await decode(url))
  return mouthVmdFile(tracks, frameCount, name.replace(/\.[^.]+$/, ""), existing)
}

/** The lyrics, timed by the music at `url`, as a mouth VMD named after the lyrics. */
export async function lipSyncVmdFromLyricsAndMusic(
  lines: LyricLine[],
  lyricsName: string,
  url: string,
  existing?: ArrayBuffer,
): Promise<File | null> {
  const { tracks, frameCount } = lipSyncFromLyricsAndAudio(lines, await decode(url))
  return mouthVmdFile(tracks, frameCount, lyricsName.replace(/\.lrc$/i, ""), existing)
}
