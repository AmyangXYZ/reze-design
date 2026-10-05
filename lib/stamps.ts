// Stamp sounds — a foot that lands on the floor makes a sound.
//
// MEASURED FROM THE MESH, ANALYSED AHEAD. The clip is posed frame by frame and
// only the SOLES are skinned on the CPU (traceSoles); the landings are then
// found in that trace as a whole (detectStamps), and played by scheduling each
// one on the audio clock ahead of time (hooks/use-stamps). Two earlier
// versions are why:
//
//   足ＩＫ's height is where the ankle is TOLD to go — higher on tiptoe, in
//   heels, in a crouch — and says nothing about which part of the shoe touches
//   the floor or when. The sole does.
//
//   Detecting LIVE, frame by frame as the scene played, could only decide
//   with what had happened so far, and could only start the sound after the
//   frame that showed it — a frame late, plus the output latency, every time.
//   With the whole trace in hand a landing is placed at the instant the sole
//   meets the floor, between frames, and scheduled so it is HEARD then.
//
// Everything here is in the MODEL's own space and its own size: heights are
// measured from where its soles rest in the bind pose, in units of a tenth of
// its leg. MMD motions are authored against that floor, so a character moved
// onto a raised stage, or scaled, lands exactly as it did at the origin.

import type { Model } from "reze-engine"

/** Floats per vertex in Model.getVertices(); position is the first three. */
const STRIDE = 8
const SOLE = 0.22 // the lowest fraction of a foot's rest height that is its sole
const PER_PART = 40 // vertices skinned per heel or toe; the lowest are enough

// A foot's vertices are the ones whose heaviest weight is on a bone below the
// shin. Japanese names first — nearly every PMX — then the common English ones.
const FOOT_BONE = [
  /^(左|右)(足首|つま先|足先)/,
  /^(left|right)[ _]?(ankle|foot|toe)/i,
  /(ankle|foot|toe)[ _.]?(l|r)$/i,
]
const HIP_BONE = [/^(左|右)足(D)?$/, /^(left|right)[ _]?(leg|upleg|thigh)$/i, /(leg|thigh)[ _.]?(l|r)$/i]

/** 0 for a left bone, 1 for a right one, -1 when the name is neither kind. */
function side(name: string, patterns: RegExp[]): number {
  if (!patterns.some((re) => re.test(name))) return -1
  return /^左|^left|[ _.]?l$/i.test(name) && !/^右|^right/i.test(name) ? 0 : 1
}

/** Which vertices are measured, and the model's own floor and scale. */
export interface SoleProbe {
  /** Vertex indices: left heel, left toe, right heel, right toe. */
  parts: number[][]
  /** Height of the soles in the bind pose, model space — the floor. */
  floor: number
  /** One tenth of the leg, in model units: ~1 on a standard MMD model. */
  unit: number
}

/** Finds the soles. Null when the model has no feet this can recognise. */
export function soleProbe(model: Model): SoleProbe | null {
  const bones = model.getSkeleton().bones
  const verts = model.getVertices()
  const { joints, weights } = model.getSkinning()
  const footSide = bones.map((b) => side(b.name, FOOT_BONE))
  const feet: number[][] = [[], []]
  for (let v = 0; v < joints.length / 4; v++) {
    let best = 0
    for (let k = 1; k < 4; k++) if (weights[v * 4 + k] > weights[v * 4 + best]) best = k
    const s = footSide[joints[v * 4 + best]]
    if (s >= 0) feet[s].push(v)
  }
  if (!feet[0].length && !feet[1].length) return null
  const y = (v: number) => verts[v * STRIDE + 1]
  const z = (v: number) => verts[v * STRIDE + 2]
  let floor = Infinity
  const parts = feet.flatMap((foot) => {
    if (!foot.length) return [[], []]
    let lo = Infinity
    let hi = -Infinity
    for (const v of foot) {
      lo = Math.min(lo, y(v))
      hi = Math.max(hi, y(v))
    }
    floor = Math.min(floor, lo)
    const sole = foot.filter((v) => y(v) <= lo + (hi - lo) * SOLE)
    let zlo = Infinity
    let zhi = -Infinity
    for (const v of sole) {
      zlo = Math.min(zlo, z(v))
      zhi = Math.max(zhi, z(v))
    }
    // MMD models face -Z: the toe is the smaller z.
    const mid = (zlo + zhi) / 2
    const lowest = (part: number[]) => part.sort((a, b) => y(a) - y(b)).slice(0, PER_PART)
    return [lowest(sole.filter((v) => z(v) > mid)), lowest(sole.filter((v) => z(v) <= mid))]
  })
  // The leg: from the hip bone's rest height down to the floor. The inverse
  // bind matrix of an unrotated bone carries minus its rest position.
  const inv = model.getBoneInverseBindMatrices()
  let hip = 0
  bones.forEach((b, i) => {
    if (side(b.name, HIP_BONE) >= 0) hip = Math.max(hip, -inv[i * 16 + 13])
  })
  const leg = hip > floor ? hip - floor : 10
  return { parts, floor, unit: leg / 10 }
}

/**
 * Sole heights over a clip: per frame, the lowest point of each heel and toe
 * above the model's floor, in probe units. Infinity where a foot has no sole.
 */
export interface SoleTrace {
  fps: number
  /** [left heel, left toe, right heel, right toe], one value per frame. */
  parts: Float32Array[]
}

/** Measures the model's CURRENT pose into frame `i` of a trace. */
export function measureSoles(model: Model, probe: SoleProbe, trace: SoleTrace, i: number): void {
  const verts = model.getVertices()
  const { joints, weights } = model.getSkinning()
  const world = model.getWorldMatrices()
  const inv = model.getBoneInverseBindMatrices()
  // Model space, not world: the bone's world matrix here is the skeleton's,
  // before the scene placement — see the header.
  for (let p = 0; p < 4; p++) {
    let min = Infinity
    for (const v of probe.parts[p]) {
      const x = verts[v * STRIDE]
      const y = verts[v * STRIDE + 1]
      const z = verts[v * STRIDE + 2]
      let wy = 0
      for (let k = 0; k < 4; k++) {
        const w = weights[v * 4 + k]
        if (!w) continue
        const j = joints[v * 4 + k]
        const m = world[j].values
        const o = j * 16
        // Row 1 of (world × inverseBind) applied to the rest position.
        const rx = inv[o] * x + inv[o + 4] * y + inv[o + 8] * z + inv[o + 12]
        const ry = inv[o + 1] * x + inv[o + 5] * y + inv[o + 9] * z + inv[o + 13]
        const rz = inv[o + 2] * x + inv[o + 6] * y + inv[o + 10] * z + inv[o + 14]
        wy += w * (m[1] * rx + m[5] * ry + m[9] * rz + m[13])
      }
      min = Math.min(min, wy / 255)
    }
    trace.parts[p][i] = (min - probe.floor) / probe.unit
  }
}

export function newTrace(frames: number, fps: number): SoleTrace {
  return { fps, parts: [0, 1, 2, 3].map(() => new Float32Array(frames).fill(Infinity)) }
}

/** How many frames a trace of `duration` seconds at `fps` holds. */
export function traceLength(duration: number, fps: number): number {
  return Math.max(1, Math.floor(duration * fps) + 1)
}

/**
 * Poses frames [from, to) of the clip and measures each, then puts the clip
 * back where it was — stopping early once `deadline` (a performance.now()
 * time) has passed. Returns the next frame to do. Synchronous: nothing renders
 * between the seeks, so the scrub is never seen, and a slice a few
 * milliseconds long per frame keeps the page responsive on a long dance.
 */
export function traceSlice(
  model: Model,
  probe: SoleProbe,
  trace: SoleTrace,
  from: number,
  to: number,
  ik = true,
  deadline = Infinity,
): number {
  const was = model.getAnimationProgress().current
  let i = from
  while (i < to) {
    model.seek(i / trace.fps)
    model.update(0, ik)
    measureSoles(model, probe, trace, i)
    i++
    if ((i & 3) === 0 && performance.now() >= deadline) break
  }
  model.seek(was)
  model.update(0, ik)
  return i
}

// ── Detection ───────────────────────────────────────────────────────────────
//
// Heights below are in probe units — a tenth of the leg, about 8cm on a real
// dancer — and times in seconds.
//
// A LANDING is a DESCENT that ends at the floor. Each heel and toe is cut into
// its rises and falls (ignoring wiggles under HYST), and a fall counts when it
// bottoms out at the floor: at or under TOUCH, or hovering just above it (up
// to HOVER) and staying there. Working from descents rather than from "crossed
// a height" is what lets one rule cover a stomp through the floor (MMD feet
// sink), a step that stops a centimetre short of it, and a planted foot that
// wobbles without ever leaving.
//
// WHEN it lands is where the sole meets the floor — the trace is crossed
// between frames — or, for a foot that stops just short and creeps the rest,
// the moment it stopped (SLOW): that is the step the eye sees.
//
// HOW HARD is how fast it arrived (the speed over the last LOOK seconds, on a
// log scale from V_SOFT to V_HARD), scaled down for a drop too small to see
// much of, and never below what a clearly visible step deserves however gently
// it was eased onto the floor. Loudness follows that level over a wide range,
// so a doubtful, barely-lifted landing is nearly silent rather than a
// yes-or-no decision that is sometimes wrong out loud.
//
// ONE SOUND PER STEP. Heel and toe of one foot within MERGE seconds are one
// landing (the earlier time, the harder level). A heel dropped or a toe tapped
// while the rest of the foot stays planted is its own, quieter landing — but
// only when it is fast and lifted enough to be a tap rather than a foot
// settling. Both feet within BOTH seconds are one landing, a little louder.

const HYST = 0.05 // a rise or fall smaller than this is not one
const TOUCH = 0.12 // bottoming out at or under this is on the floor
const HOVER = 0.3 // …or under this, if it then stays put
const DWELL = 0.1 // seconds it must stay within 0.1 of that low point
const NEAR = 0.35 // how far above its low point a creeping foot may be called landed
const SLOW = 0.8 // units/s under which a foot near the floor has stopped
const SNAP = 0.04 // the sole "meets" the floor this far above it
const LOOK = 0.12 // seconds before contact the arrival speed is read over
const H_MIN = 0.15 // a drop smaller than this is not a landing
const V_SOFT = 1.5 // units/s: the quietest landing
const V_HARD = 18 // units/s: a full stomp
const TAP_H = 0.25 // a heel or toe alone must lift this far…
const TAP_V = 3 // …and come down this fast
const PLANTED = 0.2 // seconds the other half must have been down for that to apply
const MERGE = 0.16 // seconds: heel and toe of one foot are one landing
const BOTH = 0.03 // seconds: both feet are one landing
const QUIET = 0.08 // a level under this is not played

export interface Stamp {
  /** Seconds into the clip. */
  time: number
  /** 0 left, 1 right, 2 both together. */
  foot: 0 | 1 | 2
  /** How hard, 0..1. */
  level: number
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Where one sole part falls: [peak, trough] frame pairs, one per descent. */
function descents(y: Float32Array): [number, number][] {
  const out: [number, number][] = []
  let hi = 0
  let lo = 0
  let dir = 0
  let peak = -1
  for (let i = 1; i < y.length; i++) {
    if (y[i] > y[hi]) hi = i
    if (y[i] < y[lo]) lo = i
    if (dir >= 0 && y[hi] - y[i] >= HYST) {
      peak = hi
      dir = -1
      lo = i
    } else if (dir <= 0 && y[i] - y[lo] >= HYST) {
      if (dir < 0 && peak >= 0) out.push([peak, lo])
      dir = 1
      hi = i
    }
  }
  // The clip ends on a descent.
  if (dir < 0 && peak >= 0) out.push([peak, lo])
  return out
}

/** One part's landings: when, at which frame, from how high and how fast. */
function partLandings(y: Float32Array, fps: number) {
  const out: { time: number; frame: number; drop: number; speed: number }[] = []
  if (!Number.isFinite(y[0])) return out
  for (const [p, m] of descents(y)) {
    const base = Math.max(y[m], 0)
    const drop = y[p] - base
    if (drop < H_MIN) continue
    if (y[m] > TOUCH) {
      if (y[m] > HOVER) continue
      // Passed its low point without stopping: a swing, not a step.
      const end = Math.min(y.length - 1, m + Math.floor(DWELL * fps))
      let moved = false
      for (let i = m; i <= end; i++) if (y[i] > y[m] + 0.1) moved = true
      if (moved) continue
    }
    let fastest = p + 1
    for (let i = p + 1; i <= m; i++) if (y[i - 1] - y[i] > y[fastest - 1] - y[fastest]) fastest = i
    const meet = base + SNAP
    let frame = m
    let time = m / fps
    for (let i = p + 1; i <= m; i++) {
      if (y[i] <= meet) {
        frame = i
        time = y[i - 1] > meet ? (i - 1 + (y[i - 1] - meet) / (y[i - 1] - y[i])) / fps : i / fps
        break
      }
      if (i >= fastest && y[i] <= base + NEAR && (y[i - 1] - y[i]) * fps < SLOW) {
        frame = i
        time = i / fps
        break
      }
    }
    let speed = 0
    for (let i = Math.max(p, frame - Math.floor(LOOK * fps)) + 1; i <= frame; i++) {
      speed = Math.max(speed, (y[i - 1] - y[i]) * fps)
    }
    out.push({ time, frame, drop, speed })
  }
  return out
}

function levelOf(drop: number, speed: number): number {
  const bySpeed = clamp01(Math.log(Math.max(speed, 1e-6) / V_SOFT) / Math.log(V_HARD / V_SOFT))
  const seen = clamp01(0.3 + (0.7 * (drop - H_MIN)) / 0.65)
  return Math.max(bySpeed * seen, 0.5 * clamp01((drop - 0.3) / 1.2))
}

/** Every landing in frames [from, to) of a trace, in time order. */
export function detectStamps(trace: SoleTrace, from = 0, to = trace.parts[0].length): Stamp[] {
  const { fps } = trace
  const parts = trace.parts.map((p) => p.subarray(from, to))
  const start = from / fps
  const feet: Stamp[] = []
  for (const foot of [0, 1] as const) {
    const found: Stamp[] = []
    for (const part of [0, 1]) {
      const y = parts[foot * 2 + part]
      const other = parts[foot * 2 + 1 - part]
      const back = Math.floor(PLANTED * fps)
      for (const e of partLandings(y, fps)) {
        let planted = e.frame >= back
        for (let i = e.frame - back; planted && i <= e.frame; i++) if (!(other[i] <= TOUCH)) planted = false
        if (planted && (e.drop < TAP_H || e.speed < TAP_V)) continue
        const level = levelOf(e.drop, e.speed) * (planted ? 0.8 : 1)
        if (level >= QUIET) found.push({ time: start + e.time, foot, level })
      }
    }
    found.sort((a, b) => a.time - b.time)
    let last: Stamp | null = null
    for (const s of found) {
      if (last && s.time - last.time < MERGE) last.level = Math.max(last.level, s.level)
      else feet.push((last = s))
    }
  }
  feet.sort((a, b) => a.time - b.time)
  const out: Stamp[] = []
  for (const s of feet) {
    const last = out[out.length - 1]
    if (last && s.time - last.time < BOTH && last.foot !== s.foot) {
      last.level = Math.min(1, Math.max(last.level, s.level) + 0.1)
      last.foot = 2
    } else out.push(s)
  }
  return out
}

// ── Analysis, kept per clip ─────────────────────────────────────────────────
//
// AHEAD OF THE PLAYHEAD. Tracing a whole dance takes seconds of work, spent a
// few milliseconds per frame so the scene keeps drawing — and done front to
// back, a published scene that plays on arrival would dance its first half
// minute in silence. So the trace starts just behind the playhead and runs
// forward from there (several times faster than the clip plays), wrapping to
// the start, and the stamps of what HAS been traced are available at once.
// Scrub somewhere untraced and it goes there next. When every frame is in, the
// whole trace is detected once more as one piece and kept for the clip.

/** Frames per second the soles are traced at: twice the VMD clock, so a
 *  landing between two keys is placed on the curve the engine interpolates. */
const TRACE_FPS = 60
const LEAD_IN = 1 // seconds behind the playhead tracing starts, so a landing under way has its descent
const REFRESH = 1 // seconds of new trace between rebuilds of the partial list
const EDGE = 0.3 // seconds at the growing end of a partial trace that are not trusted yet

/** The clip a model is showing — the identity an analysis belongs to. Every
 *  edit and every upload arrives as a NEW clip object (Model.loadClip), so
 *  comparing it is all "has the motion changed" takes. */
function clipOf(model: Model): object | null {
  const name = model.getAnimationProgress().animationName
  return name ? model.getClip(name) : null
}

const analysed = new WeakMap<Model, { clip: object; stamps: Stamp[] }>()

/** The finished stamps for the clip this model is showing, or null. */
export function knownStamps(model: Model): Stamp[] | null {
  const hit = analysed.get(model)
  return hit && hit.clip === clipOf(model) ? hit.stamps : null
}

/** One model's analysis, a slice at a time. */
export class StampAnalysis {
  readonly clip: object | null
  /** The stamps found so far, in time order — a NEW array each time it grows. */
  stamps: Stamp[] = []
  private probe: SoleProbe | null
  private trace: SoleTrace | null = null
  private done: Uint8Array | null = null
  private left = 0
  private fresh = 0

  constructor(
    readonly model: Model,
    private ik: boolean,
  ) {
    this.clip = clipOf(model)
    this.probe = soleProbe(model)
  }

  /** False once the model has moved on to another clip: start a new analysis. */
  get current(): boolean {
    return this.clip !== null && this.clip === clipOf(this.model)
  }

  /**
   * Traces for up to `budgetMs`, from the playhead on. True once the whole
   * clip is done and its stamps are kept (knownStamps). Does nothing while
   * the pose is being edited by hand: seeking would take the edit away.
   */
  step(budgetMs: number): boolean {
    const { model, probe, clip } = this
    if (!clip) return false
    if (!probe) {
      analysed.set(model, { clip, stamps: [] })
      return true
    }
    if (model.isClipApplySuspended()) return false
    const progress = model.getAnimationProgress()
    if (!this.trace || !this.done) {
      if (!(progress.duration > 0)) return false
      const frames = traceLength(progress.duration, TRACE_FPS)
      this.trace = newTrace(frames, TRACE_FPS)
      this.done = new Uint8Array(frames)
      this.left = frames
    }
    const { trace, done } = this
    const total = done.length
    // The first untraced frame at or after the lead-in, wrapping to the start.
    const at = Math.min(total - 1, Math.max(0, Math.floor((progress.current - LEAD_IN) * TRACE_FPS)))
    let from = at
    while (from < total && done[from]) from++
    if (from === total) for (from = 0; from < at && done[from]; from++);
    let to = from
    while (to < total && !done[to]) to++
    const reached = traceSlice(model, probe, trace, from, to, this.ik, performance.now() + budgetMs)
    done.fill(1, from, reached)
    this.left -= reached - from
    this.fresh += reached - from
    if (this.left === 0) {
      this.stamps = detectStamps(trace)
      analysed.set(model, { clip, stamps: this.stamps })
      return true
    }
    if (this.fresh >= REFRESH * TRACE_FPS) {
      this.fresh = 0
      // Each traced run on its own: a landing cannot be read across a gap.
      const found: Stamp[] = []
      for (let a = 0; a < total; ) {
        if (!done[a]) {
          a++
          continue
        }
        let b = a
        while (b < total && done[b]) b++
        const trusted = b === total ? Infinity : b / TRACE_FPS - EDGE
        for (const s of detectStamps(trace, a, b)) if (s.time <= trusted) found.push(s)
        a = b
      }
      this.stamps = found
    }
    return false
  }
}

/** The stamps for the clip a model is showing, found now if not yet known. */
export function stampsNow(model: Model, ik: boolean): Stamp[] {
  const known = knownStamps(model)
  if (known) return known
  // An edit in progress holds the pose; the export that calls this has
  // nothing to wait for, and seeking is what it is about to do anyway.
  model.setClipApplySuspended(false)
  const job = new StampAnalysis(model, ik)
  // Two runs at most: playhead to the end, then the start to the playhead.
  for (let i = 0; i < 3 && !job.step(Infinity); i++);
  return knownStamps(model) ?? []
}

// ── Sound ───────────────────────────────────────────────────────────────────
//
// RECORDED, NOT SYNTHESIZED, and several takes of the same shoe on the same
// floor rather than one sample repeated: synthesized hits were tried twice and
// sounded it, and one take played a hundred times is a machine. They are one
// sprite — SLOT-second slots, softest take first — of whole footsteps with
// their own decay, cut from a CC0 recording (public/stamps/README.md;
// scripts/stamp-sounds.py says why they are left as they were recorded).
//
// A stamp's level picks BOTH the take (a hard landing uses a take that was hit
// hard: brighter, not just louder) and the gain, over RANGE_DB — wide on
// purpose, see "HOW HARD" above. The choice depends only on the stamp itself,
// never on chance, so an export sounds like the preview.

/** The sprite: heels, seven takes. */
export const STAMP_SPRITE = "/stamps/heels.wav"

const SLOT = 0.45 // seconds per take in a sprite
const RANGE_DB = 22 // the softest stamp plays this far under the hardest
const PAN = 0.15 // how far left or right of centre one foot's stamp sits

export interface StampVoice {
  /** Where in the sprite the take starts, and how long it is, in seconds. */
  offset: number
  length: number
  gain: number
  /** -1..1. */
  pan: number
}

/** How a stamp is played from a sprite `seconds` long. */
export function stampVoice(stamp: Stamp, seconds: number): StampVoice {
  const takes = Math.max(1, Math.round(seconds / SLOT))
  // The take for this level, or one either side of it, so that two landings
  // alike in level are not the same recording twice.
  const wander = (Math.floor(stamp.time * 1000) % 3) - 1
  const take = Math.max(0, Math.min(takes - 1, Math.round(stamp.level * (takes - 1)) + wander))
  return {
    offset: take * SLOT,
    length: SLOT,
    gain: 10 ** ((RANGE_DB * (stamp.level - 1)) / 20),
    pan: stamp.foot === 0 ? -PAN : stamp.foot === 1 ? PAN : 0,
  }
}

/**
 * Stamps mixed into an export's audio — onto the music when there is some, or
 * into silence `duration` seconds long when there is not. The export covers
 * the clip from `start` seconds on; stamps outside it are dropped.
 */
export async function mixStamps(
  music: AudioBuffer | null,
  stamps: Stamp[],
  start: number,
  duration: number,
  volume: number,
): Promise<AudioBuffer> {
  const rate = music?.sampleRate ?? 48000
  // Decoded by a context at the track's rate, so the sprite arrives resampled.
  const sprite = await new OfflineAudioContext(1, 1, rate).decodeAudioData(
    await (await fetch(STAMP_SPRITE)).arrayBuffer(),
  )
  const src = sprite.getChannelData(0)
  const length = music?.length ?? Math.max(1, Math.ceil(duration * rate))
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: rate })
  for (let c = 0; c < 2; c++) {
    const dst = out.getChannelData(c)
    if (music) dst.set(music.getChannelData(Math.min(c, music.numberOfChannels - 1)))
    for (const stamp of stamps) {
      const v = stampVoice(stamp, sprite.duration)
      // Equal-power pan, as the preview's StereoPannerNode does it for mono.
      const angle = ((v.pan + 1) * Math.PI) / 4
      const g = v.gain * volume * (c === 0 ? Math.cos(angle) : Math.sin(angle))
      const from = Math.round(v.offset * rate)
      const count = Math.min(Math.round(v.length * rate), src.length - from)
      const at = Math.round((stamp.time - start) * rate)
      if (at < 0) continue
      for (let i = 0; i < count && at + i < length; i++) dst[at + i] += src[from + i] * g
    }
  }
  return out
}
