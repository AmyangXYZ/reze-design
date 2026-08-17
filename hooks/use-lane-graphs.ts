"use client"

// What the timeline lanes DRAW: how much a motion is moving, and how loud the
// music is, over time.
//
// Both reduce to the same thing — one number per column, already normalised to
// 0..1 — so one <LaneGraph> renders either. Both are also derived from data that
// never changes once loaded, so both are computed once and cached by identity;
// reopening the fold re-reads a cache rather than re-walking 17,000 keyframes or
// re-decoding four minutes of audio.
//
// Both run as soon as their source EXISTS, not when the fold opens. Decoding a
// four-minute track takes long enough to see, and paying for it on the click
// that opens the timeline puts the delay exactly where someone is watching. The
// lanes are mounted the whole time anyway — only their height is folded away.

import { useCallback, useEffect, useSyncExternalStore, type RefObject } from "react"
import type { Engine } from "reze-engine"

/** Columns in a lane graph. Fine enough to show phrasing, coarse enough that a
 *  four-minute clip is still one cheap pass and a handful of SVG path commands.
 *  Never more columns than the clip has frames — past that they are empty and
 *  the strip combs. */
const DENSITY_COLUMNS = 240
const PEAK_COLUMNS = 900

/**
 * Normalise against a high percentile, not the maximum.
 *
 * Both graphs have one outlier that would otherwise flatten everything else. A
 * motion keys EVERY bone on frame 0, so that column measured six times the
 * clip's mean and squashed the whole strip to a sixth of its height; music has
 * transients that do the same. Clipping the top few percent costs nothing that
 * can be read at this size and gives back the whole range.
 */
function normalise(cols: number[]): number[] {
  const sorted = [...cols].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || Math.max(...cols)
  if (!(p95 > 0)) return cols.map(() => 0)
  return cols.map((c) => Math.min(1, c / p95))
}

const densityCache = new Map<string, number[]>()
const peakCache = new Map<string, number[]>()
const peakInflight = new Map<string, Promise<number[] | null>>()

// These caches ARE an external store, so they are read as one.
//
// The first attempt kept the values in component state and set it from the
// effect that filled the cache. That is the pattern this repo's lint bans, and
// it was also wrong twice over: a lane whose clip was already cached rendered an
// empty frame first, and a value read from a mutable Map during render has no
// dependency React can see — a memoized render is free to keep handing back the
// `null` from before the walk finished, which is what left the strips blank.
// useSyncExternalStore is the mechanism for exactly this, and use-community.ts
// already reaches for it.
const listeners = new Set<() => void>()
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const publish = () => {
  for (const l of listeners) l()
}
/** Same array identity for the same data, which is what a snapshot must be. */
const NONE: number[] | null = null

/**
 * Measure a clip and fill the cache, outside of React.
 *
 * Exported so the scene loader can do this while the LOADING indicator is still
 * up. Walking a dance is tens of milliseconds of main thread, and left to the
 * hook it ran at the worst possible moment — the frame the model is revealed,
 * which is also the frame physics starts stepping, so the hitch landed in the
 * hair and the skirt where it is most visible. During loading nobody is watching
 * anything move.
 *
 * Returns whether the clip was there to measure; safe to call repeatedly, and a
 * no-op once the answer is cached.
 */
export function primeClipDensity(engine: Engine | null, modelId: string, clipName: string): boolean {
  const key = `${modelId}\u0000${clipName}`
  if (densityCache.has(key)) return true
  const model = engine?.getModel(modelId)
  if (!model) return false
  // Ask the ENGINE what it loaded, rather than matching the document's name.
  //
  // The two are not always the same string. A clip that came out of a scene
  // bundle is loaded with loadVmdFile, which registers it under the packed
  // FILE's name — content-hashed — while the row keeps the name the document
  // wrote. getClip then missed, returned null, and the strip rendered nothing
  // with no error anywhere. A model here carries one clip, so the active one is
  // the one to measure; the document's name is only a fallback for the moment
  // before playback has an opinion.
  const active = model.getAnimationProgress().animationName
  const clip = (active ? model.getClip(active) : null) ?? model.getClip(clipName)
  if (!clip || clip.frameCount <= 0) return false
  const n = Math.max(1, Math.min(DENSITY_COLUMNS, clip.frameCount))
  const cols = new Array<number>(n).fill(0)
  for (const track of clip.boneTracks.values()) {
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1].rotation
      const b = track[i].rotation
      // |dot| so the double cover does not read a quaternion and its negation —
      // the same orientation — as half a turn apart.
      const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))
      const turn = 2 * Math.acos(d)
      const from = track[i - 1].frame
      const to = track[i].frame
      const per = turn / Math.max(1, to - from)
      for (let f = from; f < to; f++) cols[Math.min(n - 1, Math.floor((f / clip.frameCount) * n))] += per
    }
  }
  densityCache.set(key, normalise(cols))
  publish()
  return true
}

/**
 * How much a motion is DOING, over time.
 *
 * Measured as how far the bones actually TURN, not how many keyframes there are.
 * Keyframe count is the obvious metric and it does not work: MMD motions are
 * baked on a regular interval, so on a real dance the count is near-uniform
 * everywhere except frame 0 — where every bone is keyed at once — and the strip
 * came out as one spike over a flat bar. Measured as rotation instead, the same
 * clip shows its phrasing plainly: a quiet intro, busy passages, the pauses
 * between them.
 *
 * Each pair of consecutive keys contributes the angle between them, SPREAD over
 * the frames it takes rather than banked at one — otherwise a slow sweep reads
 * as a single spike and a fast one as nothing.
 *
 * Bone tracks only. Morph tracks are keyed densely for lip-sync, so folding them
 * in would draw the song's syllables over the body's rhythm and call it motion.
 */
export function useClipDensity({
  engineRef,
  modelId,
  clipName,
}: {
  engineRef: RefObject<Engine | null>
  modelId: string | null
  clipName: string | null
}): number[] | null {
  const key = modelId && clipName ? `${modelId}\u0000${clipName}` : null

  useEffect(() => {
    if (!key || !modelId || !clipName || densityCache.has(key)) return
    // Polled, because the clip is handed to the engine asynchronously and the
    // first look can land before it exists. Bounded, because a clip that has not
    // arrived in this long is not coming and a forever-timer is a leak.
    let tries = 0
    const read = () => primeClipDensity(engineRef.current, modelId, clipName)
    if (read()) return
    const timer = setInterval(() => {
      if (read() || ++tries > 40) clearInterval(timer)
    }, 300)
    return () => clearInterval(timer)
  }, [key, modelId, clipName, engineRef])

  const snapshot = useCallback(() => (key ? (densityCache.get(key) ?? NONE) : NONE), [key])
  return useSyncExternalStore(subscribe, snapshot, () => NONE)
}

/**
 * How much a FACE is doing, over time.
 *
 * The same idea as the motion strip, deliberately not the same measure. Morph
 * tracks are keyed densely — lip-sync keys every few frames — so counting keys
 * draws a flat bar, exactly the failure the bone version documents above.
 * Summing how far the WEIGHTS travel shows the phrasing instead: a still face
 * between lines, a burst through a sung phrase.
 *
 * Keyed by the morph FILE as well as the clip, because loading a morph does not
 * change the clip's NAME — only its morph tracks — so a cache keyed by the clip
 * alone would keep drawing the previous file's shape forever.
 */
export function primeMorphDensity(
  engine: Engine | null,
  modelId: string,
  clipName: string,
  morphName: string,
): boolean {
  const key = `${modelId}\u0000${clipName}\u0000${morphName}`
  if (densityCache.has(key)) return true
  const model = engine?.getModel(modelId)
  if (!model) return false
  const active = model.getAnimationProgress().animationName
  const clip = (active ? model.getClip(active) : null) ?? model.getClip(clipName)
  if (!clip || clip.frameCount <= 0) return false
  const n = Math.max(1, Math.min(DENSITY_COLUMNS, clip.frameCount))
  const cols = new Array<number>(n).fill(0)
  for (const track of clip.morphTracks.values()) {
    for (let i = 1; i < track.length; i++) {
      const from = track[i - 1].frame
      const to = track[i].frame
      // Spread over the frames it takes, like the bone measure: a slow fade and
      // a snap of the same size are different things, and banking both at one
      // frame would draw them the same.
      const per = Math.abs(track[i].weight - track[i - 1].weight) / Math.max(1, to - from)
      for (let f = from; f < to; f++) cols[Math.min(n - 1, Math.floor((f / clip.frameCount) * n))] += per
    }
  }
  densityCache.set(key, normalise(cols))
  publish()
  return true
}

export function useMorphDensity({
  engineRef,
  modelId,
  clipName,
  morphName,
}: {
  engineRef: RefObject<Engine | null>
  modelId: string | null
  clipName: string | null
  morphName: string | null
}): number[] | null {
  const key = modelId && clipName && morphName ? `${modelId}\u0000${clipName}\u0000${morphName}` : null

  useEffect(() => {
    if (!key || !modelId || !clipName || !morphName || densityCache.has(key)) return
    let tries = 0
    const read = () => primeMorphDensity(engineRef.current, modelId, clipName, morphName)
    if (read()) return
    const timer = setInterval(() => {
      if (read() || ++tries > 40) clearInterval(timer)
    }, 300)
    return () => clearInterval(timer)
  }, [key, modelId, clipName, morphName, engineRef])

  const snapshot = useCallback(() => (key ? (densityCache.get(key) ?? NONE) : NONE), [key])
  return useSyncExternalStore(subscribe, snapshot, () => NONE)
}

/**
 * Where the camera's keys sit.
 *
 * Counted, not measured as movement — the opposite of the motion lane, and for
 * the opposite reason. A dance is baked on a regular interval, so its keyframe
 * count says nothing; a camera track is authored by hand and sparse, so where
 * its keys ARE is exactly where the cuts and the moves are. Counting is the
 * signal here, and the poses stay inside the engine.
 */
export function useCameraDensity({
  engineRef,
  clipName,
}: {
  engineRef: RefObject<Engine | null>
  clipName: string | null
}): number[] | null {
  const key = clipName ? `camera\u0000${clipName}` : null

  useEffect(() => {
    if (!key || densityCache.has(key)) return
    let tries = 0
    const read = (): boolean => {
      const frames = engineRef.current?.getCameraVmdKeyframes() ?? []
      if (frames.length < 2) return false
      const last = frames[frames.length - 1]
      if (last <= 0) return false
      const n = Math.max(1, Math.min(DENSITY_COLUMNS, last))
      const cols = new Array<number>(n).fill(0)
      for (const f of frames) cols[Math.min(n - 1, Math.floor((f / last) * n))] += 1
      densityCache.set(key, normalise(cols))
      publish()
      return true
    }
    if (read()) return
    const timer = setInterval(() => {
      if (read() || ++tries > 40) clearInterval(timer)
    }, 300)
    return () => clearInterval(timer)
  }, [key, engineRef])

  const snapshot = useCallback(() => (key ? (densityCache.get(key) ?? NONE) : NONE), [key])
  return useSyncExternalStore(subscribe, snapshot, () => NONE)
}

/**
 * Decode a track and fill the peak cache, outside of React.
 *
 * Exported for the same reason primeClipDensity is: decodeAudioData itself is
 * off-thread, but reducing several million samples to columns is not, and that
 * pass landed in the same frames as the model's reveal.
 *
 * Shared in-flight, so the loader priming it and a lane asking for it are one
 * decode rather than two.
 */
export function primeAudioPeaks(url: string): Promise<void> {
  if (peakCache.has(url)) return Promise.resolve()
  const job =
    peakInflight.get(url) ??
    (async () => {
      // AudioContext, not OfflineAudioContext: this only decodes, and an offline
      // context wants a length up front that we do not know yet. Neither exists
      // in a Worker, which is why this stays here.
      const ac = new AudioContext()
      try {
        const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer())
        const cols = new Array<number>(PEAK_COLUMNS).fill(0)
        const per = Math.max(1, Math.floor(buf.length / PEAK_COLUMNS))
        // Channel 0 alone. A stereo pass would cost a second walk of the whole
        // buffer to move a handful of columns a few percent.
        const data = buf.getChannelData(0)
        for (let c = 0; c < PEAK_COLUMNS; c++) {
          const from = c * per
          const to = Math.min(data.length, from + per)
          let sum = 0
          for (let i = from; i < to; i++) sum += data[i] * data[i]
          cols[c] = to > from ? Math.sqrt(sum / (to - from)) : 0
        }
        return normalise(cols)
      } catch {
        // A track that will not decode simply has no graph. The lane still shows
        // its name and its length, which is most of the point.
        return null
      } finally {
        void ac.close()
      }
    })()
  peakInflight.set(url, job)
  return job.then((values) => {
    peakInflight.delete(url)
    if (values) {
      peakCache.set(url, values)
      publish()
    }
  })
}

/**
 * Music, as loudness over time.
 *
 * RMS per column, not peak. Peak is the obvious choice and it is wrong at this
 * size: a four-minute track across a few hundred columns is most of a second
 * each, and the loudest single sample in any second of mastered music is
 * essentially the track's own maximum — so every column came out full height and
 * the waveform rendered as a solid bar. RMS follows the energy actually in each
 * window, which is what makes a waveform look like the song.
 *
 * Decoding is the only expensive thing either graph does — a four-minute track
 * is tens of megabytes of Float32 — so the samples are reduced to one value per
 * column and the buffer is dropped on the spot.
 */
export function useAudioPeaks({ url }: { url: string | null }): number[] | null {
  useEffect(() => {
    if (url) void primeAudioPeaks(url)
  }, [url])

  const snapshot = useCallback(() => (url ? (peakCache.get(url) ?? NONE) : NONE), [url])
  return useSyncExternalStore(subscribe, snapshot, () => NONE)
}
