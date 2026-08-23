// Clip editing, out of reze-studio.
//
// Everything here operates on an engine `AnimationClip` — keyframe insert,
// interpolation templates, model-swap retention, track simplification. It is
// the half of reze-studio's lib/utils.ts that is about the DOCUMENT rather than
// about that app, moved here whole so the two stay comparable when either
// changes. `cn` stayed behind; design has its own in lib/utils.ts.
//
// Frames, not seconds. A VMD is keyed on integer frames at 30fps and every
// number in this file is in that space; the scene's clock is seconds, and
// crossing between the two is the caller's job (see context/clip-editor.ts).
import type { AnimationClip, BoneInterpolation, BoneKeyframe, ControlPoint, MorphKeyframe, Model } from "reze-engine"
import { Quat, Vec3, interpolateControlPoints } from "reze-engine"


/** MMD's frame rate. A VMD stores integer frames and nothing else, so every
 *  crossing between the scene clock (seconds) and this file's numbers goes
 *  through here rather than a literal 30. */
export const FPS = 30

export const framesToSeconds = (frame: number): number => frame / FPS
export const secondsToFrames = (seconds: number): number => seconds * FPS

// ─── Clip length (ruler / export end vs last key) ─────────────────────────
/** New / reset studio clips start here so transport + ruler work before any keys (30fps → 4s). */
export const DEFAULT_STUDIO_CLIP_FRAMES = 120

export function maxKeyframeFrameInClip(clip: AnimationClip): number {
  let m = 0
  for (const t of clip.boneTracks.values()) for (const k of t) m = Math.max(m, k.frame)
  for (const t of clip.morphTracks.values()) for (const k of t) m = Math.max(m, k.frame)
  return m
}

/** Keep export end ≥ last key; run after any key add/move/delete so duration never truncates content. */
export function clipAfterKeyframeEdit(clip: AnimationClip): AnimationClip {
  const lastKey = maxKeyframeFrameInClip(clip)
  return { ...clip, frameCount: Math.max(1, clip.frameCount, lastKey) }
}

export function emptyStudioClip(): AnimationClip {
  return { boneTracks: new Map(), morphTracks: new Map(), frameCount: DEFAULT_STUDIO_CLIP_FRAMES }
}

/**
 * The clip's length as the BODY MOTION defines it, with the expression file
 * allowed to set it only when there is no body motion at all.
 *
 * An expression VMD dresses the motion clip rather than becoming one, and the
 * engine grows the clip to cover whichever of the two runs longer — deliberately,
 * so a face performance is never truncated to the dance. That is the right
 * default for PLAYING a clip and the wrong one for measuring it: 表情モーション
 * files routinely carry a trailing neutral key thousands of frames past the last
 * step, and the whole editor is drawn against this number. The ruler then runs
 * three times the length of the dance, the scrub thumb covers a third of the
 * bar, and the rest is empty.
 *
 * So the motion is the authority on how long the take is. Its length is its last
 * bone key, which is exactly what the engine would have computed had the file
 * been loaded on its own.
 *
 * With no bone keys — an expression loaded before any motion, or instead of one
 * — there is nothing to measure against and the morph's own length stands. Same
 * for a single-pose VMD, whose last key is frame 0: trimming to that would leave
 * a face performance with no timeline to play on.
 *
 * Returns 0 when the clip carries no body motion, which is also how a caller
 * asks whether there is one — the timeline's axis uses it that way to decide
 * whether a camera VMD may extend the ruler past the dance.
 */
export function motionFrameCount(clip: AnimationClip): number {
  let motion = 0
  for (const t of clip.boneTracks.values()) for (const k of t) motion = Math.max(motion, k.frame)
  return motion
}

/** @see motionFrameCount — the clip with that length applied. Returns the clip
 *  itself when there is nothing to trim, so callers can compare by identity. */
export function clipTrimmedToMotion(clip: AnimationClip): AnimationClip {
  const motion = motionFrameCount(clip)
  if (motion <= 0 || clip.frameCount <= motion) return clip
  return { ...clip, frameCount: motion }
}

/** Keep only tracks whose bones/morphs exist on the new model — used both for
 *  a mid-session PMX swap and for restoring a persisted draft onto whichever
 *  model booted (the two may have drifted out of sync). */
export function clipRetainedForModel(
  clip: AnimationClip,
  boneNames: ReadonlySet<string>,
  morphNames: ReadonlySet<string>,
): AnimationClip {
  const boneTracks = new Map<string, BoneKeyframe[]>()
  for (const [name, track] of clip.boneTracks) {
    if (!boneNames.has(name) || !track?.length) continue
    boneTracks.set(
      name,
      track.map((kf) => ({ ...kf })),
    )
  }
  const morphTracks = new Map<string, MorphKeyframe[]>()
  for (const [name, track] of clip.morphTracks) {
    if (!morphNames.has(name) || !track?.length) continue
    morphTracks.set(
      name,
      track.map((kf) => ({ ...kf })),
    )
  }
  let inferred = 0
  for (const t of boneTracks.values()) for (const k of t) inferred = Math.max(inferred, k.frame)
  for (const t of morphTracks.values()) for (const k of t) inferred = Math.max(inferred, k.frame)
  // IK state rides along, filtered the same way: a chain whose IK bone the new
  // model does not have is as meaningless as a track for a bone it lacks.
  // Rebuilding a clip field by field is how this data gets lost — a motion that
  // switches leg IK off would silently start driving the legs again after a
  // model swap, and export without the instruction it arrived with.
  let ikTracks: AnimationClip["ikTracks"]
  if (clip.ikTracks?.size) {
    ikTracks = new Map()
    for (const [name, track] of clip.ikTracks) {
      if (boneNames.has(name) && track?.length) ikTracks.set(name, track.map((k) => ({ ...k })))
    }
    if (ikTracks.size === 0) ikTracks = undefined
  }
  const empty = boneTracks.size === 0 && morphTracks.size === 0
  const end = empty ? Math.max(clip.frameCount, DEFAULT_STUDIO_CLIP_FRAMES) : Math.max(clip.frameCount, inferred)
  return { boneTracks, morphTracks, ikTracks, frameCount: end }
}

// ─── Keyframe insert + engine pose read/write ────────────────────────────
/** Default VMD-style linear-ish handles (127-space). */
export const VMD_LINEAR_DEFAULT_IP: BoneInterpolation = {
  rotation: [
    { x: 20, y: 20 },
    { x: 107, y: 107 },
  ],
  translationX: [
    { x: 20, y: 20 },
    { x: 107, y: 107 },
  ],
  translationY: [
    { x: 20, y: 20 },
    { x: 107, y: 107 },
  ],
  translationZ: [
    { x: 20, y: 20 },
    { x: 107, y: 107 },
  ],
}

export function cloneBoneInterpolation(ip: BoneInterpolation): BoneInterpolation {
  const cp = (a: { x: number; y: number }[]) => a.map((p) => ({ x: p.x, y: p.y }))
  return {
    rotation: cp(ip.rotation),
    translationX: cp(ip.translationX),
    translationY: cp(ip.translationY),
    translationZ: cp(ip.translationZ),
  }
}

/** Interpolation for a new/replaced key: same frame copy, else previous key, else any key, else default. */
export function interpolationTemplateForFrame(track: BoneKeyframe[] | undefined, frame: number): BoneInterpolation {
  if (!track?.length) return cloneBoneInterpolation(VMD_LINEAR_DEFAULT_IP)
  const at = track.find((k) => k.frame === frame)
  if (at) return cloneBoneInterpolation(at.interpolation)
  let prev: BoneKeyframe | null = null
  for (const k of track) {
    if (k.frame < frame && (!prev || k.frame > prev.frame)) prev = k
  }
  const basis = prev ?? track.reduce((a, b) => (a.frame > b.frame ? a : b))
  return cloneBoneInterpolation(basis.interpolation)
}

/** Add or replace a key at `frame`; keeps existing interpolation when replacing, else template from neighbors. */
export function upsertBoneKeyframeAtFrame(
  clip: AnimationClip,
  bone: string,
  frame: number,
  rotation: Quat,
  translation: Vec3,
): AnimationClip {
  const prevTrack = clip.boneTracks.get(bone) ?? []
  const existing = prevTrack.find((k) => k.frame === frame)
  const ip = existing ? cloneBoneInterpolation(existing.interpolation) : interpolationTemplateForFrame(prevTrack, frame)
  const nextTrack = prevTrack.filter((k) => k.frame !== frame)
  nextTrack.push({
    boneName: bone,
    frame,
    rotation,
    translation,
    interpolation: ip,
  })
  nextTrack.sort((a, b) => a.frame - b.frame)
  const boneTracks = new Map(clip.boneTracks)
  boneTracks.set(bone, nextTrack)
  return { ...clip, boneTracks }
}

/** Add or replace a morph keyframe at `frame`. */
export function upsertMorphKeyframeAtFrame(
  clip: AnimationClip,
  morphName: string,
  frame: number,
  weight: number,
): AnimationClip {
  const prevTrack = clip.morphTracks.get(morphName) ?? []
  const nextTrack = prevTrack.filter((k) => k.frame !== frame)
  nextTrack.push({ morphName, frame, weight })
  nextTrack.sort((a, b) => a.frame - b.frame)
  const morphTracks = new Map(clip.morphTracks)
  morphTracks.set(morphName, nextTrack)
  return { ...clip, morphTracks }
}

// Engine does not expose local pose yet; after `seek` this matches the drawn skeleton.
type RuntimeAccess = {
  runtimeSkeleton: {
    nameIndex: Record<string, number>
    localRotations: Quat[]
    localTranslations: Vec3[]
  }
}

export function readLocalPoseAfterSeek(model: Model, boneName: string): { rotation: Quat; translation: Vec3 } | null {
  const rt = (model as unknown as RuntimeAccess).runtimeSkeleton
  const idx = rt.nameIndex[boneName]
  if (idx === undefined || idx < 0) return null
  const r = rt.localRotations[idx]
  const t = rt.localTranslations[idx]
  return {
    rotation: r.clone(),
    translation: new Vec3(t.x, t.y, t.z),
  }
}

/** Direct local translation write (VMD pipeline uses moveBones with world-relative delta; inspector edits local space). */
export function writeLocalTranslation(model: Model, boneName: string, t: Vec3): void {
  const rt = (model as unknown as RuntimeAccess).runtimeSkeleton
  const idx = rt.nameIndex[boneName]
  if (idx === undefined || idx < 0) return
  const lt = rt.localTranslations[idx]
  lt.x = t.x
  lt.y = t.y
  lt.z = t.z
}

// ─── Deep clone of an AnimationClip (immutable history snapshot) ────────
// Slider preview mutates keyframe objects in place (atKey.rotation = q) and
// the engine shares the same arrays for performance. Undo therefore can't
// rely on the "previous reference" being unchanged — we have to clone.
export function cloneAnimationClip(clip: AnimationClip): AnimationClip {
  const boneTracks = new Map<string, BoneKeyframe[]>()
  for (const [name, track] of clip.boneTracks) {
    boneTracks.set(
      name,
      track.map((k) => ({
        boneName: k.boneName,
        frame: k.frame,
        rotation: k.rotation.clone(),
        translation: new Vec3(k.translation.x, k.translation.y, k.translation.z),
        interpolation: cloneBoneInterpolation(k.interpolation),
      })),
    )
  }
  const morphTracks = new Map<string, MorphKeyframe[]>()
  for (const [name, track] of clip.morphTracks) {
    morphTracks.set(
      name,
      track.map((k) => ({ morphName: k.morphName, frame: k.frame, weight: k.weight })),
    )
  }
  return { ...clip, boneTracks, morphTracks }
}

// ─── Bone-track keyframe reduction (Schneider-style VMD-native fitting) ─
// Top-down: try to fit a single VMD segment over the whole [first, last]
// span — four independent beziers (one rotation slerp-t curve, three
// per-axis translation curves). If the fitted curves stay within ε of the
// densely-sampled original at every integer frame, emit one keyframe and
// collapse every intermediate key. Otherwise split at the original key
// nearest the worst-deviation frame and recurse on both halves. First and
// last keys are always kept.
//
// Each fit is a 4D problem in 127-space (handle x1,y1,x2,y2): seed handles
// from endpoint-velocity matching against the dense original samples, then
// coarse grid search + local refinement. The previous greedy "drop if
// tolerated" pass inherited the surviving key's bezier handles — those
// handles were authored for a shorter segment, so stretching them over a
// longer one warped the velocity profile and produced visible jitter even
// with tight pointwise ε. Custom-fitting per emitted segment removes that.
//
// Fixed tolerances (no user knob by design):
export const SIMPLIFY_ROT_DEG = 0.5 // visible-but-tiny rotation drift
export const SIMPLIFY_TRANS = 0.01 // MMD units (~3mm at character scale)

// Evaluate a sorted bone track at integer frame `f`. VMD convention: the
// interpolation stored on keyframe B shapes the segment A→B.
function evalBoneTrackAt(track: BoneKeyframe[], f: number): { rotation: Quat; translation: Vec3 } {
  if (f <= track[0].frame) {
    const t0 = track[0].translation
    return { rotation: track[0].rotation.clone(), translation: new Vec3(t0.x, t0.y, t0.z) }
  }
  const last = track.length - 1
  if (f >= track[last].frame) {
    const tl = track[last].translation
    return { rotation: track[last].rotation.clone(), translation: new Vec3(tl.x, tl.y, tl.z) }
  }
  let i = 1
  while (i < last && track[i].frame <= f) i++
  const a = track[i - 1]
  const b = track[i]
  const span = b.frame - a.frame
  const g = span > 0 ? (f - a.frame) / span : 0
  const rotT = interpolateControlPoints(b.interpolation.rotation, g)
  const rotation = Quat.slerp(a.rotation, b.rotation, rotT)
  const txT = interpolateControlPoints(b.interpolation.translationX, g)
  const tyT = interpolateControlPoints(b.interpolation.translationY, g)
  const tzT = interpolateControlPoints(b.interpolation.translationZ, g)
  return {
    rotation,
    translation: new Vec3(
      a.translation.x + (b.translation.x - a.translation.x) * txT,
      a.translation.y + (b.translation.y - a.translation.y) * tyT,
      a.translation.z + (b.translation.z - a.translation.z) * tzT,
    ),
  }
}

// Angle between two unit quats in degrees. Double-cover-insensitive.
function quatAngleDegrees(a: Quat, b: Quat): number {
  return Quat.angleTo(a, b) * (180 / Math.PI)
}

// Coarse pass over the 4D handle space, then a tight local refinement
// around the coarse winner. 5⁴ + 5⁴ = 1250 evals per channel — cheap, and
// the seed (from endpoint-velocity matching) usually puts us in the right
// basin so the coarse grid is mostly insurance against slope estimates
// being off (e.g. when the second sample is anomalous).
const COARSE_HANDLES = [0, 32, 64, 96, 127]
const REFINE_DELTAS = [-16, -8, 0, 8, 16]

function clamp127(v: number): number {
  return v < 0 ? 0 : v > 127 ? 127 : v
}

function fitBezierHandles(evalErr: (cp: ControlPoint[]) => number, seed: ControlPoint[]): ControlPoint[] {
  let bestCP = seed
  let bestErr = evalErr(seed)
  for (const x1 of COARSE_HANDLES)
    for (const y1 of COARSE_HANDLES)
      for (const x2 of COARSE_HANDLES)
        for (const y2 of COARSE_HANDLES) {
          const cp: ControlPoint[] = [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ]
          const err = evalErr(cp)
          if (err < bestErr) {
            bestErr = err
            bestCP = cp
          }
        }
  const cx1 = bestCP[0].x
  const cy1 = bestCP[0].y
  const cx2 = bestCP[1].x
  const cy2 = bestCP[1].y
  for (const dx1 of REFINE_DELTAS)
    for (const dy1 of REFINE_DELTAS)
      for (const dx2 of REFINE_DELTAS)
        for (const dy2 of REFINE_DELTAS) {
          if (dx1 === 0 && dy1 === 0 && dx2 === 0 && dy2 === 0) continue
          const cp: ControlPoint[] = [
            { x: clamp127(cx1 + dx1), y: clamp127(cy1 + dy1) },
            { x: clamp127(cx2 + dx2), y: clamp127(cy2 + dy2) },
          ]
          const err = evalErr(cp)
          if (err < bestErr) {
            bestErr = err
            bestCP = cp
          }
        }
  return bestCP
}

// Pick handle y's so the curve hugs the desired endpoint slopes. x1=42, x2=85
// (roughly the canonical 1/3, 2/3 cubic positions); y solves dy/dx = slope at
// the endpoints. Slopes outside [0, ~3] just clamp to the boundary — the grid
// search recovers detail from there.
function seedBezierFromSlopes(slope0: number, slope1: number): ControlPoint[] {
  const X1 = 42
  const X2 = 85
  return [
    { x: X1, y: clamp127(Math.round(slope0 * X1)) },
    { x: X2, y: clamp127(Math.round(127 - slope1 * (127 - X2))) },
  ]
}

function fitRotationBezier(
  kA: BoneKeyframe,
  kC: BoneKeyframe,
  originalRot: Quat[],
  fA: number,
  fC: number,
  f0: number,
  span: number,
  rotTotalDeg: number,
): ControlPoint[] {
  const fNext = fA + 1 <= fC ? fA + 1 : fC
  const fBeforeEnd = fC - 1 >= fA ? fC - 1 : fA
  const angleAtNext = quatAngleDegrees(kA.rotation, originalRot[fNext - f0])
  const angleBeforeEnd = quatAngleDegrees(kA.rotation, originalRot[fBeforeEnd - f0])
  const s0 = (angleAtNext / rotTotalDeg) * span
  const s1 = ((rotTotalDeg - angleBeforeEnd) / rotTotalDeg) * span
  const seed = seedBezierFromSlopes(s0, s1)
  const evalErr = (cp: ControlPoint[]): number => {
    let maxErr = 0
    for (let f = fA; f <= fC; f++) {
      const u = (f - fA) / span
      const t = interpolateControlPoints(cp, u)
      const q = Quat.slerp(kA.rotation, kC.rotation, t)
      const err = quatAngleDegrees(q, originalRot[f - f0])
      if (err > maxErr) maxErr = err
    }
    return maxErr
  }
  return fitBezierHandles(evalErr, seed)
}

function fitAxisBezier(
  startVal: number,
  endVal: number,
  originalTr: Vec3[],
  axis: "x" | "y" | "z",
  fA: number,
  fC: number,
  f0: number,
  span: number,
): ControlPoint[] {
  const range = endVal - startVal
  const get = (f: number): number => {
    const v = originalTr[f - f0]
    return axis === "x" ? v.x : axis === "y" ? v.y : v.z
  }
  const fNext = fA + 1 <= fC ? fA + 1 : fC
  const fBeforeEnd = fC - 1 >= fA ? fC - 1 : fA
  const s0 = ((get(fNext) - startVal) / range) * span
  const s1 = ((endVal - get(fBeforeEnd)) / range) * span
  const seed = seedBezierFromSlopes(s0, s1)
  const evalErr = (cp: ControlPoint[]): number => {
    let maxErr = 0
    for (let f = fA; f <= fC; f++) {
      const u = (f - fA) / span
      const t = interpolateControlPoints(cp, u)
      const val = startVal + range * t
      const err = Math.abs(val - get(f))
      if (err > maxErr) maxErr = err
    }
    return maxErr
  }
  return fitBezierHandles(evalErr, seed)
}

interface SegmentFit {
  interpolation: BoneInterpolation
  maxRotErrDeg: number
  maxTrErr: number
  worstFrame: number
}

// Fit a single VMD segment (4 beziers) collapsing all original keys strictly
// between kA and kC. Returns the fit + the frame at which combined error is
// worst, used by the recursion to pick a split point if the fit fails.
function fitBezierSegment(
  kA: BoneKeyframe,
  kC: BoneKeyframe,
  originalRot: Quat[],
  originalTr: Vec3[],
  f0: number,
  epsRotDeg: number,
  epsTrans: number,
): SegmentFit {
  const fA = kA.frame
  const fC = kC.frame
  const span = fC - fA
  const rotTotalDeg = quatAngleDegrees(kA.rotation, kC.rotation)
  const rangeX = kC.translation.x - kA.translation.x
  const rangeY = kC.translation.y - kA.translation.y
  const rangeZ = kC.translation.z - kA.translation.z
  // For channels with negligible range the bezier is a no-op (output stays
  // ~constant at start ≈ end), so just pick the linear default — fitting
  // would be searching for a curve that scales a zero range.
  const linearRot = VMD_LINEAR_DEFAULT_IP.rotation
  const linearTX = VMD_LINEAR_DEFAULT_IP.translationX
  const linearTY = VMD_LINEAR_DEFAULT_IP.translationY
  const linearTZ = VMD_LINEAR_DEFAULT_IP.translationZ
  const rotCP =
    rotTotalDeg < 1e-4
      ? linearRot.map((p) => ({ x: p.x, y: p.y }))
      : fitRotationBezier(kA, kC, originalRot, fA, fC, f0, span, rotTotalDeg)
  const txCP =
    Math.abs(rangeX) < 1e-4
      ? linearTX.map((p) => ({ x: p.x, y: p.y }))
      : fitAxisBezier(kA.translation.x, kC.translation.x, originalTr, "x", fA, fC, f0, span)
  const tyCP =
    Math.abs(rangeY) < 1e-4
      ? linearTY.map((p) => ({ x: p.x, y: p.y }))
      : fitAxisBezier(kA.translation.y, kC.translation.y, originalTr, "y", fA, fC, f0, span)
  const tzCP =
    Math.abs(rangeZ) < 1e-4
      ? linearTZ.map((p) => ({ x: p.x, y: p.y }))
      : fitAxisBezier(kA.translation.z, kC.translation.z, originalTr, "z", fA, fC, f0, span)

  let maxRotErrDeg = 0
  let maxTrErr = 0
  let worstFrame = fA
  let worstScore = -1
  const epsRotInv = 1 / Math.max(epsRotDeg, 1e-6)
  const epsTrInv = 1 / Math.max(epsTrans, 1e-6)
  for (let f = fA; f <= fC; f++) {
    const u = span > 0 ? (f - fA) / span : 0
    const rotT = rotTotalDeg < 1e-4 ? u : interpolateControlPoints(rotCP, u)
    const q = Quat.slerp(kA.rotation, kC.rotation, rotT)
    const rErr = quatAngleDegrees(q, originalRot[f - f0])
    const txT = Math.abs(rangeX) < 1e-4 ? u : interpolateControlPoints(txCP, u)
    const tyT = Math.abs(rangeY) < 1e-4 ? u : interpolateControlPoints(tyCP, u)
    const tzT = Math.abs(rangeZ) < 1e-4 ? u : interpolateControlPoints(tzCP, u)
    const ot = originalTr[f - f0]
    const tErr = Math.max(
      Math.abs(kA.translation.x + rangeX * txT - ot.x),
      Math.abs(kA.translation.y + rangeY * tyT - ot.y),
      Math.abs(kA.translation.z + rangeZ * tzT - ot.z),
    )
    if (rErr > maxRotErrDeg) maxRotErrDeg = rErr
    if (tErr > maxTrErr) maxTrErr = tErr
    const score = Math.max(rErr * epsRotInv, tErr * epsTrInv)
    if (score > worstScore) {
      worstScore = score
      worstFrame = f
    }
  }
  return {
    interpolation: { rotation: rotCP, translationX: txCP, translationY: tyCP, translationZ: tzCP },
    maxRotErrDeg,
    maxTrErr,
    worstFrame,
  }
}

function fitRecursive(
  track: BoneKeyframe[],
  startIdx: number,
  endIdx: number,
  originalRot: Quat[],
  originalTr: Vec3[],
  f0: number,
  epsRotDeg: number,
  epsTrans: number,
  result: BoneKeyframe[],
): void {
  const kA = track[startIdx]
  const kC = track[endIdx]
  // Adjacent original keys — nothing to collapse, keep kC's authored curves.
  if (endIdx - startIdx === 1) {
    result.push({
      boneName: kC.boneName,
      frame: kC.frame,
      rotation: kC.rotation,
      translation: kC.translation,
      interpolation: cloneBoneInterpolation(kC.interpolation),
    })
    return
  }
  const fit = fitBezierSegment(kA, kC, originalRot, originalTr, f0, epsRotDeg, epsTrans)
  if (fit.maxRotErrDeg <= epsRotDeg && fit.maxTrErr <= epsTrans) {
    result.push({
      boneName: kC.boneName,
      frame: kC.frame,
      rotation: kC.rotation,
      translation: kC.translation,
      interpolation: fit.interpolation,
    })
    return
  }
  // Split at the original key nearest the worst-deviation frame. Tie-break by
  // first-found which favors the earlier half.
  let splitIdx = startIdx + 1
  let bestDist = Math.abs(track[splitIdx].frame - fit.worstFrame)
  for (let i = startIdx + 2; i < endIdx; i++) {
    const d = Math.abs(track[i].frame - fit.worstFrame)
    if (d < bestDist) {
      bestDist = d
      splitIdx = i
    }
  }
  fitRecursive(track, startIdx, splitIdx, originalRot, originalTr, f0, epsRotDeg, epsTrans, result)
  fitRecursive(track, splitIdx, endIdx, originalRot, originalTr, f0, epsRotDeg, epsTrans, result)
}

export function simplifyBoneTrack(
  track: BoneKeyframe[],
  epsRotDeg: number = SIMPLIFY_ROT_DEG,
  epsTrans: number = SIMPLIFY_TRANS,
): BoneKeyframe[] {
  if (track.length <= 2) return track
  const f0 = track[0].frame
  const fN = track[track.length - 1].frame
  const originalRot: Quat[] = new Array(fN - f0 + 1)
  const originalTr: Vec3[] = new Array(fN - f0 + 1)
  for (let f = f0; f <= fN; f++) {
    const s = evalBoneTrackAt(track, f)
    originalRot[f - f0] = s.rotation
    originalTr[f - f0] = s.translation
  }
  const result: BoneKeyframe[] = [
    {
      boneName: track[0].boneName,
      frame: track[0].frame,
      rotation: track[0].rotation,
      translation: track[0].translation,
      interpolation: cloneBoneInterpolation(track[0].interpolation),
    },
  ]
  fitRecursive(track, 0, track.length - 1, originalRot, originalTr, f0, epsRotDeg, epsTrans, result)
  return result
}
