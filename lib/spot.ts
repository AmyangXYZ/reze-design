// A spot lamp as the lamp panel edits it: Blender's dials (Spot Size, Blend,
// a rotation) over what the document stores (aim, angle, innerAngle).

type V3 = [number, number, number]

const DEG = Math.PI / 180

/** Default cone and blend for a lamp turned into a spot. Blend 0.2 is the
 *  engine's own default for a spot with no inner angle (inner = 0.8 × outer). */
export const SPOT_ANGLE = 45
export const SPOT_BLEND = 0.2

/** Pitch and yaw in degrees. Yaw 0 points along +Z, toward a model's back
 *  (models face −Z); pitch is up from level, −90 straight down. */
export function pitchYawOf(aim: V3): { pitch: number; yaw: number } {
  const [x, y, z] = aim
  return { pitch: Math.asin(Math.max(-1, Math.min(1, y))) / DEG, yaw: Math.atan2(x, z) / DEG }
}

export function aimOf(pitch: number, yaw: number): V3 {
  const p = pitch * DEG
  const w = yaw * DEG
  return [Math.cos(p) * Math.sin(w), Math.sin(p), Math.cos(p) * Math.cos(w)]
}

/** Blender's Blend is the soft fraction of the cone; the document keeps the
 *  full-strength inner angle instead. */
export const blendOf = (angle: number, innerAngle: number | undefined): number =>
  innerAngle === undefined ? SPOT_BLEND : Math.max(0, Math.min(1, 1 - innerAngle / Math.max(angle, 1e-3)))

export const innerOf = (angle: number, blend: number): number => angle * (1 - blend)

/** The unit direction from `from` to `to`, or straight down when they meet. */
export function aimAt(from: V3, to: V3): V3 {
  const d: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const len = Math.hypot(d[0], d[1], d[2])
  return len > 1e-3 ? [d[0] / len, d[1] / len, d[2] / len] : [0, -1, 0]
}

/** The quaternion (xyzw) turning +Y onto unit `d`: how the overlay's `line`,
 *  which runs along its local +Y, is pointed. */
export function turnUpTo(d: V3): [number, number, number, number] {
  const [x, y, z] = d
  if (y < -0.999999) return [1, 0, 0, 0]
  // Half-way quaternion between +Y and d: axis = up × d, w = 1 + up·d.
  const q: [number, number, number, number] = [z, 0, -x, 1 + y]
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** p turned by unit quaternion q (xyzw). */
export function rotate(q: { x: number; y: number; z: number; w: number }, p: V3): V3 {
  const { x: qx, y: qy, z: qz, w: qw } = q
  const tx = 2 * (qy * p[2] - qz * p[1])
  const ty = 2 * (qz * p[0] - qx * p[2])
  const tz = 2 * (qx * p[1] - qy * p[0])
  return [
    p[0] + qw * tx + (qy * tz - qz * ty),
    p[1] + qw * ty + (qz * tx - qx * tz),
    p[2] + qw * tz + (qx * ty - qy * tx),
  ]
}

/** A segment from a to b, as the overlay's `line` takes it. */
export type Segment = { position: V3; rotation: [number, number, number, number]; length: number }

function segment(a: V3, b: V3): Segment {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const length = Math.hypot(d[0], d[1], d[2])
  return { position: a, rotation: turnUpTo(length > 0 ? [d[0] / length, d[1] / length, d[2] / length] : [0, 1, 0]), length }
}

/**
 * A spot's cone as line segments: four edges from the lamp and a ring where
 * the cone ends, `length` along the aim. The overlay's `circle` always faces
 * the camera, so a rim square to the aim has to be drawn as a polygon.
 */
export function coneSegments(apex: V3, aim: V3, angle: number, length: number, rimSides = 32): { edges: Segment[]; rim: Segment[] } {
  const half = Math.min(angle, 179) * 0.5 * DEG
  const r = Math.tan(half) * length
  // Two axes square to the aim.
  const ref: V3 = Math.abs(aim[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const u0: V3 = [aim[1] * ref[2] - aim[2] * ref[1], aim[2] * ref[0] - aim[0] * ref[2], aim[0] * ref[1] - aim[1] * ref[0]]
  const ul = Math.hypot(u0[0], u0[1], u0[2])
  const u: V3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
  const v: V3 = [aim[1] * u[2] - aim[2] * u[1], aim[2] * u[0] - aim[0] * u[2], aim[0] * u[1] - aim[1] * u[0]]
  const c: V3 = [apex[0] + aim[0] * length, apex[1] + aim[1] * length, apex[2] + aim[2] * length]
  const at = (t: number): V3 => {
    const cs = Math.cos(t) * r
    const sn = Math.sin(t) * r
    return [c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]
  }
  const edges = [0, 1, 2, 3].map((k) => segment(apex, at((k / 4) * Math.PI * 2)))
  const rim = Array.from({ length: rimSides }, (_, k) => segment(at((k / rimSides) * Math.PI * 2), at(((k + 1) / rimSides) * Math.PI * 2)))
  return { edges, rim }
}
