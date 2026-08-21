// Round-trip tests for lib/clip-diff.
//
// Pure functions, no React and no engine state, so they run in one command
// without a test runner in the project:
//
//   npx esbuild lib/clip-diff.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs
//
// Worth having despite there being no CI to run them: undo's failure mode is
// silent corruption of someone's animation, which no amount of clicking around
// reliably surfaces. Every case below is one I got wrong or nearly did.

import { Quat, Vec3, type AnimationClip, type BoneKeyframe, type CameraKeyframe } from "reze-engine"
import { VMD_LINEAR_DEFAULT_IP, cloneBoneInterpolation, cloneAnimationClip } from "@/lib/clip"
import { applyCameraPatches, applyClipPatches, diffCamera, diffClip, patchBytes } from "@/lib/clip-diff"

const kf = (bone: string, frame: number, ry = 0): BoneKeyframe => ({
  boneName: bone, frame,
  rotation: new Quat(0, ry, 0, 1),
  translation: new Vec3(0, 0, 0),
  interpolation: cloneBoneInterpolation(VMD_LINEAR_DEFAULT_IP),
})
const clipOf = (tracks: Record<string, BoneKeyframe[]>, morphs: Record<string, {morphName:string;frame:number;weight:number}[]> = {}): AnimationClip => ({
  boneTracks: new Map(Object.entries(tracks)),
  morphTracks: new Map(Object.entries(morphs)),
  frameCount: 100,
})

const show = (c: AnimationClip) =>
  JSON.stringify([...c.boneTracks].map(([n, t]) => [n, t.map((k) => [k.frame, k.rotation.y, k.translation.x])]))
const showM = (c: AnimationClip) => JSON.stringify([...c.morphTracks].map(([n, t]) => [n, t.map((k) => [k.frame, k.weight])]))
const showC = (t: readonly CameraKeyframe[]) => JSON.stringify(t.map((k) => [k.frame, k.distance, k.fov]))

let pass = 0, fail = 0
const check = (name: string, a: string, b: string) => {
  if (a === b) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       ${a}\n       ${b}`) }
}

// ── every kind of edit at once ────────────────────────────────────────────
const before = clipOf(
  { "腕": [kf("腕", 0), kf("腕", 10, 0.5), kf("腕", 20)], "脚": [kf("脚", 0)] },
  { "笑い": [{ morphName: "笑い", frame: 0, weight: 0 }, { morphName: "笑い", frame: 5, weight: 1 }] },
)
const baseline = cloneAnimationClip(before)

const after = cloneAnimationClip(before)
after.boneTracks.get("腕")![1].rotation = new Quat(0, 0.9, 0, 1)          // modify
after.boneTracks.get("腕")!.push(kf("腕", 30))                            // insert
after.boneTracks.set("腕", after.boneTracks.get("腕")!.filter((k) => k.frame !== 0)) // delete
after.boneTracks.delete("脚")                                             // clear a whole track
after.boneTracks.set("首", [kf("首", 7)])                                 // a brand-new track
after.morphTracks.get("笑い")![1].weight = 0.25                            // morph modify

const patches = diffClip(baseline, after)
console.log(`\n${patches.length} patches, ${patchBytes(patches)} bytes (a full clone of this clip would be ~2.6KB)`)

const undone = applyClipPatches(after, patches, "undo")
check("undo restores bones", show(undone), show(before))
check("undo restores morphs", showM(undone), showM(before))
const redone = applyClipPatches(undone, patches, "redo")
check("redo reapplies bones", show(redone), show(after))
check("redo reapplies morphs", showM(redone), showM(after))
check("undo→redo→undo is stable", show(applyClipPatches(redone, patches, "undo")), show(before))

// ── a keyframe MOVE is a delete plus an insert ────────────────────────────
const m0 = clipOf({ "腕": [kf("腕", 5, 0.3)] })
const m1 = clipOf({ "腕": [kf("腕", 40, 0.3)] })
const mp = diffClip(m0, m1)
check("move undoes to the old frame", show(applyClipPatches(m1, mp, "undo")), show(m0))
check("move redoes to the new frame", show(applyClipPatches(m0, mp, "redo")), show(m1))

// ── an emptied track is removed, not left blank ───────────────────────────
const e0 = clipOf({ "腕": [kf("腕", 1)] })
const e1 = clipOf({})
check("cleared track disappears", String(applyClipPatches(e0, diffClip(e0, e1), "redo").boneTracks.size), "0")

// ── frameCount follows the last key ───────────────────────────────────────
const f0 = clipOf({ "腕": [kf("腕", 0)] })
const f1 = clipOf({ "腕": [kf("腕", 0), kf("腕", 500)] })
check("frameCount grows with a key past the end", String(applyClipPatches(f0, diffClip(f0, f1), "redo").frameCount), "500")

// ── camera ────────────────────────────────────────────────────────────────
const cam = (frame: number, distance: number, fov = 30): CameraKeyframe => ({
  frame, distance, fov, target: new Vec3(0, 10, 0), rotation: new Vec3(0, 0, 0),
})
const c0 = [cam(0, -35), cam(60, -20)]
const c1 = [cam(0, -35), cam(60, -12), cam(90, -50)]
const cp = diffCamera(c0, c1)
check("camera undo", showC(applyCameraPatches(c1, cp, "undo")), showC(c0))
check("camera redo", showC(applyCameraPatches(c0, cp, "redo")), showC(c1))

// ── a patch must not alias a live keyframe ────────────────────────────────
const a0 = clipOf({ "腕": [kf("腕", 0, 0.1)] })
const a1 = cloneAnimationClip(a0)
a1.boneTracks.get("腕")![0].rotation = new Quat(0, 0.7, 0, 1)
const ap = diffClip(a0, a1)
a1.boneTracks.get("腕")![0].rotation = new Quat(0, 0.999, 0, 1) // mutate AFTER diffing
check("patch survives later in-place mutation", show(applyClipPatches(a1, ap, "undo")), show(a0))

// ── no change means no step ───────────────────────────────────────────────
check("identical clips diff to nothing", String(diffClip(baseline, cloneAnimationClip(baseline)).length), "0")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
