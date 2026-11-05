// Lip sync from the music itself, for songs with no lyrics: DSP over the mix,
// no model. The voice is found by two properties instruments lack together:
//
//   1. It sits in the CENTRE of the stereo image (left and right agree in level
//      and phase), so panned instruments and reverb fall away bin by bin.
//   2. Its pitch MOVES: glides and vibrato bend its partials frame to frame,
//      where a piano or a synth holds each partial at one frequency.
//
// The energy of centred, moving partials says WHEN she sings. Each syllable is
// then found by its onset: the consonant that starts it is a sudden rise in the
// centre's spectrum (SuperFlux, Böck & Widmer 2013: spectral flux over log bands,
// with a max filter across bands so vibrato does not read as new onsets). The
// mouth is keyed the way a hand-keyer keys it: a dip at each onset, the apex
// three frames later on the vowel, a quarter open between syllables of one
// phrase, shut between phrases. Each syllable wears a vowel drawn in the mix
// hand-keyed motions use; the detector cannot hear which vowel is sung.
//
// Measured against six motions whose mouths were keyed by hand to their songs
// (KISS OF LIFE, YUNA, YENA, HUNTR/X, aespa, i-dle), scored above chance (the
// same mouth shifted far off the song): following the envelope's own peaks
// reached 20% of the way from chance to their keys, keying onsets reaches 30%.
// Separating the voice first (REPET-SIM, two-stage HPSS) did not raise it: those
// makers key the song's rhythm, which voice and drums share.

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
  // The onset bands: 12 a semitone apart from FLUX_LO to FLUX_HI.
  const edges: number[] = []
  for (let i = 0; i <= Math.floor(Math.log2(FLUX_HI / FLUX_LO) * 12); i++) edges.push(Math.floor((FLUX_LO * 2 ** (i / 12) * N) / sampleRate))
  const bands = edges.length - 1
  const kLo = Math.min(lo - 1, edges[0])
  const kHi = Math.max(hi + 1, edges[bands])
  const c = new Float32Array(kHi + 2)
  const energy = new Float32Array(frames * bands)
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
    for (let k = kLo; k <= kHi; k++) {
      const aL = Math.hypot(lr[k], li[k])
      const aR = Math.hypot(rr[k], ri[k])
      const mid = Math.hypot(lr[k] + rr[k], li[k] + ri[k]) / 2
      const level = 1 - Math.abs(aL - aR) / (aL + aR + 1e-9)
      const phase = Math.max(0, (lr[k] * rr[k] + li[k] * ri[k]) / (aL * aR + 1e-9))
      c[k] = mid * level ** 4 * phase ** 2
    }
    for (let b = 0; b < bands; b++) {
      let e = 0
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) e += c[k]
      energy[t * bands + b] = e
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
  return { move, steady, frames, flux: superflux(energy, bands, frames) }
}

/** The voice gate: level to open, level to stay open, and the moving share it needs. */
const GATE_ON = 0.18
const GATE_OFF = 0.09
const SHARE = 0.45
/** The voice's level per 30fps frame, 0..1: the moving partials' energy, smoothed. */
export function voiceLevel(move: Float32Array): Float32Array {
  const top = percentile(move, 98) || 1
  return median(move, 5).map((v) => Math.min(1, v / top))
}

/** Onset bands, Hz: the consonants' range, from a low voice's body to the sibilants. */
const FLUX_LO = 150
const FLUX_HI = 5000

/**
 * SuperFlux over the centre's bands: per frame, how much louder each band got
 * than the loudest of it and its two neighbours a frame before, summed. The
 * neighbours are what keep vibrato, a pitch moving between adjacent bands, from
 * reading as a stream of onsets.
 */
function superflux(energy: Float32Array, bands: number, frames: number): Float32Array {
  const scale = 100 / (percentile(energy, 99) + 1e-9)
  const x = energy.map((e) => Math.log1p(e * scale))
  const flux = new Float32Array(frames)
  for (let t = 1; t < frames; t++) {
    let sum = 0
    for (let b = 0; b < bands; b++) {
      const p = (t - 1) * bands
      const before = Math.max(x[p + Math.max(0, b - 1)], x[p + b], x[p + Math.min(bands - 1, b + 1)])
      sum += Math.max(0, x[t * bands + b] - before)
    }
    flux[t] = sum
  }
  return flux
}

/** A frame index mirrored back inside [0, n), as the filters below read past the ends. */
const mirror = (i: number, n: number) => (i < 0 ? -i - 1 : i >= n ? 2 * n - i - 1 : i)

/** Onset threshold over the local average, in standard deviations of the flux. */
const ONSET_DELTA = 0.5
/** An onset is the highest flux within this many frames either side. */
const ONSET_PEAK = 3
/** The local average it must clear spans this many frames either side. */
const ONSET_AVERAGE = 10
/** Two onsets closer than this (frames) are one syllable. */
const ONSET_MIN_GAP = 4

/** The frames a syllable starts on. */
function onsets(flux: Float32Array): number[] {
  const n = flux.length
  let mean = 0
  for (const v of flux) mean += v
  mean /= n || 1
  let sd = 0
  for (const v of flux) sd += (v - mean) ** 2
  const delta = ONSET_DELTA * Math.sqrt(sd / (n || 1))
  const out: number[] = []
  for (let t = 0; t < n; t++) {
    let top = 0
    for (let k = t - ONSET_PEAK; k <= t + ONSET_PEAK; k++) top = Math.max(top, flux[mirror(k, n)])
    if (flux[t] !== top) continue
    let avg = 0
    for (let k = t - ONSET_AVERAGE; k <= t + ONSET_AVERAGE; k++) avg += flux[mirror(k, n)]
    if (flux[t] < avg / (2 * ONSET_AVERAGE + 1) + delta) continue
    if (out.length && t - out[out.length - 1] < ONSET_MIN_GAP) continue
    out.push(t)
  }
  return out
}

/** The open vowel follows its onset within this many frames: the apex is the voice's loudest frame there. */
const APEX = 4
/** A gap this long (frames) between onsets ends a phrase. */
const PHRASE_GAP = 12
/** Between syllables of a phrase the mouth dips to this share of the next syllable. */
const PHRASE_FLOOR = 0.25
/** After a phrase's last syllable the mouth stays open while she sings, up to this many frames, */
const PHRASE_HOLD = 20
/** then closes over this many. */
const PHRASE_CLOSE = 6
/** A syllable's width: the voice's level against this, square-rooted, never under AMP_MIN of it. */
const AMP_FULL = 0.8
const AMP_MIN = 0.15

/** A cue (a lyric line's start) with no onset this close to it, in frames, starts a syllable itself. */
const CUE_REACH = 6

/**
 * Per 30fps frame, how open the mouth is, 0..1: keys at each sung syllable's
 * onset and apex. With lyrics, `allowed` is where else a syllable may start (the
 * lyric syllables' windows), and `cues` are the lines' starts: a line sung
 * straight on from a held note has no onset of its own, so its start is one.
 */
export function mouthFromVocal(
  move: Float32Array,
  steady: Float32Array,
  flux: Float32Array,
  allowed?: Uint8Array,
  cues: number[] = [],
): Float32Array {
  const n = move.length
  const level = voiceLevel(move)
  const share = median(
    move.map((m, i) => m / (m + steady[i] + 1e-9)),
    9,
  )
  const sung = new Uint8Array(n)
  let gate = false
  for (let t = 0; t < n; t++) {
    gate = gate ? level[t] > GATE_OFF : level[t] > GATE_ON && share[t] > SHARE
    sung[t] = gate ? 1 : 0
  }
  const may = (t: number) => (sung[t] || sung[Math.min(n - 1, t + APEX)]) && (!allowed || allowed[t] || allowed[Math.min(n - 1, t + APEX)])
  const found = onsets(flux.subarray(0, n))
  const cued = cues.filter((c) => c >= 0 && c < n && sung[c] && !found.some((t) => Math.abs(t - c) <= CUE_REACH))
  const starts = [...found, ...cued].sort((a, b) => a - b).filter(may)
  const keys: [number, number][] = []
  starts.forEach((t, i) => {
    const prev = i > 0 ? starts[i - 1] : null
    const next = i + 1 < starts.length ? starts[i + 1] : null
    // The vowel is where the voice is loudest after the consonant, before the next syllable.
    let apex = Math.min(n - 1, t + 1)
    for (let k = apex + 1; k <= Math.min(n - 1, t + APEX, next === null ? n : next - 1); k++) if (level[k] > level[apex]) apex = k
    let loud = 0
    for (let k = t; k <= Math.min(n - 1, apex + 2); k++) loud = Math.max(loud, level[k])
    const width = Math.min(1, Math.max(loud, AMP_MIN) / AMP_FULL) ** 0.5
    keys.push(prev === null || t - prev >= PHRASE_GAP ? [Math.max(0, t - 1), 0] : [t, PHRASE_FLOOR * width])
    keys.push([apex, width])
    if (next === null || next - t >= PHRASE_GAP) {
      let end = apex
      // With lyrics the close is over by the time their window ends.
      const holds = (f: number) => sung[f] && (!allowed || allowed[Math.min(n - 1, f + PHRASE_CLOSE)])
      while (end + 1 < n && holds(end + 1) && (next === null || end + 1 < next - 1) && end - apex < PHRASE_HOLD) end++
      keys.push([Math.min(n - 1, end + PHRASE_CLOSE), 0])
    }
  })
  keys.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const mouth = new Float32Array(n)
  for (let i = 1; i < keys.length; i++) {
    const [f0, w0] = keys[i - 1]
    const [f1, w1] = keys[i]
    if (f1 <= f0) continue
    for (let f = f0; f <= f1; f++) mouth[f] = w0 + ((w1 - w0) * (f - f0)) / (f1 - f0)
  }
  return mouth
}

/** The vowels hand-keyed motions use, and how often: the six reference makers' average, by weight. */
const VOWEL_MIX: [string, number][] = [
  ["あ", 0.37],
  ["え", 0.2],
  ["お", 0.15],
  ["い", 0.15],
  ["う", 0.13],
]

/**
 * Each syllable's vowel: the mouth is cut at its dips, and `choose` names the
 * vowel of each piece from its first frame to the next dip. Without it, every
 * piece draws a vowel from VOWEL_MIX on a fixed seed, so one song always gets
 * the same mouth. The vowel changes across VOWEL_BLEND frames at the dip, where
 * the mouth is least open.
 */
function vowelsOf(mouth: Float32Array, choose?: (start: number, end: number) => string): Map<string, Float32Array> {
  const n = mouth.length
  let seed = 0x9e3779b9
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  const draw = () => {
    let r = random()
    for (let k = 0; k < VOWEL_MIX.length; k++) if ((r -= VOWEL_MIX[k][1]) < 0) return k
    return 0
  }
  const cuts = [0]
  for (let t = 1; t < n - 1; t++) if (mouth[t] <= mouth[t - 1] && mouth[t] < mouth[t + 1]) cuts.push(t)
  cuts.push(n)
  const names: string[] = VOWEL_MIX.map(([name]) => name)
  const pick = new Uint8Array(n)
  for (let i = 0; i + 1 < cuts.length; i++) {
    const name = choose ? choose(cuts[i], cuts[i + 1]) : names[draw()]
    let v = names.indexOf(name)
    if (v < 0) v = names.push(name) - 1
    pick.fill(v, cuts[i], cuts[i + 1])
  }
  const out = new Map<string, Float32Array>()
  const h = VOWEL_BLEND >> 1
  names.forEach((name, v) => {
    const c = new Float32Array(n)
    for (let t = 0; t < n; t++) {
      if (mouth[t] <= 0) continue
      let share = 0
      for (let j = t - h; j <= t + h; j++) share += pick[Math.max(0, Math.min(n - 1, j))] === v ? 1 : 0
      c[t] = (share / VOWEL_BLEND) * mouth[t]
    }
    out.set(name, c)
  })
  return out
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

/** The vowel tracks for a decoded song. */
export function lipSyncFromAudio(buffer: AudioBuffer): { tracks: Map<string, MorphKeyframe[]>; frameCount: number } {
  const [left, right] = channels(buffer)
  const { move, steady, frames, flux } = vocalEnergy(left, right, buffer.sampleRate)
  const mouth = mouthFromVocal(move, steady, flux)
  const tracks = new Map<string, MorphKeyframe[]>()
  for (const [name, curve] of vowelsOf(mouth)) if (curve.some((w) => w > 0)) tracks.set(name, keysOfCurve(name, curve))
  return { tracks, frameCount: frames }
}

/** Seconds either side of a lyric syllable where the voice may open the mouth. */
const LYRIC_PAD = 0.2
/** Frames over which one vowel's shape turns into the next. */
const VOWEL_BLEND = 3

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
  const { move, steady, frames, flux } = vocalEnergy(left, right, buffer.sampleRate)
  const spans = lyricSpans(lines)
  const frame = (t: number) => Math.max(0, Math.min(frames, Math.round(t * FPS)))
  // A syllable may start where a lyric syllable is sung, give or take LYRIC_PAD.
  const sung = new Uint8Array(frames)
  for (const sp of spans) sung.fill(1, frame(sp.t0 - LYRIC_PAD), frame((sp.relEnd ?? sp.t1) + LYRIC_PAD))
  const cues = lines.map((l) => Math.round(l.start * FPS))
  const mouth = mouthFromVocal(move, steady, flux, sung, cues)
  // Each syllable wears the vowel of the lyric syllable its widest frame falls
  // in: the latest to start by then.
  const vowelAt = (f: number) => {
    let at = -1
    for (let i = 0; i < spans.length && spans[i].t0 * FPS <= f; i++) at = i
    return at < 0 ? "あ" : visemeMorph(spans[at].viseme)
  }
  const choose = (a: number, b: number) => {
    let top = a
    for (let t = a; t < b; t++) if (mouth[t] > mouth[top]) top = t
    return vowelAt(top)
  }
  const tracks = new Map<string, MorphKeyframe[]>()
  for (const [name, curve] of vowelsOf(mouth, choose)) if (curve.some((w) => w > 0)) tracks.set(name, keysOfCurve(name, curve))
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
