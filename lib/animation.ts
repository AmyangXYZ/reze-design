import { Vec3, Quat } from "reze-engine"
import type { AnimationClip, BoneKeyframe, CameraKeyframe, MorphKeyframe } from "reze-engine"

export { Vec3, Quat }
export type { AnimationClip, BoneKeyframe, CameraKeyframe, MorphKeyframe }

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

// Quat → Euler YXZ (degrees) — matches MMD convention
export function quatToEuler(q: Quat) {
  const e = Quat.toEulerOrder(q, "YXZ")
  return { x: e.x * DEG, y: e.y * DEG, z: e.z * DEG }
}

export function eulerToQuat(ex: number, ey: number, ez: number): Quat {
  return Quat.fromEuler(ex * RAD, ey * RAD, ez * RAD)
}

// ─── Bone groups ─────────────────────────────────────────────────────────
export const BONE_GROUPS: Record<string, string[] | null> = {
  "All Bones": null,
  "Upper Body": ["頭", "首", "上半身", "上半身2", "胸", "首根元", "腰"],
  "Left Arm": [
    "左肩",
    "左腕",
    "左ひじ",
    "左手首",
    "左腕捩",
    "左手捩",
    "左肩P",
    "左腕P",
    "左ひじP",
  ],
  "Right Arm": [
    "右肩",
    "右腕",
    "右ひじ",
    "右手首",
    "右腕捩",
    "右手捩",
    "右肩P",
    "右腕P",
    "右ひじP",
  ],
  "Left Hand": [
    "左手首",
    "左親指０",
    "左親指１",
    "左親指２",
    "左親指３",
    "左親指0",
    "左親指1",
    "左親指2",
    "左親指3",
    "左人指１",
    "左人指２",
    "左人指３",
    "左人指1",
    "左人指2",
    "左人指3",
    "左人差し指１",
    "左人差し指２",
    "左人差し指３",
    "左中指１",
    "左中指２",
    "左中指３",
    "左中指1",
    "左中指2",
    "左中指3",
    "左薬指１",
    "左薬指２",
    "左薬指３",
    "左薬指1",
    "左薬指2",
    "左薬指3",
    "左小指１",
    "左小指２",
    "左小指３",
    "左小指1",
    "左小指2",
    "左小指3",
    "左手先",
    "左親指先",
    "左人指先",
    "左中指先",
    "左薬指先",
    "左小指先",
  ],
  "Right Hand": [
    "右手首",
    "右親指０",
    "右親指１",
    "右親指２",
    "右親指３",
    "右親指0",
    "右親指1",
    "右親指2",
    "右親指3",
    "右人指１",
    "右人指２",
    "右人指３",
    "右人指1",
    "右人指2",
    "右人指3",
    "右人差し指１",
    "右人差し指２",
    "右人差し指３",
    "右中指１",
    "右中指２",
    "右中指３",
    "右中指1",
    "右中指2",
    "右中指3",
    "右薬指１",
    "右薬指２",
    "右薬指３",
    "右薬指1",
    "右薬指2",
    "右薬指3",
    "右小指１",
    "右小指２",
    "右小指３",
    "右小指1",
    "右小指2",
    "右小指3",
    "右手先",
    "右親指先",
    "右人指先",
    "右中指先",
    "右薬指先",
    "右小指先",
  ],
  "Lower Body": [
    "下半身",
    "左足",
    "右足",
    "左ひざ",
    "右ひざ",
    "左足首",
    "右足首",
    "左つま先",
    "右つま先",
    "センター",
    "グルーブ",
    "左足ＩＫ",
    "右足ＩＫ",
  ],
}

/** English labels for known bone names (JP + common aliases); used for `首 (Neck)` style UI. */
export const BONE_NAME_EN: Record<string, string> = {
  頭: "Head",
  首: "Neck",
  上半身: "Upper body",
  上半身2: "Upper body 2",
  胸: "Chest",
  首根元: "Neck root",
  head: "Head",
  neck: "Neck",
  "upper body": "Upper body",
  左肩: "Left shoulder",
  左腕: "Left upper arm",
  左ひじ: "Left elbow",
  左手首: "Left wrist",
  左腕捩: "Left arm twist",
  左手捩: "Left wrist twist",
  左肩P: "Left shoulder (P)",
  左腕P: "Left upper arm (P)",
  左ひじP: "Left elbow (P)",
  右肩: "Right shoulder",
  右腕: "Right upper arm",
  右ひじ: "Right elbow",
  右手首: "Right wrist",
  右腕捩: "Right arm twist",
  右手捩: "Right wrist twist",
  右肩P: "Right shoulder (P)",
  右腕P: "Right upper arm (P)",
  右ひじP: "Right elbow (P)",
  下半身: "Lower body",
  左足: "Left leg",
  右足: "Right leg",
  左ひざ: "Left knee",
  右ひざ: "Right knee",
  左足首: "Left ankle",
  右足首: "Right ankle",
  左つま先: "Left toe",
  右つま先: "Right toe",
  センター: "Center",
  グルーブ: "Groove",
  左足ＩＫ: "Left leg IK",
  右足ＩＫ: "Right leg IK",
  左足IK: "Left leg IK",
  右足IK: "Right leg IK",

  左目: "Left eye",
  右目: "Right eye",
  両目: "Both eyes",

  左親指０: "Left thumb 0",
  左親指１: "Left thumb 1",
  左親指２: "Left thumb 2",
  左親指３: "Left thumb 3",
  左人差し指１: "Left index 1",
  左人差し指２: "Left index 2",
  左人差し指３: "Left index 3",
  左人指１: "Left index 1",
  左人指２: "Left index 2",
  左人指３: "Left index 3",
  左中指１: "Left middle 1",
  左中指２: "Left middle 2",
  左中指３: "Left middle 3",
  左薬指１: "Left ring 1",
  左薬指２: "Left ring 2",
  左薬指３: "Left ring 3",
  左小指１: "Left little 1",
  左小指２: "Left little 2",
  左小指３: "Left little 3",
  右親指０: "Right thumb 0",
  右親指１: "Right thumb 1",
  右親指２: "Right thumb 2",
  右親指３: "Right thumb 3",
  右人差し指１: "Right index 1",
  右人差し指２: "Right index 2",
  右人差し指３: "Right index 3",
  右人指１: "Right index 1",
  右人指２: "Right index 2",
  右人指３: "Right index 3",
  右中指１: "Right middle 1",
  右中指２: "Right middle 2",
  右中指３: "Right middle 3",
  右薬指１: "Right ring 1",
  右薬指２: "Right ring 2",
  右薬指３: "Right ring 3",
  右小指１: "Right pinky 1",
  右小指２: "Right pinky 2",
  右小指３: "Right pinky 3",

  左腕捩１: "Left arm twist 1",
  左腕捩２: "Left arm twist 2",
  左腕捩３: "Left arm twist 3",
  右腕捩１: "Right arm twist 1",
  右腕捩２: "Right arm twist 2",
  右腕捩３: "Right arm twist 3",

  左つま先ＩＫ: "Left toe IK",
  右つま先ＩＫ: "Right toe IK",
  左つま先IK: "Left toe IK",
  右つま先IK: "Right toe IK",

  左手先: "Left hand tip",
  右手先: "Right hand tip",
  左親指先: "Left thumb tip",
  右親指先: "Right thumb tip",
  左人指先: "Left index tip",
  右人指先: "Right index tip",
  左中指先: "Left middle tip",
  右中指先: "Right middle tip",
  左薬指先: "Left ring tip",
  右薬指先: "Right ring tip",
  左小指先: "Left pinky tip",
  右小指先: "Right pinky tip",
  両目先: "Both eyes target",
}

function boneNameLookupVariants(name: string): string[] {
  const v: string[] = [name]
  const fw = name.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x30 + 0xff10))
  if (fw !== name) v.push(fw)
  const hw = name.replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
  if (hw !== name) v.push(hw)
  if (name.includes("ＩＫ")) v.push(name.replace(/ＩＫ/g, "IK"))
  if (name.includes("IK")) v.push(name.replace(/IK/g, "ＩＫ"))
  return v
}

function boneEnglishLookup(boneName: string): string | undefined {
  for (const key of boneNameLookupVariants(boneName)) {
    const hit = BONE_NAME_EN[key]
    if (hit) return hit
  }
  const lower = boneName.toLowerCase()
  for (const [k, v] of Object.entries(BONE_NAME_EN)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

export function boneDisplayLabel(boneName: string): string {
  const en = boneEnglishLookup(boneName)
  if (!en) return boneName
  const hasJp = /[\u3040-\u30ff\u4e00-\u9fff]/.test(boneName)
  if (!hasJp && boneName.toLowerCase().trim() === en.toLowerCase().trim()) return boneName
  return `${boneName} (${en})`
}

/** Sidebar-style two lines: English title + JP bone name when they differ (matches reference layout). */
export function boneTitleSubtitle(boneName: string): { title: string; subtitle: string | null } {
  const en = boneEnglishLookup(boneName)
  const hasJp = /[\u3040-\u30ff\u4e00-\u9fff]/.test(boneName)
  if (en && hasJp) return { title: boneName, subtitle: en }
  if (en && boneName.toLowerCase().trim() !== en.toLowerCase().trim()) return { title: boneName, subtitle: en }
  return { title: boneName, subtitle: null }
}

// ─── Channel definitions ─────────────────────────────────────────────────
export interface Channel {
  key: string
  label: string
  color: string
  group: "rot" | "tra"
  get: (kf: BoneKeyframe) => number
  set: (kf: BoneKeyframe, v: number) => void
}

export const ROT_CHANNELS: Channel[] = [
  {
    key: "rx",
    label: "Rot.X",
    color: "#e25555",
    group: "rot",
    get: (kf) => quatToEuler(kf.rotation).x,
    set: (kf, v) => {
      const e = quatToEuler(kf.rotation)
      kf.rotation = eulerToQuat(v, e.y, e.z)
    },
  },
  {
    key: "ry",
    label: "Rot.Y",
    color: "#44bb55",
    group: "rot",
    get: (kf) => quatToEuler(kf.rotation).y,
    set: (kf, v) => {
      const e = quatToEuler(kf.rotation)
      kf.rotation = eulerToQuat(e.x, v, e.z)
    },
  },
  {
    key: "rz",
    label: "Rot.Z",
    color: "#4477dd",
    group: "rot",
    get: (kf) => quatToEuler(kf.rotation).z,
    set: (kf, v) => {
      const e = quatToEuler(kf.rotation)
      kf.rotation = eulerToQuat(e.x, e.y, v)
    },
  },
]

export const TRA_CHANNELS: Channel[] = [
  {
    key: "tx",
    label: "Trans.X",
    color: "#e2a055",
    group: "tra",
    get: (kf) => kf.translation.x,
    set: (kf, v) => {
      kf.translation = new Vec3(v, kf.translation.y, kf.translation.z)
    },
  },
  {
    key: "ty",
    label: "Trans.Y",
    color: "#55bba0",
    group: "tra",
    get: (kf) => kf.translation.y,
    set: (kf, v) => {
      kf.translation = new Vec3(kf.translation.x, v, kf.translation.z)
    },
  },
  {
    key: "tz",
    label: "Trans.Z",
    color: "#7755dd",
    group: "tra",
    get: (kf) => kf.translation.z,
    set: (kf, v) => {
      kf.translation = new Vec3(kf.translation.x, kf.translation.y, v)
    },
  },
]



// ─── Camera channels ─────────────────────────────────────────────────────
// A camera VMD is an ORBIT RIG, not a free camera: the file stores where the
// camera looks (target), how it is turned (euler radians), how far back it sits
// (distance, negative by MMD convention) and its field of view — the eye
// position is derived from those, never stored. See reze-engine's
// camera.ts:vmdEye().
//
// The tabs mirror a bone's: an "All" aggregate plus one per axis, for rotation
// and for target, then the two scalars. Same shape, same hues — a camera is
// another thing with three-axis channels, so it should not need its own
// vocabulary.
//
// `ip` is which of the VMD's SIX interpolation channels the curve rides on:
// 0=posX 1=posY 2=posZ 3=rotation 4=distance 5=fov. Note that all three euler
// components share channel 3 — MMD eases a camera's whole rotation on one
// curve, so yaw cannot be timed differently from pitch. That is the format, not
// a simplification here: it is why the rotation axes get their own TABS (you
// can edit each axis's values) but share one interpolation curve.

export interface CameraChannel {
  key: string
  label: string
  color: string
  group: "rot" | "tgt" | "dist" | "fov"
  /** Index into the 24-byte interpolation table's six channels. */
  ip: number
  get: (kf: CameraKeyframe) => number
  set: (kf: CameraKeyframe, v: number) => void
}

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

export const CAMERA_CHANNELS: CameraChannel[] = [
  // Euler is stored in radians and shown in degrees — nobody authors a camera
  // angle in radians, and every other rotation readout in this app is degrees.
  {
    key: "crx", label: "Rot.X", color: "#e25555", group: "rot", ip: 3,
    get: (kf) => kf.rotation.x * RAD2DEG,
    set: (kf, v) => { kf.rotation = new Vec3(v * DEG2RAD, kf.rotation.y, kf.rotation.z) },
  },
  {
    key: "cry", label: "Rot.Y", color: "#44bb55", group: "rot", ip: 3,
    get: (kf) => kf.rotation.y * RAD2DEG,
    set: (kf, v) => { kf.rotation = new Vec3(kf.rotation.x, v * DEG2RAD, kf.rotation.z) },
  },
  {
    key: "crz", label: "Rot.Z", color: "#4477dd", group: "rot", ip: 3,
    get: (kf) => kf.rotation.z * RAD2DEG,
    set: (kf, v) => { kf.rotation = new Vec3(kf.rotation.x, kf.rotation.y, v * DEG2RAD) },
  },
  {
    key: "cgx", label: "Tgt.X", color: "#e2a055", group: "tgt", ip: 0,
    get: (kf) => kf.target.x,
    set: (kf, v) => { kf.target = new Vec3(v, kf.target.y, kf.target.z) },
  },
  {
    key: "cgy", label: "Tgt.Y", color: "#55bba0", group: "tgt", ip: 1,
    get: (kf) => kf.target.y,
    set: (kf, v) => { kf.target = new Vec3(kf.target.x, v, kf.target.z) },
  },
  {
    key: "cgz", label: "Tgt.Z", color: "#7755dd", group: "tgt", ip: 2,
    get: (kf) => kf.target.z,
    set: (kf, v) => { kf.target = new Vec3(kf.target.x, kf.target.y, v) },
  },
  {
    key: "cds", label: "Dist", color: "#c084fc", group: "dist", ip: 4,
    get: (kf) => kf.distance,
    set: (kf, v) => { kf.distance = v },
  },
  {
    key: "cfv", label: "FOV", color: "#22d3ee", group: "fov", ip: 5,
    get: (kf) => kf.fov,
    set: (kf, v) => { kf.fov = Math.max(1, Math.min(150, Math.round(v))) },
  },
]

const CAM_CH = (key: string): CameraChannel => CAMERA_CHANNELS.find((c) => c.key === key)!

/** Which curves a camera tab draws — an "All" tab draws its whole group, an
 *  axis tab draws one, exactly like a bone's. */
export function cameraChannelsForTab(tab: string): CameraChannel[] {
  switch (tab) {
    case "camAllRot": return CAMERA_CHANNELS.filter((c) => c.group === "rot")
    case "camRx": return [CAM_CH("crx")]
    case "camRy": return [CAM_CH("cry")]
    case "camRz": return [CAM_CH("crz")]
    case "camAllTgt": return CAMERA_CHANNELS.filter((c) => c.group === "tgt")
    case "camTx": return [CAM_CH("cgx")]
    case "camTy": return [CAM_CH("cgy")]
    case "camTz": return [CAM_CH("cgz")]
    case "camDist": return [CAM_CH("cds")]
    case "camFov": return [CAM_CH("cfv")]
    default: return []
  }
}

/** The timeline's camera tabs, laid out like the bone set: aggregate, axes,
 *  separator, aggregate, axes, separator, scalars. */
export const CAMERA_TABS = [
  { key: "camAllRot", label: "All Rot", color: null, sep: false },
  { key: "camRx", label: "X", color: "#e25555", sep: false },
  { key: "camRy", label: "Y", color: "#44bb55", sep: false },
  { key: "camRz", label: "Z", color: "#4477dd", sep: false },
  { key: "_camSep1", label: "", color: null, sep: true },
  { key: "camAllTgt", label: "All Tgt", color: null, sep: false },
  { key: "camTx", label: "X", color: "#e2a055", sep: false },
  { key: "camTy", label: "Y", color: "#55bba0", sep: false },
  { key: "camTz", label: "Z", color: "#7755dd", sep: false },
  { key: "_camSep2", label: "", color: null, sep: true },
  { key: "camDist", label: "Distance", color: "#c084fc", sep: false },
  { key: "camFov", label: "FOV", color: "#22d3ee", sep: false },
] as const

/**
 * The SIX curves the file actually eases, for the interpolation editor.
 *
 * Deliberately not the tab list above: the three rotation axes are three tabs
 * but one bezier, so offering "Rot X / Rot Y / Rot Z" here would be three
 * controls editing the same 4 bytes — three ways to be surprised.
 */
export const CAMERA_IP_TABS = [
  // Same order as the timeline's own tabs — rotation, then target, then the
  // scalars. The numbers are the VMD's channel indices, which run target-first;
  // following those here would put the two tab strips in different orders for
  // no reason a reader could see.
  { ip: 3, label: "Rotation" },
  { ip: 0, label: "Tgt X" },
  { ip: 1, label: "Tgt Y" },
  { ip: 2, label: "Tgt Z" },
  { ip: 4, label: "Distance" },
  { ip: 5, label: "FOV" },
] as const

/**
 * A camera channel's two bezier control points.
 *
 * MMD packs each channel's four bytes CONTIGUOUSLY as [x1, x2, y1, y2] —
 * unlike a bone's 64-byte table, which interleaves them. So channel c's points
 * are (ip[4c], ip[4c+2]) and (ip[4c+1], ip[4c+3]). Falls back to the linear
 * default for a hand-authored keyframe that carries no table.
 */
export function cameraIpPair(
  ip: Uint8Array | undefined,
  channel: number,
): [{ x: number; y: number }, { x: number; y: number }] {
  const b = channel * 4
  if (!ip || ip.length < b + 4) return [{ x: 20, y: 20 }, { x: 107, y: 107 }]
  return [
    { x: ip[b], y: ip[b + 2] },
    { x: ip[b + 1], y: ip[b + 3] },
  ]
}

/** Which interpolation channel a timeline tab is easing. An "All Tgt" view
 *  spans three of them, so it opens on the first. */
export function cameraIpChannelForTab(tab: string): number {
  const chans = cameraChannelsForTab(tab)
  return chans.length > 0 ? chans[0].ip : 3
}

/** Default tab when the camera is selected — rotation shows all three euler
 *  curves at once, which is the most of the shot you can see in one view. */
export const CAMERA_DEFAULT_TAB = "camAllRot"

export function isCameraTab(tab: string): boolean {
  return tab.startsWith("cam")
}
