// The music track, analysed once for the engine's rzAudio* effect functions:
// per-frame loudness and log-spaced spectrum bands, 60 frames a second, for the
// whole song.
//
// Computed AHEAD OF TIME and handed to the engine as one buffer — never a live
// AnalyserNode. An export steps the engine frame by frame rather than playing
// in real time, so a live analyser would see silence and every audio-reactive
// effect would quietly vanish from the exported video. Precomputed, the editor,
// the viewer and the export all sample identical numbers for identical frames.
//
// The FFT is written here rather than imported: it is forty lines, and this
// repo's engine ports Bullet physics sooner than it takes a dependency.

export type AudioAnalysis = {
  /** frames × (2 + bands): level, ONSET, then the band magnitudes, all 0..1. */
  data: Float32Array
  bands: number
  secondsPerFrame: number
}

const FPS = 60
const WINDOW = 1024
const BANDS = 32
/** The audible range worth reacting to: below 40Hz is rumble, above 14k is air. */
const F_LO = 40
const F_HI = 14000

const cache = new Map<string, AudioAnalysis>()
const inflight = new Map<string, Promise<AudioAnalysis | null>>()

/** In-place iterative radix-2 FFT. Lengths are powers of two by construction. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** The value everything is normalised against — outliers must not flatten the
 *  song, which is the timeline graphs' lesson applied here. */
function p95(values: Float32Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 1
}

async function analyze(url: string): Promise<AudioAnalysis | null> {
  const ac = new AudioContext()
  try {
    const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer())
    // Channel 0 alone, like every other analysis in the app: a stereo pass costs
    // a second walk of the buffer to move a handful of values a few percent.
    const samples = buf.getChannelData(0)
    const hop = buf.sampleRate / FPS
    const frames = Math.max(0, Math.floor((samples.length - WINDOW) / hop))
    if (frames === 0) return null

    // Hann window, precomputed once.
    const hann = new Float32Array(WINDOW)
    for (let i = 0; i < WINDOW; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WINDOW - 1)))

    // Log-spaced band edges in bin space — linear bins would spend half the
    // spectrum on frequencies nobody dances to.
    const edges = new Array<number>(BANDS + 1)
    for (let b = 0; b <= BANDS; b++) {
      const f = F_LO * Math.pow(F_HI / F_LO, b / BANDS)
      edges[b] = Math.max(1, Math.min(WINDOW / 2 - 1, Math.round((f * WINDOW) / buf.sampleRate)))
    }

    const re = new Float32Array(WINDOW)
    const im = new Float32Array(WINDOW)
    const STRIDE = 2 + BANDS
    const data = new Float32Array(frames * STRIDE)

    for (let f = 0; f < frames; f++) {
      const start = Math.floor(f * hop)
      let sum = 0
      for (let i = 0; i < WINDOW; i++) {
        const s = samples[start + i]
        sum += s * s
        re[i] = s * hann[i]
        im[i] = 0
      }
      fft(re, im)
      data[f * STRIDE] = Math.sqrt(sum / WINDOW)
      for (let b = 0; b < BANDS; b++) {
        const from = edges[b]
        const to = Math.max(from + 1, edges[b + 1])
        let mag = 0
        for (let k = from; k < to; k++) mag += Math.hypot(re[k], im[k])
        data[f * STRIDE + 2 + b] = mag / (to - from)
      }
      // ~0.7s of main thread for a full song — yielded every quarter second of
      // work, so an upload mid-session does not freeze the page.
      if (f % 600 === 599) await new Promise((r) => setTimeout(r))
    }

    // WebAudio's own temporal smoothing, applied offline: each band eases toward
    // its new value with the AnalyserNode default of 0.8 per analysis frame.
    // Shadertoy visualisers are tuned against an analyser that smooths BEFORE
    // they read it, so raw per-frame FFT — which steps a band in one frame —
    // makes a faithful port of their maths flash and jitter. Same numbers in,
    // same sluggishness, same look. The level row stays raw: it is ours, not
    // the analyser's, and effects that want it soft can average taps.
    const SMOOTHING = 0.8
    for (let c = 2; c < STRIDE; c++) {
      for (let f = 1; f < frames; f++) {
        const i = f * STRIDE + c
        data[i] = SMOOTHING * data[i - STRIDE] + (1 - SMOOTHING) * data[i]
      }
    }

    // The ONSET track: how hard the bass is RISING, per frame — the kick
    // detector, computed once here instead of once per pixel in every effect
    // that wants to react to a beat. From the smoothed bass, so it inherits the
    // same temporal feel the bands have; normalised below like every column.
    for (let f = frames - 1; f >= 1; f--) {
      const bass = (data[f * STRIDE + 2] + data[f * STRIDE + 3] + data[f * STRIDE + 4]) / 3
      const prev = (data[(f - 1) * STRIDE + 2] + data[(f - 1) * STRIDE + 3] + data[(f - 1) * STRIDE + 4]) / 3
      data[f * STRIDE + 1] = Math.max(0, bass - prev)
    }
    data[1] = 0

    // Normalise per COLUMN: the level against its own p95, each band against
    // its own. Bands fall off steeply with frequency, and one shared scale
    // would leave everything above the bass reading zero.
    const col = new Float32Array(frames)
    for (let c = 0; c < STRIDE; c++) {
      for (let f = 0; f < frames; f++) col[f] = data[f * STRIDE + c]
      const scale = 1 / Math.max(p95(col), 1e-6)
      for (let f = 0; f < frames; f++) {
        data[f * STRIDE + c] = Math.min(1, data[f * STRIDE + c] * scale)
      }
    }
    return { data, bands: BANDS, secondsPerFrame: 1 / FPS }
  } catch {
    // A track that will not decode simply is not reactive. The scene still
    // plays; rzAudio* reads zeroes.
    return null
  } finally {
    void ac.close()
  }
}

/** Analyse once per url, shared by every caller. */
export function primeAudioAnalysis(url: string): Promise<AudioAnalysis | null> {
  const hit = cache.get(url)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(url)
  if (running) return running
  const job = analyze(url).then((a) => {
    inflight.delete(url)
    if (a) cache.set(url, a)
    return a
  })
  inflight.set(url, job)
  return job
}
