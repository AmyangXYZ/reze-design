// What one edit CHANGED, rather than what the clip became.
//
// The editor mutates keyframes in place — that is what keeps a drag off React
// entirely — so by the time a commit lands, the previous values are gone. The
// first version of undo answered that by cloning the whole clip at every commit
// and keeping a hundred of them. Correct, and about 12.7MB per step on the
// bundled dance: a full stack was over a gigabyte, and every commit paid a deep
// copy of fifteen thousand keyframes to buy it.
//
// This is the standard answer instead: a patch is a value at a key, before and
// after, and `null` on either side says insert or delete without a second shape
// to reason about. One baseline is kept in step by applying patches to it, so
// the memory cost of a step is the size of the EDIT rather than the size of the
// document — kilobytes where it was megabytes.
//
// Deriving the patches by DIFFING the baseline, rather than having each edit
// path report what it touched, is the deliberate half of the design. There are a
// dozen sites that mutate a clip — two slider paths, the gizmo, four timeline
// drags, five operations, the ops hook — and a history that depends on every one
// of them remembering to file a report is a history that is quietly wrong the
// first time someone adds the thirteenth. The diff cannot be forgotten. It costs
// one linear pass over tracks that are already sorted, once per commit, which is
// per gesture and not per frame.

import type { AnimationClip, BoneKeyframe, CameraKeyframe, MorphKeyframe } from "reze-engine"
import { Vec3 } from "reze-engine"
import { cloneBoneInterpolation, clipAfterKeyframeEdit } from "@/lib/clip"

/** A keyframe's value at one frame of one track, on both sides of an edit.
 *  `before: null` is an insert, `after: null` a delete, both present a change. */
export type ClipPatch =
  | { kind: "bone"; bone: string; frame: number; before: BoneKeyframe | null; after: BoneKeyframe | null }
  | { kind: "morph"; morph: string; frame: number; before: MorphKeyframe | null; after: MorphKeyframe | null }
  | { kind: "camera"; frame: number; before: CameraKeyframe | null; after: CameraKeyframe | null }

export type PatchDirection = "undo" | "redo"

// ─── Copies ───────────────────────────────────────────────────────────────
//
// A patch must hold VALUES, never references into a live track: the next drag
// mutates those keyframe objects in place, and a patch that pointed at one would
// quietly rewrite itself into a no-op.

function copyBone(k: BoneKeyframe): BoneKeyframe {
  return {
    boneName: k.boneName,
    frame: k.frame,
    rotation: k.rotation.clone(),
    translation: new Vec3(k.translation.x, k.translation.y, k.translation.z),
    interpolation: cloneBoneInterpolation(k.interpolation),
  }
}

const copyMorph = (k: MorphKeyframe): MorphKeyframe => ({ ...k })

/** The camera's Vec3s are swapped whole by the channel setters rather than
 *  mutated, so a shallow copy of the keyframe is a value copy of it. The
 *  interpolation table is a Uint8Array and IS written in place. */
const copyCamera = (k: CameraKeyframe): CameraKeyframe => ({
  ...k,
  interpolation: k.interpolation ? new Uint8Array(k.interpolation) : undefined,
})

// ─── Equality ─────────────────────────────────────────────────────────────
//
// Everything a patch would restore has to be compared, or an edit to the part
// left out is an edit undo cannot take back.

function sameIp(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false
  return true
}

function sameBone(a: BoneKeyframe, b: BoneKeyframe): boolean {
  const r1 = a.rotation
  const r2 = b.rotation
  const t1 = a.translation
  const t2 = b.translation
  return (
    r1.x === r2.x &&
    r1.y === r2.y &&
    r1.z === r2.z &&
    r1.w === r2.w &&
    t1.x === t2.x &&
    t1.y === t2.y &&
    t1.z === t2.z &&
    sameIp(a.interpolation.rotation, b.interpolation.rotation) &&
    sameIp(a.interpolation.translationX, b.interpolation.translationX) &&
    sameIp(a.interpolation.translationY, b.interpolation.translationY) &&
    sameIp(a.interpolation.translationZ, b.interpolation.translationZ)
  )
}

function sameCamera(a: CameraKeyframe, b: CameraKeyframe): boolean {
  if (a.distance !== b.distance || a.fov !== b.fov) return false
  if (a.target.x !== b.target.x || a.target.y !== b.target.y || a.target.z !== b.target.z) return false
  if (a.rotation.x !== b.rotation.x || a.rotation.y !== b.rotation.y || a.rotation.z !== b.rotation.z) return false
  const ia = a.interpolation
  const ib = b.interpolation
  if (!ia || !ib) return ia === ib
  if (ia.length !== ib.length) return false
  for (let i = 0; i < ia.length; i++) if (ia[i] !== ib[i]) return false
  return true
}

// ─── Diff ─────────────────────────────────────────────────────────────────

/**
 * Walk two frame-sorted tracks together.
 *
 * Both sides are kept sorted by frame everywhere in this app, so a merge walk
 * is enough and there is no need to build an index. A moved keyframe falls out
 * as a delete at the old frame and an insert at the new one, which is what it
 * is: a keyframe's identity IS its frame.
 */
function diffTrack<T extends { frame: number }>(
  before: readonly T[],
  after: readonly T[],
  same: (a: T, b: T) => boolean,
  emit: (frame: number, before: T | null, after: T | null) => void,
): void {
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const a = i < before.length ? before[i] : null
    const b = j < after.length ? after[j] : null
    if (a && (!b || a.frame < b.frame)) {
      emit(a.frame, a, null)
      i++
    } else if (b && (!a || b.frame < a.frame)) {
      emit(b.frame, null, b)
      j++
    } else if (a && b) {
      if (!same(a, b)) emit(a.frame, a, b)
      i++
      j++
    }
  }
}

const EMPTY: never[] = []

/** Every keyframe that differs between two clips. */
export function diffClip(before: AnimationClip | null, after: AnimationClip | null): ClipPatch[] {
  const patches: ClipPatch[] = []
  if (!before || !after) return patches

  for (const bone of new Set([...before.boneTracks.keys(), ...after.boneTracks.keys()])) {
    diffTrack<BoneKeyframe>(
      before.boneTracks.get(bone) ?? EMPTY,
      after.boneTracks.get(bone) ?? EMPTY,
      sameBone,
      (frame, b, a) =>
        patches.push({ kind: "bone", bone, frame, before: b && copyBone(b), after: a && copyBone(a) }),
    )
  }
  for (const morph of new Set([...before.morphTracks.keys(), ...after.morphTracks.keys()])) {
    diffTrack<MorphKeyframe>(
      before.morphTracks.get(morph) ?? EMPTY,
      after.morphTracks.get(morph) ?? EMPTY,
      (a, b) => a.weight === b.weight,
      (frame, b, a) =>
        patches.push({ kind: "morph", morph, frame, before: b && copyMorph(b), after: a && copyMorph(a) }),
    )
  }
  return patches
}

export function diffCamera(before: readonly CameraKeyframe[], after: readonly CameraKeyframe[]): ClipPatch[] {
  const patches: ClipPatch[] = []
  diffTrack<CameraKeyframe>(before, after, sameCamera, (frame, b, a) =>
    patches.push({ kind: "camera", frame, before: b && copyCamera(b), after: a && copyCamera(a) }),
  )
  return patches
}

// ─── Apply ────────────────────────────────────────────────────────────────

/** The side of each patch this direction restores. */
const sideOf = <T,>(p: { before: T | null; after: T | null }, dir: PatchDirection) =>
  dir === "undo" ? p.before : p.after

/**
 * Rebuild one track from a frame-keyed map.
 *
 * Grouping first, rather than splicing each patch into the array where it
 * lands, is what keeps Simplify undoable at a sensible cost: that operation can
 * delete fourteen thousand keyframes, and fourteen thousand individual splices
 * into a shrinking array is quadratic. This is linear in the track.
 */
function rebuild<T extends { frame: number }>(track: readonly T[], edits: Map<number, T | null>): T[] {
  const byFrame = new Map<number, T>()
  for (const k of track) byFrame.set(k.frame, k)
  for (const [frame, value] of edits) {
    if (value) byFrame.set(frame, value)
    else byFrame.delete(frame)
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame)
}

/**
 * Apply patches to a clip, returning a new clip reference.
 *
 * New Maps and new arrays for the tracks it touches, so React and the engine
 * both see a change; tracks nothing touched keep their existing arrays. An
 * emptied track is REMOVED rather than left as a key with no keyframes — a
 * dopesheet's rows are the tracks that exist, and an empty one would be a row
 * that draws nothing.
 */
export function applyClipPatches(clip: AnimationClip, patches: readonly ClipPatch[], dir: PatchDirection): AnimationClip {
  const boneEdits = new Map<string, Map<number, BoneKeyframe | null>>()
  const morphEdits = new Map<string, Map<number, MorphKeyframe | null>>()

  for (const p of patches) {
    if (p.kind === "bone") {
      let m = boneEdits.get(p.bone)
      if (!m) boneEdits.set(p.bone, (m = new Map()))
      m.set(p.frame, sideOf(p, dir))
    } else if (p.kind === "morph") {
      let m = morphEdits.get(p.morph)
      if (!m) morphEdits.set(p.morph, (m = new Map()))
      m.set(p.frame, sideOf(p, dir))
    }
  }
  if (boneEdits.size === 0 && morphEdits.size === 0) return clip

  const boneTracks = new Map(clip.boneTracks)
  for (const [bone, edits] of boneEdits) {
    const next = rebuild(boneTracks.get(bone) ?? EMPTY, edits)
    if (next.length) boneTracks.set(bone, next)
    else boneTracks.delete(bone)
  }
  const morphTracks = new Map(clip.morphTracks)
  for (const [morph, edits] of morphEdits) {
    const next = rebuild(morphTracks.get(morph) ?? EMPTY, edits)
    if (next.length) morphTracks.set(morph, next)
    else morphTracks.delete(morph)
  }
  // The clip's end must still clear its last key — the same settle every other
  // keyframe edit runs through.
  return clipAfterKeyframeEdit({ ...clip, boneTracks, morphTracks })
}

export function applyCameraPatches(
  track: readonly CameraKeyframe[],
  patches: readonly ClipPatch[],
  dir: PatchDirection,
): CameraKeyframe[] {
  const edits = new Map<number, CameraKeyframe | null>()
  for (const p of patches) if (p.kind === "camera") edits.set(p.frame, sideOf(p, dir))
  if (edits.size === 0) return track as CameraKeyframe[]
  return rebuild(track, edits)
}

// ─── Size ─────────────────────────────────────────────────────────────────

/**
 * Roughly what a patch list costs in memory, for the stack's budget.
 *
 * Measured rather than guessed: a bone keyframe clones into sixteen objects —
 * the keyframe, a Quat, a Vec3, the interpolation table, its four arrays and
 * eight points — which comes to ~816 bytes in V8, and a patch can hold two of
 * them. Morph and camera keyframes are flat and cost a fraction of that. The
 * number does not need to be exact; it needs to be proportional, so that one
 * enormous step cannot sit in the stack pretending to be as cheap as a nudge.
 */
const BYTES = { bone: 816, morph: 64, camera: 160 } as const

export function patchBytes(patches: readonly ClipPatch[]): number {
  let n = 0
  for (const p of patches) {
    const each = BYTES[p.kind]
    if (p.before) n += each
    if (p.after) n += each
  }
  return n
}
