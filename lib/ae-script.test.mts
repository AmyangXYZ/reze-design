// Tests for lib/ae-script.
//
//   npx esbuild lib/ae-script.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/ae.mjs && node /tmp/ae.mjs
//
// The output is a script another program runs, so a mistake here does not throw
// — it produces a composition that is subtly in the wrong place, and the person
// who finds out is compositing at midnight. Every case below is a way to be
// wrong that still parses.

import { aeScript, type ShotSample } from "@/lib/ae-script"

let failures = 0
const ok = (cond: boolean, what: string) => {
  if (!cond) { failures++; console.error(`FAIL ${what}`) }
}
const has = (s: string, needle: string, what: string) => ok(s.includes(needle), `${what}\n  missing: ${needle}`)

const shot = (over: Partial<ShotSample> = {}): ShotSample => ({
  target: [0, 10, 0],
  rotation: [0, 0, 0],
  distance: -45,
  fov: 0.5,
  ...over,
})

const base = { width: 1920, height: 1080, fps: 60, startTime: 0, scale: 10, cast: [] }

// ── The comp is the video ─────────────────────────────────────────────────
// Not "matching" it — built from the same numbers, so there is nothing to keep
// in step. 90 frames at 60fps is 1.5s exactly.
{
  const s = aeScript({ ...base, frames: 90, camera: Array.from({ length: 90 }, () => shot()) })
  has(s, "var Width       = 1920;", "comp width")
  has(s, "var Height      = 1080;", "comp height")
  has(s, "var FPS         = 60;", "comp rate")
  has(s, "var Duration    = 1.500000;", "duration is frames over rate")
}

// ── The rig ───────────────────────────────────────────────────────────────
// The layer names and parenting are MMD2AE's, deliberately: AE projects and
// habits are built on them, and a rig that renamed itself would be a rig nobody
// could drop into an existing comp.
{
  const s = aeScript({ ...base, frames: 1, camera: [shot()] })
  has(s, '"MMD CAMERA CONTROL Y"', "the yaw null keeps its name")
  has(s, '"MMD CAMERA CONTROL X"', "the pitch null keeps its name")
  has(s, "layNullx.parent      = layNully;", "X parents to Y")
  has(s, "layCam.parent = layNullx;", "the camera parents to X")
}

// ── Y is flipped, and yaw with it ─────────────────────────────────────────
// AE's y points down the screen and MMD's points up. Flipping one axis reverses
// the handedness, so a rotation about the flipped axis has to reverse too —
// flip the position and forget the yaw and the shot mirrors, which reads as a
// camera pointing the wrong way rather than as an axis mistake.
{
  const s = aeScript({ ...base, frames: 1, camera: [shot({ target: [1, 2, 3], rotation: [0, Math.PI / 2, 0] })] })
  has(s, "[ 10.000, -20.000, 30.000 ]", "y is negated, everything scaled")
  has(s, "layNully.yRotation.setValueAtTime( 0.00000000, -90.000 );", "yaw is negated with it")
}

// Pitch and roll are NOT negated — they turn about axes the flip left alone.
{
  const s = aeScript({ ...base, frames: 1, camera: [shot({ rotation: [Math.PI / 4, 0, Math.PI / 6] })] })
  has(s, "layNullx.xRotation.setValueAtTime( 0.00000000, 45.000 );", "pitch passes through")
  has(s, "layNullx.zRotation.setValueAtTime( 0.00000000, 30.000 );", "roll passes through")
}

// ── Distance is the child null's anchor ───────────────────────────────────
// An anchor offset applies AFTER that null's rotations, so it pushes the camera
// back along its own axis — which is what an MMD distance means. As a position
// it would push along the parent's axes instead, and the shot would swing.
{
  const s = aeScript({ ...base, frames: 1, camera: [shot({ distance: -45 })] })
  has(s, "layNullx.anchorPoint.setValueAtTime( 0.00000000,[ 0.0, 0.0, -450.000 ] );", "distance, scaled, on the anchor")
  ok(!s.includes("layNullx.position.setValueAtTime"), "the child null's POSITION is never keyed")
}

// ── The lens ──────────────────────────────────────────────────────────────
// AE has no fov field: zoom is the distance in PIXELS to the comp plane, so the
// same shot is a different number at a different comp height. A fov of 2*atan(0.5)
// is exactly one comp height away.
{
  const fov = 2 * Math.atan(0.5)
  const s = aeScript({ ...base, frames: 1, camera: [shot({ fov })] })
  has(s, "1080.000", "zoom is derived from the comp height")
  const tall = aeScript({ ...base, height: 2160, frames: 1, camera: [shot({ fov })] })
  has(tall, "2160.000", "and follows it when the comp changes")
}

// KEYED EVERY FRAME. A shot whose lens never moves writes the same number
// throughout, which is a few kilobytes; a shot that zooms and was written once
// is wrong, and nothing in AE would say so.
{
  const cam = [shot({ fov: 0.5 }), shot({ fov: 0.6 }), shot({ fov: 0.7 })]
  const s = aeScript({ ...base, frames: 3, camera: cam })
  ok((s.match(/layCam\.property\( "zoom" \)\.setValueAtTime/g) ?? []).length === 3, "one zoom key per frame")
}

// ── Frame times ───────────────────────────────────────────────────────────
// Keys land on frame boundaries in seconds. A key a hair off its frame is one
// AE may snap somewhere else.
{
  const s = aeScript({ ...base, fps: 30, frames: 3, camera: [shot(), shot(), shot()] })
  has(s, "( 0.00000000,", "frame 0")
  has(s, "( 0.03333333,", "frame 1 at 30fps")
  has(s, "( 0.06666667,", "frame 2")
}

// ── The cast ──────────────────────────────────────────────────────────────
{
  const s = aeScript({
    ...base,
    frames: 2,
    camera: [shot(), shot()],
    cast: [{ name: "レゼ", samples: [
      { position: [0, 0, 0], rotation: [0, 0, 0] },
      { position: [1, 2, 3], rotation: [0, Math.PI, 0] },
    ] }],
  })
  has(s, 'layCast0.name        = "レゼ";', "a null per character, under its own name")
  has(s, "layCast0.threeDLayer = true;", "and it is 3D, or it cannot hold a Z")
  has(s, "[ 10.000, -20.000, 30.000 ]", "same flip and scale as the camera")
  has(s, "-180.000", "and the same yaw negation")
}

// ── Nothing to say ────────────────────────────────────────────────────────
// An export with no camera still produces a runnable script rather than a
// broken one — the comp is worth having even empty.
{
  const s = aeScript({ ...base, frames: 0, camera: [] })
  has(s, "app.beginUndoGroup", "still a script")
  has(s, "app.endUndoGroup();", "and a closed one")
  ok(!s.includes("undefined") && !s.includes("NaN"), "and holds no undefined or NaN")
}

// ── Never a negative zero ─────────────────────────────────────────────────
// -0.000 is valid JS and reads as a bug to whoever opens the file.
{
  const s = aeScript({ ...base, frames: 1, camera: [shot({ target: [0, 0, 0], rotation: [0, 0, 0] })] })
  ok(!s.includes("-0.000"), "no negative zeroes in the output")
}

console.log(failures === 0 ? "ae-script: all pass" : `ae-script: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
