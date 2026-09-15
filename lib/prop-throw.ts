// A prop changing hands: parent switches that keep it in place, and throws.
//
// Both write the prop's parent track and nothing else, so the prop's own clip
// stays its own. A switch is a key whose offset holds the prop exactly where it
// is at that frame. A throw is a release key, a run of free keys the engine
// tweens between, and a catch key that tweens into the catcher's hand — its
// offset is the grip the prop lands in, in the catcher's bone space.
//
// THE PLACEMENT. The engine skins a prop as world = F · S · bones, with S its
// uniform scale and F rigid:
//   standing on its own   F = T(position) · R(rotation)
//   riding a bone         F = A · Off · T(−s·seat)
// A is the parent bone's world frame (the parent's root × its bone), Off the
// key's offset, and seat the bind position of the prop's first root, which the
// engine puts ON the bone. Keeping place across a switch is solving the new key
// for the same F.

import { Mat4, Quat, Vec3, type Engine } from "reze-engine"
import { FPS } from "@/lib/clip"
import type { SceneParentKey } from "@/lib/scene"
import { castRotationToEngine, type PropInfo } from "@/lib/scene-host"

type M4 = Float32Array
type Tuple = [number, number, number]

const DEG = 180 / Math.PI

const mul = (a: M4, b: M4): M4 => {
  const out = new Float32Array(16)
  Mat4.multiplyArrays(a, 0, b, 0, out, 0)
  return out
}
const invert = (m: M4): M4 => {
  const out = new Float32Array(16)
  Mat4.inverseInto(m, out)
  return out
}
const rigid = (x: number, y: number, z: number, q: Quat = Quat.identity()): M4 => {
  const out = new Float32Array(16)
  Mat4.fromPositionRotationScaleInto(x, y, z, q.x, q.y, q.z, q.w, 1, out)
  return out
}
const positionOf = (m: M4): Tuple => [m[12], m[13], m[14]]
const rotationOf = (m: M4): Quat => Mat4.toQuatFromArray(m, 0)
/** Degrees in the document's order — the inverse of castRotationToEngine. */
const degrees = (q: Quat): Tuple => {
  const e = Quat.toEulerOrder(q, "YXZ")
  return [e.x * DEG, e.y * DEG, e.z * DEG]
}

/** Every hold on a prop's track, in order: the start its row sets, then each key. */
export function holdsOf(p: PropInfo): SceneParentKey[] {
  const start: SceneParentKey = {
    frame: 0,
    model: p.attach?.model ?? null,
    ...(p.attach ? { bone: p.attach.bone } : {}),
    position: p.transform.position,
    rotation: p.transform.rotation,
  }
  return [start, ...p.parentKeys]
}

/** Index into holdsOf of the hold in force at frame `at`. */
export function holdIndexAt(p: PropInfo, at: number): number {
  const holds = holdsOf(p)
  let i = 0
  while (i + 1 < holds.length && holds[i + 1].frame <= at) i++
  return i
}

/** The hold in force at frame `at`. */
export function holdAt(p: PropInfo, at: number): SceneParentKey {
  return holdsOf(p)[holdIndexAt(p, at)]
}

/** A bone's world frame as the scene is posed right now: its model's placement
 *  times the bone, or the model's root where the rig has no such bone — the
 *  same fallback the engine rides. */
function boneFrame(engine: Engine, modelId: string, bone: string | undefined): M4 | null {
  const model = engine.getModel(modelId)
  if (!model) return null
  const root = new Float32Array(model.getRootMatrix())
  const world = bone ? model.getBoneWorldMatrix(bone) : null
  return world ? mul(root, new Float32Array(world)) : root
}

/** The bind position of the prop's first root — what the engine seats on a bone. */
function propSeat(engine: Engine, id: string): Tuple | null {
  const root = engine.getModel(id)?.getSkeleton().bones.find((b) => b.parentIndex < 0)
  if (!root) return null
  return [root.bindTranslation[0], root.bindTranslation[1], root.bindTranslation[2]]
}

/** The middle of the prop's mesh in its own space: the box around its bind pose. */
function meshCenter(engine: Engine, id: string): Tuple | null {
  const positions = engine.getModel(id)?.getGeometry().positions
  if (!positions || positions.length < 3) return null
  const lo: Tuple = [Infinity, Infinity, Infinity]
  const hi: Tuple = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]
      if (v < lo[a]) lo[a] = v
      if (v > hi[a]) hi[a] = v
    }
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
}

/** F for a hold, read against the scene as it is posed now. */
function placement(engine: Engine, p: PropInfo, hold: SceneParentKey, seat: Tuple): M4 {
  const own = rigid(hold.position[0], hold.position[1], hold.position[2], castRotationToEngine(hold.rotation))
  if (hold.model === null) return own
  const parent = boneFrame(engine, hold.model, hold.bone)
  // A parent that is not loaded leaves the engine holding the prop at identity.
  if (!parent) return rigid(0, 0, 0)
  const s = p.transform.scale
  return mul(mul(parent, own), rigid(-s * seat[0], -s * seat[1], -s * seat[2]))
}

/** The free key at `at` whose placement is F. */
function freeKey(F: M4, at: number): SceneParentKey {
  return { frame: at, model: null, position: positionOf(F), rotation: degrees(rotationOf(F)) }
}

/** The key that hangs the prop on `to` — or stands it on its own — at frame `at`
 *  without moving it. The scene must be posed at `at`. */
export function keepPlaceKey(
  engine: Engine,
  p: PropInfo,
  at: number,
  to: { model: string; bone: string } | null,
): SceneParentKey | null {
  const seat = propSeat(engine, p.id)
  if (!seat) return null
  const F = placement(engine, p, holdAt(p, at), seat)
  if (!to) return freeKey(F, at)
  const parent = boneFrame(engine, to.model, to.bone)
  if (!parent) return null
  const s = p.transform.scale
  const off = mul(mul(invert(parent), F), rigid(s * seat[0], s * seat[1], s * seat[2]))
  return { frame: at, model: to.model, bone: to.bone, position: positionOf(off), rotation: degrees(rotationOf(off)) }
}

export type ThrowStyle = "pass" | "toss" | "lob"

/** Flight length in frames, and whole turns — whole, so the prop lands in the
 *  grip it left in. The height follows from the length: under gravity a longer
 *  flight rises higher, about 35 cm for a pass, 1 m for a toss, 2.6 m for a lob. */
export const THROW_STYLES: Record<ThrowStyle, { frames: number; turns: number }> = {
  pass: { frames: 16, turns: 1 },
  toss: { frames: 28, turns: 1 },
  lob: { frames: 44, turns: 2 },
}

/** MMD units per second squared: 9.8 m/s² at the usual 8 cm to the unit. */
const GRAVITY = 122.5

/** The air's hold on the prop across a flight: its speed across arrives at
 *  e^−DRAG of what it left with, about three quarters. */
const DRAG = 0.3

/** A key every this many frames of flight. The engine tweens between keys this
 *  close in a straight line, which traces the arc and the spin. */
const FLIGHT_STEP = 2

/** Where a throw ends: in a cast member's hand, or at a point in the world. */
export type ThrowTarget = { model: string; bone: string } | { position: Tuple }

/**
 * A throw from wherever the prop is at `release` to `to`.
 *
 * The prop leaves on its own at the release frame and flies as a thrown thing
 * does: across at a steady pace the air slowly takes off, up and down under
 * gravity — slowing to the top of the arc and quickening out of it — tumbling
 * at a constant rate about its own middle. Into a hand, the
 * last key tweens onto that bone in the grip the prop left in, so it lands
 * wherever the hand has moved to. To a point, the prop's middle comes to rest
 * there, turned as it left. Every parent key from the release onward is replaced.
 *
 * The scene must be posed at `release`; `poseAt` moves it, synchronously.
 */
export function planThrow(args: {
  engine: Engine
  prop: PropInfo
  release: number
  to: ThrowTarget
  style: ThrowStyle
  poseAt: (frame: number) => void
}): SceneParentKey[] | null {
  const { engine, prop, to } = args
  const seat = propSeat(engine, prop.id)
  const center = meshCenter(engine, prop.id)
  if (!seat || !center) return null
  const style = THROW_STYLES[args.style]
  const s = prop.transform.scale
  const r = Math.max(1, Math.round(args.release))
  const c = r + style.frames
  const middle = rigid(s * center[0], s * center[1], s * center[2])
  const back = rigid(-s * center[0], -s * center[1], -s * center[2])

  // Release, read live: where the prop is, and the grip it leaves the hand in.
  const hold = holdAt(prop, r)
  const from = placement(engine, prop, hold, seat)
  const grip: { position: Tuple; rotation: Tuple } =
    hold.model !== null ? { position: hold.position, rotation: hold.rotation } : { position: [0, 0, 0], rotation: [0, 0, 0] }

  // Where it ends, as a placement, and the key that holds it there.
  let into: M4
  let landing: SceneParentKey
  if ("position" in to) {
    into = mul(rigid(to.position[0], to.position[1], to.position[2], rotationOf(from)), back)
    landing = { ...freeKey(into, c), tween: true }
  } else {
    args.poseAt(c)
    const catcher = boneFrame(engine, to.model, to.bone)
    args.poseAt(r)
    if (!catcher) return null
    const gripFrame = rigid(grip.position[0], grip.position[1], grip.position[2], castRotationToEngine(grip.rotation))
    into = mul(mul(catcher, gripFrame), rigid(-s * seat[0], -s * seat[1], -s * seat[2]))
    landing = { frame: c, model: to.model, bone: to.bone, position: grip.position, rotation: grip.rotation, tween: true }
  }

  // The arc and the turn are the MIDDLE's, so the prop tumbles about itself;
  // turning its placement about the rig's origin swings the mesh wide.
  const p0 = positionOf(mul(from, middle))
  const p1 = positionOf(mul(into, middle))
  const q0 = rotationOf(from)
  const q1 = rotationOf(into)
  // Solved for the flight time, so the prop leaves fast enough upward to meet
  // the far end exactly as gravity brings it there.
  const seconds = style.frames / FPS
  const fall = (GRAVITY * seconds * seconds) / 2
  const across = (u: number) => (1 - Math.exp(-DRAG * u)) / (1 - Math.exp(-DRAG))
  const axis = new Vec3(1, 0, 0)

  const keys = prop.parentKeys.filter((k) => k.frame < r)
  for (let f = r; f < c; f += FLIGHT_STEP) {
    const u = (f - r) / (c - r)
    const turn = Quat.slerp(q0, q1, u).multiply(Quat.fromAxisAngle(axis, Math.PI * 2 * style.turns * u))
    const h = across(u)
    const at = rigid(
      p0[0] + (p1[0] - p0[0]) * h,
      p0[1] + (p1[1] - p0[1]) * u + fall * u * (1 - u),
      p0[2] + (p1[2] - p0[2]) * h,
      turn,
    )
    keys.push({ ...freeKey(mul(at, back), f), ...(f > r ? { tween: true } : {}) })
  }
  keys.push(landing)
  return keys
}
