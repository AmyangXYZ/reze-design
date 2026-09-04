// Tests for lib/plate-calibrate, against synthetic scenes rendered from a camera
// whose fov, pitch and roll are KNOWN.
//
//   npx esbuild lib/plate-calibrate.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/pc.mjs && node /tmp/pc.mjs
//
// A synthetic plate is the only oracle that can say the solver is RIGHT rather
// than merely repeatable. Photographs have no ground truth attached; a rendered
// room has the exact numbers it was rendered with, so every assertion below is a
// comparison against an answer nobody had to eyeball.
//
// The scene is a room seen in two-point perspective: a floor grid in two
// orthogonal directions plus vertical posts. That is deliberately the EASY case —
// it is what an indoor phone photo looks like, and it is the case the solver has
// to be right about before any harder one matters.

import assert from "node:assert/strict"
import { calibratePlate, __debugCalibrate, type PlateFrame } from "./plate-calibrate"

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

type Cam = { fov: number; pitch: number; roll: number; yaw: number; height: number }

/** Project + rasterise a wireframe scene. White lines on black, which is all the
 *  gradient stage cares about. */
function render(cam: Cam, w: number, h: number): PlateFrame {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  const f = h / 2 / Math.tan(cam.fov / 2)
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  // Yaw, then pitch DOWN, then roll about the view axis.
  const fwd = [sy * cp, -sp, cy * cp]
  const up0 = [sy * sp, cp, cy * sp]
  const rt0 = [cy, 0, -sy]
  const cr = Math.cos(cam.roll)
  const sr = Math.sin(cam.roll)
  const rt = [rt0[0] * cr + up0[0] * sr, rt0[1] * cr + up0[1] * sr, rt0[2] * cr + up0[2] * sr]
  const up = [up0[0] * cr - rt0[0] * sr, up0[1] * cr - rt0[1] * sr, up0[2] * cr - rt0[2] * sr]
  const C = [0, cam.height, 0]

  /** World point → camera space. */
  const view = (p: number[]): [number, number, number] => {
    const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]
    return [
      d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2],
      d[0] * up[0] + d[1] * up[1] + d[2] * up[2],
      d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2],
    ]
  }
  const project = (v: [number, number, number]): [number, number] => [
    w / 2 + (f * v[0]) / v[2],
    h / 2 - (f * v[1]) / v[2],
  ]
  const plot = (x: number, y: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return
    // Two pixels wide: a one-pixel line at a shallow angle breaks into dashes
    // whose ends read as their own little edges pointing every which way.
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const i = ((yi + dy) * w + (xi + dx)) * 4
        data[i] = data[i + 1] = data[i + 2] = 255
      }
    }
  }
  // CLIPPED at the near plane, not dropped. Dropping a segment because one end is
  // behind the camera throws away exactly the informative ones: with any yaw, the
  // near floor lines — the long, steeply converging ones — each have an end
  // behind, so what survived was only the distant cross-lines, which really are
  // near parallel. The solver then correctly reported that it had been shown a
  // set of parallel lines. The renderer was lying, not the solve.
  const NEAR = 0.2
  const seg = (aw: number[], bw: number[]) => {
    let va = view(aw)
    let vb = view(bw)
    if (va[2] <= NEAR && vb[2] <= NEAR) return
    if (va[2] <= NEAR || vb[2] <= NEAR) {
      const t = (NEAR - va[2]) / (vb[2] - va[2])
      const cut: [number, number, number] = [
        va[0] + (vb[0] - va[0]) * t,
        va[1] + (vb[1] - va[1]) * t,
        NEAR,
      ]
      if (va[2] <= NEAR) va = cut
      else vb = cut
    }
    const pa = project(va)
    const pb = project(vb)
    const n = Math.ceil(Math.max(Math.abs(pb[0] - pa[0]), Math.abs(pb[1] - pa[1])) * 2) + 1
    for (let i = 0; i <= n; i++) {
      const t = i / n
      plot(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)
    }
  }

  // A ROOM, not posts in a void — floor, back wall, side wall.
  //
  // The first scene was a floor grid with a few short posts, and the verticals
  // never formed a family the solver could find: two dozen floor lines drowned
  // them, and a scene where the only upright things are fenceposts is not what
  // anyone points a phone at. A room states all three directions the way the
  // reference footage does — floorboards, wall panelling, door frame — so the
  // suite now exercises the path a real plate takes.
  //
  // Floor: both horizontal families, which is the pair the focal length comes
  // out of. Sparser than before so the walls are not outvoted.
  for (let x = -9; x <= 9; x += 3) seg([x, 0, 1], [x, 0, 26])
  for (let z = 3; z <= 26; z += 3) seg([-9, 0, z], [9, 0, z])
  // Back wall: vertical panelling and horizontal trim.
  for (let x = -9; x <= 9; x += 1.5) seg([x, 0, 26], [x, 7, 26])
  for (const y of [1, 2.4, 7]) seg([-9, y, 26], [9, y, 26])
  // Side wall, which is what makes the room a room rather than a backdrop.
  for (const z of [4, 8, 12, 16, 20, 24]) seg([-9, 0, z], [-9, 7, z])
  for (const y of [2.4, 7]) seg([-9, y, 2], [-9, y, 26])
  return { data, width: w, height: h }
}

const failures: string[] = []

function check(name: string, cam: Cam, tol: { fov: number; pitch: number; roll: number }) {
  const frame = render(cam, 960, 540)
  const got = calibratePlate(frame)
  
  const report =
    `${name}\n` +
    `  fov   want ${deg(cam.fov).toFixed(1)}  got ${deg(got.fov).toFixed(1)}\n` +
    `  pitch want ${deg(cam.pitch).toFixed(1)}  got ${deg(got.pitch).toFixed(1)}\n` +
    `  roll  want ${deg(cam.roll).toFixed(1)}  got ${deg(got.roll).toFixed(1)}\n` +
    `  solved ${JSON.stringify(got.solved)} confidence ${got.confidence.toFixed(2)}`
  console.log(report)
  const bad: string[] = []
  if (!got.solved.roll || Math.abs(deg(got.roll) - deg(cam.roll)) >= tol.roll) bad.push("roll")
  if (!got.solved.fov || Math.abs(deg(got.fov) - deg(cam.fov)) >= tol.fov) bad.push("fov")
  if (!got.solved.pitch || Math.abs(deg(got.pitch) - deg(cam.pitch)) >= tol.pitch) bad.push("pitch")
  if (bad.length) failures.push(`${name}: ${bad.join(", ")}`)
}

// A phone on a table: wide-ish lens, tipped down at the floor, held straight.
check("level phone", { fov: rad(50), pitch: rad(12), roll: 0, yaw: rad(25), height: 1.4 }, { fov: 4, pitch: 3, roll: 1.5 })
// The same shot with the phone leaning — the channel the orbit cannot state and
// the one a person is worst at matching by eye.
check("leaning phone", { fov: rad(50), pitch: rad(12), roll: rad(8), yaw: rad(25), height: 1.4 }, { fov: 4, pitch: 3, roll: 1.5 })
check("leaning the other way", { fov: rad(50), pitch: rad(12), roll: rad(-6), yaw: rad(25), height: 1.4 }, { fov: 4, pitch: 3, roll: 1.5 })
// A longer lens, looking down harder.
// A longer lens, still framing the room. The first version of this case pointed a
// 32° lens down 22° from over two metres and saw nothing but floor — no verticals
// at all, so no lean to recover and no horizon in shot. The solver refused it,
// correctly; the fixture was the thing that was wrong. Nobody stands a figure in
// a picture of bare floorboards.
check("tighter lens", { fov: rad(32), pitch: rad(10), roll: rad(3), yaw: rad(35), height: 1.6 }, { fov: 4, pitch: 3, roll: 1.5 })

// A picture with nothing straight in it must SAY so rather than invent a camera:
// moving three sliders to a guess is worse than leaving them where the author
// left them.
{
  const noise: PlateFrame = { data: new Uint8ClampedArray(320 * 180 * 4), width: 320, height: 180 }
  let seed = 1
  for (let i = 0; i < noise.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = (seed >> 16) & 255
    noise.data[i + 3] = 255
  }
  const got = calibratePlate(noise)
  assert.ok(got.confidence < 0.75, `noise should not read as a confident solve, got ${got.confidence}`)
  console.log(`noise -> confidence ${got.confidence.toFixed(2)} solved ${JSON.stringify(got.solved)}`)
}

// Same picture, same answer, every time — a scene must re-open on the shot its
// author left, and a solver with a random seed in it cannot promise that.
{
  const frame = render({ fov: rad(50), pitch: rad(12), roll: rad(8), yaw: rad(25), height: 1.4 }, 960, 540)
  const a = calibratePlate(frame)
  const b = calibratePlate(frame)
  assert.deepEqual(a, b, "solver is not deterministic")
  console.log("deterministic: two runs agree exactly")
}

if (failures.length) {
  console.log("\nFAILED: " + failures.join(" | "))
  process.exit(1)
}
console.log("\nall plate-calibrate tests passed")
