// The music, as times an agent can place things at.
//
// Read from the analysis the effects already use (lib/audio-analysis: level and
// onset per frame, 60 a second), so the beats an agent schedules to are the
// same ones an audio-reactive effect pulses on.
//
// Tempo is the onset curve's autocorrelation, searched over 70–180 BPM; the
// beat grid is that period at the phase the onsets agree with most. Sections
// are stretches of similar loudness — the closest thing to verse and chorus a
// level curve can say. All of it is a guide, not a transcription: the agent
// should still look and listen through captures and the timeline.

import type { AudioAnalysis } from "@/lib/audio-analysis"

export type MusicSummary = {
  duration: number
  bpm: number | null
  /** Seconds of each beat, from the first. */
  beats: number[]
  /** Every fourth beat, starting at the strongest of the first four — a bar's downbeat. */
  downbeats: number[]
  /** The hardest hits, by time, at most `maxHits`. */
  hits: { time: number; strength: number }[]
  /** Stretches of similar loudness. */
  sections: { start: number; end: number; loudness: "quiet" | "medium" | "loud"; level: number }[]
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** Column `c` of the analysis, one value per frame. */
function column(a: AudioAnalysis, c: number): Float32Array {
  const stride = 2 + a.bands
  const n = Math.floor(a.data.length / stride)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = a.data[i * stride + c]
  return out
}

export function tempoOf(onset: Float32Array, fps: number): { period: number; phase: number } | null {
  const minLag = Math.round((fps * 60) / 180)
  const maxLag = Math.round((fps * 60) / 70)
  if (onset.length < maxLag * 4) return null
  let mean = 0
  for (const v of onset) mean += v
  mean /= onset.length
  let best = 0
  let bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = lag; i < onset.length; i++) sum += (onset[i] - mean) * (onset[i - lag] - mean)
    // A mild preference for tempos near 120, so a half or double of the real
    // tempo does not win on a near tie.
    const bias = 1 - 0.15 * Math.abs(Math.log2(((fps * 60) / lag) / 120))
    if (sum * bias > best) {
      best = sum * bias
      bestLag = lag
    }
  }
  if (bestLag === 0 || best <= 0) return null
  // Phase: the offset whose grid lands on the most onset.
  let bestPhase = 0
  let bestScore = -1
  for (let phase = 0; phase < bestLag; phase++) {
    let score = 0
    for (let i = phase; i < onset.length; i += bestLag) score += onset[i]
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }
  return { period: bestLag, phase: bestPhase }
}

export function summarizeMusic(a: AudioAnalysis, maxHits = 24): MusicSummary {
  const fps = 1 / a.secondsPerFrame
  const level = column(a, 0)
  const onset = column(a, 1)
  const duration = r2(level.length / fps)

  const tempo = tempoOf(onset, fps)
  const beats: number[] = []
  const downbeats: number[] = []
  let bpm: number | null = null
  if (tempo) {
    bpm = Math.round(((fps * 60) / tempo.period) * 10) / 10
    for (let i = tempo.phase; i < onset.length; i += tempo.period) beats.push(r2(i / fps))
    // The bar starts on whichever of the first four beats is loudest on average
    // across the song's bars.
    let start = 0
    let bestBar = -1
    for (let k = 0; k < 4; k++) {
      let s = 0
      for (let b = k; b < beats.length; b += 4) s += onset[Math.round(beats[b] * fps)] ?? 0
      if (s > bestBar) {
        bestBar = s
        start = k
      }
    }
    for (let b = start; b < beats.length; b += 4) downbeats.push(beats[b])
  }

  // Hits: local maxima of the onset curve. The onset is normalised, so a busy
  // track ties most of its peaks at full strength — picking "strongest first"
  // then just takes them in time order and the hits bunch at the start. Instead
  // the song is cut into `maxHits` equal slots and each slot gives its strongest
  // peak, so the hits cover the whole song.
  const peaks: { i: number; v: number }[] = []
  for (let i = 1; i < onset.length - 1; i++) {
    if (onset[i] > 0.35 && onset[i] >= onset[i - 1] && onset[i] > onset[i + 1]) peaks.push({ i, v: onset[i] })
  }
  const slot = onset.length / maxHits
  const chosen: { i: number; v: number }[] = []
  for (let k = 0; k < maxHits; k++) {
    let best: { i: number; v: number } | null = null
    for (const p of peaks) if (p.i >= k * slot && p.i < (k + 1) * slot && (!best || p.v > best.v)) best = p
    if (best) chosen.push(best)
  }
  const hits = chosen.sort((x, y) => x.i - y.i).map((p) => ({ time: r2(p.i / fps), strength: r2(p.v) }))

  return { duration, bpm, beats, downbeats, hits, sections: sectionsOf(level, fps) }
}

/**
 * The summary as get_music answers: sections, hits and downbeats are small and
 * always go; every beat of a whole song is not, so beats come only inside a
 * window (`from`–`to` seconds), which narrows the downbeats too. Without one,
 * bpm stands in for the beat grid.
 */
export function musicWindow(s: MusicSummary, from?: number, to?: number): Omit<MusicSummary, "beats"> & { beats?: number[] } {
  if (from === undefined && to === undefined) return { duration: s.duration, bpm: s.bpm, downbeats: s.downbeats, hits: s.hits, sections: s.sections }
  const lo = from ?? 0
  const hi = to ?? s.duration
  const inside = (t: number) => t >= lo && t <= hi
  return { ...s, beats: s.beats.filter(inside), downbeats: s.downbeats.filter(inside) }
}

/** Loudness sections: the level smoothed over two seconds, split where it
 *  crosses between thirds of its own range, short pieces merged into neighbours. */
export function sectionsOf(level: Float32Array, fps: number): MusicSummary["sections"] {
  if (level.length === 0) return []
  const win = Math.max(1, Math.round(2 * fps))
  const smooth = new Float32Array(level.length)
  let acc = 0
  for (let i = 0; i < level.length; i++) {
    acc += level[i]
    if (i >= win) acc -= level[i - win]
    smooth[i] = acc / Math.min(i + 1, win)
  }
  let lo = Infinity
  let hi = -Infinity
  for (const v of smooth) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const span = hi - lo || 1
  const band = (v: number) => ((v - lo) / span < 1 / 3 ? 0 : (v - lo) / span < 2 / 3 ? 1 : 2)
  const raw: { start: number; end: number; band: number; sum: number }[] = []
  for (let i = 0; i < smooth.length; i++) {
    const b = band(smooth[i])
    const last = raw[raw.length - 1]
    if (last && last.band === b) {
      last.end = i + 1
      last.sum += smooth[i]
    } else raw.push({ start: i, end: i + 1, band: b, sum: smooth[i] })
  }
  // Fold pieces under four seconds into the previous section.
  const minLen = 4 * fps
  const merged: typeof raw = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && s.end - s.start < minLen) {
      last.end = s.end
      last.sum += s.sum
    } else merged.push({ ...s })
  }
  const names = ["quiet", "medium", "loud"] as const
  return merged.map((s) => ({
    start: r2(s.start / fps),
    end: r2(s.end / fps),
    loudness: names[s.band],
    level: r2(s.sum / (s.end - s.start)),
  }))
}
