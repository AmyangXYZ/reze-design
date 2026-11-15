// Pitch-preserving time-stretch for an export's music at a playback speed
// other than 1× (settings.playback, Engine.setTimeScale).
//
// The preview gets this for free: the <audio> element plays at playbackRate
// with preservesPitch. An export has no element. It has the decoded slice,
// and it must hand the muxer a track exactly as long as the video, the same
// tune at the same pitch, just slower or faster. Resampling would do the
// length and ruin the pitch (half speed, an octave down).
//
// WSOLA (waveform-similarity overlap-add): cut the input into windows taken
// every Hs × speed samples and lay them down every Hs samples. A window is not
// taken exactly at its nominal spot but nudged within ±SEARCH to where it best
// continues the one before (cross-correlation), so the overlaps add in phase
// rather than beating against each other, which is what a plain overlap-add
// sounds like (a metallic warble). The alignment is found on the channels'
// mix and applied to every channel, so the stereo image holds.
//
// The search is coarse-to-fine: every COARSE-th lag over every COARSE-th
// sample, then each lag around the best over every sample. A 3-minute song
// takes well under a second; a full search would take most of a minute.

/** Window length, seconds. 40 ms is long enough for a bass note's period and
 *  short enough that drum hits do not smear. */
const WINDOW_S = 0.04
/** How far a window may move from its nominal spot, seconds. */
const SEARCH_S = 0.012
/** The coarse pass's stride, in samples. */
const COARSE = 8

/**
 * The channels stretched to `round(length / speed)` samples: speed 0.5 gives
 * twice as many, 2 half as many, the pitch untouched. Speed 1 returns copies.
 */
export function timeStretch(
  channels: readonly Float32Array[],
  sampleRate: number,
  speed: number,
): Float32Array<ArrayBuffer>[] {
  const inLen = channels[0]?.length ?? 0
  if (!(speed > 0) || Math.abs(speed - 1) < 1e-6 || inLen === 0) return channels.map((c) => Float32Array.from(c))
  const outLen = Math.max(1, Math.round(inLen / speed))
  const N = Math.max(64, 2 * Math.round((WINDOW_S * sampleRate) / 2))
  const Hs = N / 2
  const delta = Math.max(COARSE, Math.round(SEARCH_S * sampleRate))

  // Periodic Hann: at 50% overlap the windows sum to exactly 1.
  const w = new Float32Array(N)
  for (let j = 0; j < N; j++) w[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N)

  // The mix the alignment is found on.
  const mono = new Float32Array(inLen)
  for (const c of channels) for (let i = 0; i < inLen; i++) mono[i] += c[i]

  const out = channels.map(() => new Float32Array(outLen + N))
  const wsum = new Float32Array(outLen + N)
  const maxPos = Math.max(0, inLen - N)
  let prev = 0

  for (let k = 0; k * Hs < outLen; k++) {
    const nominal = Math.min(maxPos, Math.round(k * Hs * speed))
    let pos = nominal
    if (k > 0) {
      // What would naturally follow the previous window: its next Hs samples.
      const tmpl = prev + Hs
      const lo = Math.max(0, nominal - delta)
      const hi = Math.min(maxPos, nominal + delta)
      const score = (p: number, step: number) => {
        let s = 0
        for (let j = 0; j < Hs && tmpl + j < inLen; j += step) s += mono[p + j] * mono[tmpl + j]
        return s
      }
      let best = nominal
      let bestScore = -Infinity
      for (let p = lo; p <= hi; p += COARSE) {
        const s = score(p, COARSE)
        if (s > bestScore) {
          bestScore = s
          best = p
        }
      }
      const fineLo = Math.max(lo, best - COARSE)
      const fineHi = Math.min(hi, best + COARSE)
      bestScore = -Infinity
      for (let p = fineLo; p <= fineHi; p++) {
        const s = score(p, 1)
        if (s > bestScore) {
          bestScore = s
          pos = p
        }
      }
    }
    const at = k * Hs
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c]
      const dst = out[c]
      for (let j = 0; j < N && pos + j < inLen; j++) dst[at + j] += src[pos + j] * w[j]
    }
    for (let j = 0; j < N; j++) wsum[at + j] += w[j]
    prev = pos
  }

  // Normalise by the windows actually laid down: exact in the middle, and it
  // keeps the first and last half-window from fading.
  return out.map((o) => {
    const r = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) r[i] = wsum[i] > 1e-3 ? o[i] / wsum[i] : o[i]
    return r
  })
}
