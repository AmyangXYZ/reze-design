// A glTF stage as the app loads it: the file Blender exports, read into what the
// stage path already understands.
//
// A stage arrives as ONE `.glb` — from Blender's own exporter, whether a person
// built the scene there or tools/stages/unity_to_glb.py did — carrying its
// meshes, its materials with their maps, its lamps and sun, and under
// `extras.reze` what glTF cannot say: the app's look for a material, a sky that
// casts nothing, the cast's fill, the world it is lit by.
//
// It becomes the folder a converted PMX stage is: the .pmx, `tex/` for what
// each material paints, `maps/` for its normal, occlusion-roughness-metal and
// emissive maps under the material's own name, `<Name>.hdr` for the world and
// `<Name>.lights.json` for the rig. Everything downstream — loading, the bundle,
// publishing, reloading — is the PMX path, unchanged; the maps come back by
// their names (material-maps.ts) and the looks travel in the scene document.
//
// UNITS: glTF is metres and a PMX unit is 8 cm, so 12.5 per metre; glTF is
// right-handed and PMX left-handed, both Y up, so Z is mirrored and every
// triangle's winding turned back. A lamp's brightness is stated one metre away
// and the app's per-PMX-unit intensity is that x 12.5², by the inverse square.

import { particleEffectWgsl, type ParticleClass } from "@/lib/unity-particles"
import { writePmxDocument, type PmxDocument, type PmxMaterial, type PmxVertex, type ShaderGraph, type StyleGroup, UNLIT_GRAPH } from "reze-engine"
import { libraryGraph } from "@/lib/materials"
import { relFilePath } from "@/lib/scene-files"
import { SURFACE_LOOKS, stageLookFor } from "@/lib/stage-style"

const PMX_PER_METRE = 12.5
/** Lumens per watt at 555 nm: a light stated in candela, as glTF states one,
 *  read back as the radiometric brightness the app lights with. */
const LUMENS_PER_WATT = 683

// ── The file ──

type Gltf = {
  asset?: { generator?: string }
  scene?: number
  scenes?: { nodes?: number[]; extras?: unknown }[]
  nodes?: GltfNode[]
  meshes?: { name?: string; primitives: GltfPrimitive[] }[]
  materials?: GltfMaterial[]
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[]
  images?: { bufferView?: number; mimeType?: string; name?: string; uri?: string }[]
  accessors?: GltfAccessor[]
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
  extensions?: { KHR_lights_punctual?: { lights: GltfLight[] } }
}
type GltfNode = {
  name?: string
  children?: number[]
  mesh?: number
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
  extensions?: { KHR_lights_punctual?: { light: number } }
  extras?: unknown
}
type GltfPrimitive = { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }
type TextureRef = {
  index: number
  scale?: number
  strength?: number
  extensions?: { KHR_texture_transform?: { offset?: number[]; rotation?: number; scale?: number[] } }
}
type GltfMaterial = {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
    baseColorTexture?: TextureRef
    metallicFactor?: number
    roughnessFactor?: number
    metallicRoughnessTexture?: TextureRef
  }
  normalTexture?: TextureRef
  occlusionTexture?: TextureRef
  emissiveTexture?: TextureRef
  emissiveFactor?: number[]
  alphaMode?: "OPAQUE" | "MASK" | "BLEND"
  alphaCutoff?: number
  doubleSided?: boolean
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number }; KHR_materials_unlit?: object }
  extras?: unknown
}
type GltfAccessor = {
  bufferView?: number
  byteOffset?: number
  componentType: 5120 | 5121 | 5122 | 5123 | 5125 | 5126
  normalized?: boolean
  count: number
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4"
}
type GltfLight = {
  name?: string
  type: "directional" | "point" | "spot"
  color?: number[]
  intensity?: number
  range?: number
  spot?: { innerConeAngle?: number; outerConeAngle?: number }
}

/** What our exporter writes under `extras.reze`; a hand-built stage has none. */
type RezeMaterial = { shader?: string; unlit?: boolean; additive?: boolean; sky?: boolean; castShadow?: boolean; look?: string | null; queue?: number; effect?: EffectSpec; ripple?: RippleSpec; sea?: SeaSpec; fresnel?: FresnelSpec }

/** One layer of a moving effect sheet: its picture (base64 PNG, in the file only)
 *  and the numbers that place it — see tools/stages/unity_effect_bake.py. */
export type EffectLayer = { png?: string; scale: [number, number]; offset: [number, number]; rotation: number; tiling: boolean; speed: [number, number] }
/** The game's effect shader (Effect_Common) for a sheet whose layers scroll. */
export type EffectSpec = {
  layers: { main?: EffectLayer; plus?: EffectLayer; mask?: EffectLayer }
  /** The noise that bends the flagged layers' UVs (_UseNoise), in slot 3. */
  noise?: { png?: string; scale: [number, number]; offset: [number, number]; speed: [number, number]; strength: [number, number]; main: boolean; plus: boolean; mask: boolean }
  mainPow: number[]
  color: number[]
  redAlphaMain: boolean
  plusPow: number[]
  plusColor: number[]
  redAlphaPlus: boolean
  plusStrength: number
  plusColorOn: number
  plusAlphaOn: number
  plusMode: number
  redAlphaMask: boolean
  maskStrength: number
  dstBlend: number
}
/** The game's Ripplet water (tools/stages/unity_to_glb.py, ripple_spec): two
 *  layers of its ripple map in world metres, and how it reflects. */
export type RippleSpec = {
  /** Per layer: UV per metre along (-x, z), UV per second, normal strength. */
  layers: { scale: [number, number]; drift: [number, number]; strength: number }[]
  /** The blend of the two toward straight up (_RippleScale). */
  strength: number
  /** _Color, linear, with its alpha. */
  color: number[]
  /** _ReflectionColor, linear; its alpha is what grazing angles reach. */
  reflection: number[]
  /** _ReflectionIntensity, and the reflection's own scale (_CustomEnvCubeScale, applied twice). */
  intensity: number
  cube: number
  /** SimSceneTint, the game's final multiply. */
  tint?: number
  /** Its own reflection (_CustomEnvCube) as an RGBM equirect in slot 1: rgb · a · range. */
  env?: { png?: string; range: number }
}
/** The game's sea (tools/stages/unity_to_glb.py, sea_spec): its depth over the
 *  stage baked from the beds under it, and the shallows' caustics and foam. */
/** ZTong/Tong_jichu_Fresnel_Add's live half (tools/stages/unity_effect_bake.bake_fresnel):
 *  its mask is baked into the emissive picture, this is the rest. */
export type FresnelSpec = {
  /** _Fresnel_Color.rgb · .a, linear, past white as the game's HDR colour is */
  color: number[]
  /** e^(1 − _Fresnel_Intensity) */
  power: number
  /** _OneMinus: bright where the surface faces the eye, not at its rim */
  oneMinus: boolean
}

export type SeaSpec = {
  /** The water's vertical depth in game units over [0, range], an 8-bit map
   *  laid over glTF (x, z) from `origin`, `size` metres across. */
  depth: { png?: string; origin: [number, number]; size: [number, number]; range: number }
  caustics: { png?: string; tiling: number; speed: number; brightness: number }
  foam: { png?: string; tiling: number; speed: number; clipping: number; length: number; falloff: number; color: number[] }
  /** _RimAplha, _RimSoft: the soft edge's alpha from depth. */
  rim: [number, number]
  /** _MainColor, linear. */
  color: number[]
  /** _NormalStrength. */
  normal: number
  /** The ripple normal's tiling on the mesh UV and speed a second, and how far
   *  it bends the caustics (_NormalTiling, _NormalSpeed, _CausticsDistortion). */
  ripple?: [number, number, number]
}
type RezeLamp = { range?: number; intensity?: number; color?: number[]; angle?: number; innerAngle?: number }
type RezeSun = { color?: number[]; shadow?: boolean }
type RezeScene = {
  version?: number
  fill?: { color: number[]; strength: number } | null
  /** An environment image, or a flat colour, with the strength it is lit at. */
  world?: { format?: string; base64?: string; color?: number[]; strength?: number } | null
  /** What the scene was authored under: Blender's names for the transform. */
  view?: { transform?: string; look?: string; exposure?: number } | null
  /** The game's colour grade as the cube its pipeline bakes: size³ texels,
   *  8-bit sRGB, red fastest — see tools/stages/unity_grading.py. */
  grading?: { size?: number; format?: string; base64?: string } | null
  /** The game's diffuse ambient, nine RGB SH coefficients in glTF axes — see
   *  tools/stages/unity_to_glb.game_ambient. */
  ambient?: { sh?: number[] } | null
  /** The game's distance fog, glTF metres — see unity_to_glb.game_fog. */
  fog?: (FogLayerM & { dyn?: FogLayerM | null }) | null
  /** The game's character shadow on its ground: the way to its light (glTF
   *  axes), linear colour, alpha — see unity_to_glb. */
  notes?: string[]
}

type FogLayerM = { color: number[]; amount: number; distance: number[]; height: number[] }

/** Blender's view transform names as the app's. */
const VIEW_TRANSFORM: Record<string, "standard" | "filmic" | "agx"> = {
  AgX: "agx",
  Filmic: "filmic",
  Standard: "standard",
  "Khronos PBR Neutral": "standard",
}

const reze = <T>(holder: { extras?: unknown } | undefined): T | null => {
  const ex = holder?.extras as { reze?: unknown } | undefined
  const r = ex?.reze
  if (r === undefined || r === null) return null
  // Blender writes a dict property as an object; an older export wrote JSON.
  if (typeof r === "string") {
    try {
      return JSON.parse(r) as T
    } catch {
      return null
    }
  }
  return r as T
}

function readGlb(buffer: ArrayBuffer): { json: Gltf; bin: Uint8Array } {
  const v = new DataView(buffer)
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb file")
  if (v.getUint32(4, true) !== 2) throw new Error(`glTF version ${v.getUint32(4, true)} is not 2`)
  let at = 12
  let json: Gltf | null = null
  let bin: Uint8Array | null = null
  while (at + 8 <= buffer.byteLength) {
    const len = v.getUint32(at, true)
    const type = v.getUint32(at + 4, true)
    const body = new Uint8Array(buffer, at + 8, len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as Gltf
    else if (type === 0x004e4942) bin = body
    at += 8 + len
  }
  if (!json) throw new Error("the .glb has no JSON chunk")
  return { json, bin: bin ?? new Uint8Array(0) }
}

// ── Accessors ──

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as const

function readAccessor(g: Gltf, bin: Uint8Array, index: number): Float32Array | Uint32Array {
  const a = g.accessors![index]
  const n = COMPONENTS[a.type]
  const size = BYTES[a.componentType]
  const out = a.componentType === 5126 || a.normalized ? new Float32Array(a.count * n) : new Uint32Array(a.count * n)
  if (a.bufferView === undefined) return out
  const bv = g.bufferViews![a.bufferView]
  const stride = bv.byteStride ?? n * size
  const base = bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const view = new DataView(bin.buffer, 0)
  for (let i = 0; i < a.count; i++) {
    const at = base + i * stride
    for (let c = 0; c < n; c++) {
      const p = at + c * size
      let value: number
      switch (a.componentType) {
        case 5120:
          value = a.normalized ? Math.max(view.getInt8(p) / 127, -1) : view.getInt8(p)
          break
        case 5121:
          value = a.normalized ? view.getUint8(p) / 255 : view.getUint8(p)
          break
        case 5122:
          value = a.normalized ? Math.max(view.getInt16(p, true) / 32767, -1) : view.getInt16(p, true)
          break
        case 5123:
          value = a.normalized ? view.getUint16(p, true) / 65535 : view.getUint16(p, true)
          break
        case 5125:
          value = view.getUint32(p, true)
          break
        default:
          value = view.getFloat32(p, true)
      }
      out[i * n + c] = value
    }
  }
  return out
}

// ── Transforms (column-major mat4, as glTF stores them) ──

type Mat4 = Float64Array

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return o
}

function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix) return Float64Array.from(n.matrix)
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz
  return new Float64Array([
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ])
}

const xformPoint = (m: Mat4, x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
]

/** Normals take the inverse transpose of the upper 3x3, so a squashed object
 *  keeps its normals perpendicular. */
function normalMatrix(m: Mat4): [number, number, number, number, number, number, number, number, number] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C || 1
  // inverse = adj / det; transposed inverse = adj^T / det, laid out row-major.
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det]
}

const unit = (v: [number, number, number]): [number, number, number] => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** glTF metres to PMX units: Z mirrored, 12.5 per metre. */
const toPmx = (p: [number, number, number]): [number, number, number] => [p[0] * PMX_PER_METRE, p[1] * PMX_PER_METRE, -p[2] * PMX_PER_METRE]
const toPmxDir = (d: [number, number, number]): [number, number, number] => [d[0], d[1], -d[2]]

// ── Colours ──

const srgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
const hex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(srgb(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, "0")).join("")

/** A linear colour as the hex the document stores and the strength that scales it. */
function colourAndStrength(rgb: number[]): { color: string; strength: number } {
  const peak = Math.max(rgb[0], rgb[1], rgb[2])
  if (peak <= 0) return { color: "#000000", strength: 0 }
  return { color: hex(rgb.map((c) => c / peak)), strength: peak }
}

const fileSafe = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, "_")
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }

// ── The stage ──

export type GlbMaterial = {
  name: string
  emissiveStrength: number
  unlit: boolean
  additive: boolean
  sky: boolean
  look: string | null
  alphaMode: "OPAQUE" | "MASK" | "BLEND"
  /** What the 1x1 stand-ins hold when a map is missing. */
  roughness: number
  metallic: number
  emissiveFactor: [number, number, number]
  /** A moving effect sheet: its layers are its maps (_N main, _ORM plus, _E
   *  mask) and effectSheetGraph draws them. The pictures stay out of here. */
  effect: EffectSpec | null
  /** The game's water, drawn by rippletGraph. */
  ripple: RippleSpec | null
  /** A fresnel glow, drawn by fresnelGraph. */
  fresnel: FresnelSpec | null
  /** The game's sea, drawn by seaGraph. */
  sea: SeaSpec | null
}

export type GlbStage = {
  /** The PMX, its textures and maps, its world and rig — the folder a converted
   *  stage is, every path under `dir`. */
  files: { path: string; bytes: Uint8Array | Blob }[]
  pmxPath: string
  materials: GlbMaterial[]
  /** Per material: the map files under `maps/`, or the stand-in each needs. */
  maps: Map<string, { normal: Uint8Array | null; orm: Uint8Array | null; emissive: Uint8Array | null }>
  notes: string[]
}

type Run = { material: number; positions: number[]; normals: number[]; uvs: number[]; indices: number[] }

/**
 * Read a .glb into the stage folder it becomes. Pure: no decoding, no DOM, so
 * it runs in a test on the real file.
 */
export function glbToStage(buffer: ArrayBuffer, glbPath: string): GlbStage {
  const { json: g, bin } = readGlb(buffer)
  const notes: string[] = []
  const dir = glbPath.slice(0, glbPath.lastIndexOf("/") + 1)
  const stem = glbPath.slice(dir.length).replace(/\.glb$/i, "")
  const sceneExtras = reze<RezeScene>(g.scenes?.[g.scene ?? 0]) ?? {}
  for (const n of sceneExtras.notes ?? []) notes.push(`export: ${n}`)

  // ── Geometry, one run per material, in PMX space ──
  const runs = new Map<number, Run>()
  const lamps: { node: GltfNode; world: Mat4 }[] = []
  // A CANDLE FLAME IS AN EMPTY NAMED flame.NN, its +Y running from the wick
  // to the flame's tip and as long as the flame. It becomes a bone from its
  // origin to its +Y unit point, which the Candle Flames effect stands on.
  // splash.NN and spray.NN are the same, for the water effects: +Y the way the
  // water leaves, as long as the game's largest splash there.
  const wicks: { name: string; head: [number, number, number]; tail: [number, number, number] }[] = []
  const visit = (index: number, parent: Mat4) => {
    const node = g.nodes![index]
    const world = mul(parent, localMatrix(node))
    if (node.extensions?.KHR_lights_punctual) lamps.push({ node, world })
    if (node.mesh === undefined && (/^(flame|splash|spray)\.\d+$/i.test(node.name ?? "") || /^ps\d+_\d+$/i.test(node.name ?? ""))) {
      const head = toPmx(xformPoint(world, 0, 0, 0))
      const tail = toPmx(xformPoint(world, 0, 1, 0))
      wicks.push({ name: node.name!, head, tail: [tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]] })
    }
    if (node.mesh !== undefined) {
      const nm = normalMatrix(world)
      for (const prim of g.meshes![node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4) {
          notes.push(`${node.name ?? "mesh"}: a primitive that is not triangles was left out`)
          continue
        }
        if (prim.attributes.POSITION === undefined) continue
        const mat = prim.material ?? -1
        let run = runs.get(mat)
        if (!run) {
          run = { material: mat, positions: [], normals: [], uvs: [], indices: [] }
          runs.set(mat, run)
        }
        const pos = readAccessor(g, bin, prim.attributes.POSITION)
        const nor = prim.attributes.NORMAL !== undefined ? readAccessor(g, bin, prim.attributes.NORMAL) : null
        const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, bin, prim.attributes.TEXCOORD_0) : null
        // A TILED OR OFFSET TEXTURE GOES INTO THE UVs. Blender writes a Mapping
        // node on the base colour as KHR_texture_transform, and a PMX has one UV
        // and no per-slot transform — the same fold the Unity converter does
        // for a material's tiling. The base colour's transform is the one
        // applied; every map of a material shares the UVs it produces.
        const tt = (mat >= 0 ? g.materials?.[mat]?.pbrMetallicRoughness?.baseColorTexture?.extensions?.KHR_texture_transform : undefined) ?? null
        const [ox, oy] = tt?.offset ?? [0, 0]
        const [sx, sy] = tt?.scale ?? [1, 1]
        const cr = Math.cos(tt?.rotation ?? 0), sr = Math.sin(tt?.rotation ?? 0)
        const count = pos.length / 3
        const base = run.positions.length / 3
        for (let i = 0; i < count; i++) {
          const p = toPmx(xformPoint(world, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
          run.positions.push(p[0], p[1], p[2])
          if (nor) {
            const x = nor[i * 3], y = nor[i * 3 + 1], z = nor[i * 3 + 2]
            const n = unit([nm[0] * x + nm[1] * y + nm[2] * z, nm[3] * x + nm[4] * y + nm[5] * z, nm[6] * x + nm[7] * y + nm[8] * z])
            run.normals.push(n[0], n[1], -n[2])
          } else run.normals.push(0, 1, 0)
          if (uv && tt) {
            // uv' = T · R · S · uv, as the extension defines the matrix.
            const u = uv[i * 2] * sx, v = uv[i * 2 + 1] * sy
            run.uvs.push(cr * u + sr * v + ox, -sr * u + cr * v + oy)
          } else run.uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0)
        }
        const idx = prim.indices !== undefined ? readAccessor(g, bin, prim.indices) : Uint32Array.from({ length: count }, (_, i) => i)
        // The Z mirror turned every triangle inside out; swap two corners back.
        for (let i = 0; i + 2 < idx.length; i += 3) run.indices.push(base + idx[i], base + idx[i + 2], base + idx[i + 1])
      }
    }
    for (const c of node.children ?? []) visit(c, world)
  }
  for (const root of g.scenes?.[g.scene ?? 0]?.nodes ?? []) visit(root, IDENTITY)
  if (!runs.size) throw new Error(`${glbPath} has no triangles`)

  // ── Images, as files under tex/ ──
  const imageFile = new Map<number, string>()
  const files: GlbStage["files"] = []
  const imageBytes = (index: number | undefined): Uint8Array | null => {
    if (index === undefined) return null
    const img = g.images?.[index]
    if (!img || img.bufferView === undefined) return null
    const bv = g.bufferViews![img.bufferView]
    return bin.subarray((bv.byteOffset ?? 0), (bv.byteOffset ?? 0) + bv.byteLength)
  }
  const imageOf = (ref: TextureRef | undefined): number | undefined => {
    if (!ref) return undefined
    const t = g.textures?.[ref.index]
    return t?.extensions?.EXT_texture_webp?.source ?? t?.source
  }
  const texturePath = (index: number | undefined): string | null => {
    if (index === undefined) return null
    if (imageFile.has(index)) return imageFile.get(index)!
    const img = g.images?.[index]
    const bytes = imageBytes(index)
    if (!img || !bytes) {
      notes.push(`image ${index} is not embedded in the .glb and was left out`)
      return null
    }
    const ext = EXT[img.mimeType ?? ""] ?? "png"
    const rel = `tex/${fileSafe(img.name || `image_${index}`)}_${index}.${ext}`
    files.push({ path: dir + rel, bytes })
    imageFile.set(index, rel)
    return rel
  }

  // THE SKY GOES FIRST, OUTERMOST FIRST. The engine draws transparent
  // materials in the PMX's order and each writes its depth once its colour has
  // blended, so a nearer sky layer drawn first hides every farther one behind
  // it — x309's stars stand just inside its nebula, its light columns just
  // outside. Measured from the vertical axis: the layers are nested cylinders.
  const skyRadius = (run: Run) => {
    const rs: number[] = []
    for (let i = 0; i < run.positions.length; i += 3) rs.push(Math.hypot(run.positions[i], run.positions[i + 2]))
    rs.sort((a, b) => a - b)
    return rs.length ? rs[rs.length >> 1] : 0
  }
  const ordered = [...runs.values()]
  const skyOf = (run: Run) => (run.material >= 0 ? (reze<RezeMaterial>(g.materials?.[run.material])?.sky ?? false) : false)
  // AND THEN BY THE GAME'S RENDER QUEUE. A PMX draws its translucent materials
  // in file order; Unity sorts them by queue, so X323's water stains (3001,
  // 3002) lie on the glass under them (3000). In file order the glass came
  // after and greyed them out. A file without queues keeps its own order: the
  // sort is stable and every material then shares the one default.
  const queueOf = (run: Run) => {
    const m = run.material >= 0 ? g.materials?.[run.material] : undefined
    const q = reze<RezeMaterial>(m)?.queue
    if (typeof q === "number" && Number.isFinite(q)) return q
    return m?.alphaMode === "BLEND" ? 3000 : m?.alphaMode === "MASK" ? 2450 : 2000
  }
  const unlitOf = (run: Run) => (run.material >= 0 ? (reze<RezeMaterial>(g.materials?.[run.material])?.unlit ?? false) : false)
  ordered.sort((a, b) => {
    const sa = skyOf(a), sb = skyOf(b)
    if (sa !== sb) return sa ? -1 : 1
    if (sa && sb) return skyRadius(b) - skyRadius(a)
    // Within one queue Unity sorts by distance, which a file order cannot
    // follow. An unlit effect layer is a decal LYING ON a surface, so it is
    // the nearer of the two wherever they meet: it goes after. X323's fourth
    // stain shares the glass's 3000.
    return queueOf(a) - queueOf(b) || Number(unlitOf(a)) - Number(unlitOf(b))
  })

  // ── Materials ──
  const textures: string[] = []
  const textureIndex = (rel: string | null) => {
    if (!rel) return -1
    const at = textures.indexOf(rel)
    if (at >= 0) return at
    textures.push(rel)
    return textures.length - 1
  }
  const taken = new Set<string>()
  const vertices: PmxVertex[] = []
  const indices: number[] = []
  const pmxMaterials: PmxMaterial[] = []
  const materials: GlbMaterial[] = []
  const maps: GlbStage["maps"] = new Map()
  for (const run of ordered) {
    if (!run.indices.length) continue
    const m: GltfMaterial = run.material >= 0 ? (g.materials?.[run.material] ?? {}) : {}
    const ex = reze<RezeMaterial>(m) ?? {}
    const wanted = m.name || `material_${run.material}`
    let name = wanted
    for (let n = 2; taken.has(name); n++) name = `${wanted} ${n}`
    taken.add(name)
    const pbr = m.pbrMetallicRoughness ?? {}
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1]
    const alphaMode = m.alphaMode ?? "OPAQUE"
    const strength = m.emissiveTexture || (m.emissiveFactor ?? [0, 0, 0]).some((c) => c > 0) ? (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1) : 0
    const unlit = !!m.extensions?.KHR_materials_unlit || !!ex.unlit
    const sky = !!ex.sky
    const castShadow = ex.castShadow ?? !sky
    const base = vertices.length
    for (let i = 0; i < run.positions.length / 3; i++) {
      vertices.push({
        position: [run.positions[i * 3], run.positions[i * 3 + 1], run.positions[i * 3 + 2]],
        normal: [run.normals[i * 3], run.normals[i * 3 + 1], run.normals[i * 3 + 2]],
        uv: [run.uvs[i * 2], run.uvs[i * 2 + 1]],
        additionalUv: [],
        weightType: 0,
        bones: [0],
        weights: [],
        edgeScale: 1,
      })
    }
    for (const i of run.indices) indices.push(base + i)
    pmxMaterials.push({
      name,
      nameEn: "",
      diffuse: [factor[0], factor[1], factor[2], alphaMode === "OPAQUE" ? 1 : factor[3]],
      specular: [pbr.metallicFactor ?? 1, pbr.roughnessFactor ?? 1, 1],
      // The normal map's strength, where the stage looks read it (material_shininess).
      specularPower: m.normalTexture ? (m.normalTexture.scale ?? 1) : 0,
      ambient: unlit ? [1, 1, 1] : [0.5, 0.5, 0.5],
      drawFlags: (m.doubleSided ? 0x01 : 0) | (castShadow ? 0x02 | 0x04 | 0x08 : 0),
      edgeColor: [0, 0, 0, 1],
      edgeSize: 0,
      textureIndex: textureIndex(texturePath(imageOf(pbr.baseColorTexture))),
      sphereIndex: -1,
      sphereMode: 0,
      toonShared: 0,
      toonIndex: -1,
      memo: `glTF ${ex.shader ?? ""}`.trim(),
      indexCount: run.indices.length,
    })
    materials.push({
      name,
      emissiveStrength: strength,
      unlit,
      additive: !!ex.additive,
      sky,
      look: ex.look ?? null,
      alphaMode,
      roughness: pbr.roughnessFactor ?? 1,
      metallic: pbr.metallicFactor ?? 1,
      emissiveFactor: [(m.emissiveFactor ?? [0, 0, 0])[0], (m.emissiveFactor ?? [0, 0, 0])[1], (m.emissiveFactor ?? [0, 0, 0])[2]],
      effect: ex.effect
        ? {
            ...ex.effect,
            layers: Object.fromEntries(Object.entries(ex.effect.layers ?? {}).map(([k, l]) => [k, { ...l, png: undefined }])),
            ...(ex.effect.noise ? { noise: { ...ex.effect.noise, png: undefined } } : {}),
          }
        : null,
      ripple: ex.ripple ? { ...ex.ripple, ...(ex.ripple.env ? { env: { ...ex.ripple.env, png: undefined } } : {}) } : null,
      sea: ex.sea ? { ...ex.sea, depth: { ...ex.sea.depth, png: undefined }, caustics: { ...ex.sea.caustics, png: undefined }, foam: { ...ex.sea.foam, png: undefined } } : null,
      fresnel: ex.fresnel ?? null,
    })
    // The maps, under the material's own name — see material-maps.ts.
    const mapFile = (ref: TextureRef | undefined, suffix: string): Uint8Array | null => {
      const index = imageOf(ref)
      const bytes = imageBytes(index)
      if (bytes === null) return null
      const img = g.images![index!]
      files.push({ path: `${dir}maps/${fileSafe(name)}_${suffix}.${EXT[img.mimeType ?? ""] ?? "png"}`, bytes })
      return bytes
    }
    // A MOVING EFFECT SHEET brings its layers instead: main, plus and mask, in
    // the three slots its graph samples (effectSheetGraph).
    const layerFile = (layer: EffectLayer | undefined, suffix: string): Uint8Array | null => {
      if (!layer?.png) return null
      const bytes = Uint8Array.from(atob(layer.png), (c) => c.charCodeAt(0))
      files.push({ path: `${dir}maps/${fileSafe(name)}_${suffix}.png`, bytes })
      return bytes
    }
    // THE SEA brings its own: the depth map, the caustics and the foam noise in
    // slots 1-3 beside its ripple normal (seaGraph)
    const pictureFile = (png: string | undefined, suffix: string): Uint8Array | null => {
      if (!png) return null
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
      files.push({ path: `${dir}maps/${fileSafe(name)}_${suffix}.png`, bytes })
      return bytes
    }
    // THE WATER'S OWN REFLECTION rides in slot 1 beside its ripple map (rippletGraph)
    if (ex.ripple?.env?.png) {
      maps.set(name, { normal: mapFile(m.normalTexture, "N"), orm: pictureFile(ex.ripple.env.png, "ORM"), emissive: null })
      continue
    }
    if (ex.sea) {
      pictureFile(ex.sea.foam.png, "X")
      maps.set(name, { normal: mapFile(m.normalTexture, "N"), orm: pictureFile(ex.sea.depth.png, "ORM"), emissive: pictureFile(ex.sea.caustics.png, "E") })
      continue
    }
    // its noise picture, when it has one, beside them as the fourth (material-maps.ts)
    if (ex.effect?.noise?.png) {
      files.push({ path: `${dir}maps/${fileSafe(name)}_X.png`, bytes: Uint8Array.from(atob(ex.effect.noise.png), (c) => c.charCodeAt(0)) })
    }
    maps.set(
      name,
      ex.effect
        ? { normal: layerFile(ex.effect.layers?.main, "N"), orm: layerFile(ex.effect.layers?.plus, "ORM"), emissive: layerFile(ex.effect.layers?.mask, "E") }
        : {
            normal: mapFile(m.normalTexture, "N"),
            orm: mapFile(pbr.metallicRoughnessTexture ?? m.occlusionTexture, "ORM"),
            emissive: mapFile(m.emissiveTexture, "E"),
          },
    )
    if (pbr.metallicRoughnessTexture && m.occlusionTexture && imageOf(pbr.metallicRoughnessTexture) !== imageOf(m.occlusionTexture))
      notes.push(`${name}: its occlusion map is a different image from its roughness/metal map and was left out`)
  }

  // ── The rig ──
  const rigLamps: object[] = []
  let sun: object | null = null
  for (const { node, world } of lamps) {
    const light = g.extensions?.KHR_lights_punctual?.lights[node.extensions!.KHR_lights_punctual!.light]
    if (!light) continue
    const ex = reze<RezeLamp & RezeSun>(node) ?? {}
    const dir3 = unit([-world[8], -world[9], -world[10]])
    const travel = toPmxDir(dir3)
    // Blender writes a sun's W/m² as lux and a lamp's W/(4π) as candela, both
    // through 683; read back, they are the numbers the .blend lit with.
    //
    // A GAME'S numbers (extras.reze.color, the Unity path) are in Unity's
    // convention, which has no π: its lit term is albedo·radiance·N·L and its
    // highlight URP's D·V·F with π folded out. The engine shades as Blender
    // does, with the 1/π in both, so the same number lit X340's floor at a
    // third of the game's — its candelabra spot left no pool at all. π here
    // puts it back, for lamps and sun alike.
    const colour = ex.color
      ? ex.color.map((c) => c * Math.PI)
      : (light.color ?? [1, 1, 1]).map((c) => (c * (light.intensity ?? 1)) / LUMENS_PER_WATT)
    if (light.type === "directional") {
      if (sun) {
        notes.push(`${node.name ?? "light"}: a second directional light was left out`)
        continue
      }
      const { color, strength } = colourAndStrength(colour)
      sun = {
        color,
        // Blender's sun strength is W/m², and the engine's sun term is
        // strength·albedo·N·L/π — the same law, so the number carries as it is.
        strength: Math.round(strength * 1000) / 1000,
        elevation: Math.round((Math.asin(Math.max(-1, Math.min(1, -travel[1]))) * 180) / Math.PI * 10) / 10,
        azimuth: Math.round((((Math.atan2(-travel[0], -travel[2]) * 180) / Math.PI) % 360 + 360) % 360 * 10) / 10,
        shadow: ex.shadow ?? true,
      }
      continue
    }
    const { color, strength } = colourAndStrength(colour)
    const perMetre = ex.intensity ?? 1
    const position = toPmx(xformPoint(world, 0, 0, 0))
    const range = ex.range ?? light.range ?? 10
    const lamp: Record<string, unknown> = {
      name: node.name ?? light.name ?? "Lamp",
      position: position.map((v) => Math.round(v * 1000) / 1000),
      color,
      intensity: Math.round(strength * perMetre * PMX_PER_METRE * PMX_PER_METRE * 1000) / 1000,
      radius: Math.round(range * PMX_PER_METRE * 1000) / 1000,
    }
    if (light.type === "spot") {
      const outer = ex.angle ?? ((light.spot?.outerConeAngle ?? Math.PI / 4) * 2 * 180) / Math.PI
      const inner = ex.innerAngle ?? ((light.spot?.innerConeAngle ?? 0) * 2 * 180) / Math.PI
      lamp.aim = travel.map((v) => Math.round(v * 10000) / 10000)
      lamp.angle = Math.round(outer * 100) / 100
      lamp.innerAngle = Math.round(inner * 100) / 100
    }
    rigLamps.push(lamp)
  }
  const rig: Record<string, unknown> = { lamps: rigLamps }
  if (sun) rig.sun = sun
  // A stage that brings its lamps and no sun was lit by its lamps alone —
  // a neon hall in a black world — so the scene's sun goes off with it,
  // claimed like the rest: deleting the stage brings the scene's back.
  else if (rigLamps.length) rig.sun = { strength: 0 }
  if (sceneExtras.fill) rig.fill = { color: hex(sceneExtras.fill.color), strength: sceneExtras.fill.strength }
  const world = sceneExtras.world
  if (world?.format === "hdr" && world.base64) {
    const text = atob(world.base64)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    files.push({ path: `${dir}${stem}.hdr`, bytes })
    if (world.strength !== undefined) rig.world = { strength: world.strength }
  } else if (world?.color) {
    // A flat world: the colour and strength the .blend was lit under, which
    // for a neon stage is black — its lamps and its glow are all its light.
    rig.world = { color: hex(world.color), strength: world.strength ?? 1 }
  } else if (world?.format) {
    notes.push(`the world is a .${world.format} image, which the loader does not read; only .hdr`)
  }
  const view = sceneExtras.view
  if (view?.transform && VIEW_TRANSFORM[view.transform]) {
    rig.view = { transform: VIEW_TRANSFORM[view.transform], exposure: view.exposure ?? 0 }
    if (view.look && view.look !== "None" && !/^AgX - Base$|^Filmic - Medium High Contrast$/.test(view.look)) notes.push(`view look "${view.look}" is not one the app has; the transform is applied without it`)
  }
  // AND ITS GRADE, carried in the rig as the cube itself: it is small (12 KB
  // at 16³) and it belongs to the document the rig is read into.
  const grading = sceneExtras.grading
  if (grading?.base64 && grading.size) {
    if (grading.format === "rgb8-srgb" && atob(grading.base64).length === grading.size ** 3 * 3) {
      rig.grade = { size: grading.size, lut: grading.base64 }
    } else {
      notes.push(`colour grade left out: a ${grading.format} cube the app does not read`)
    }
  }
  // AND THE AMBIENT ITS SURFACES WERE LIT BY, apart from the world picture
  // (which then answers reflections alone). glTF to PMX turns z over, and with
  // it the z-odd terms: c2 (z), c5 (yz), c7 (xz).
  const ambient = sceneExtras.ambient?.sh
  if (Array.isArray(ambient) && ambient.length === 27 && ambient.every(Number.isFinite)) {
    rig.ambient = ambient.map((v, i) => ([2, 5, 7].includes(Math.floor(i / 3)) ? -v : v))
  }
  // AND ITS FOG, in PMX units: a depth of d metres is d·12.5 units, so the
  // slope per unit is the slope per metre over 12.5 and the heights times it.
  const fogLayer = (l: FogLayerM | null | undefined) =>
    l && [l.color, l.distance, l.height].every((a) => Array.isArray(a) && a.every(Number.isFinite)) && Number.isFinite(l.amount)
      ? { color: l.color.slice(0, 3), amount: l.amount, distance: [l.distance[0] / PMX_PER_METRE, l.distance[1]], height: [l.height[0] * PMX_PER_METRE, l.height[1] * PMX_PER_METRE] }
      : null
  const haze = fogLayer(sceneExtras.fog)
  if (haze) rig.fog = { ...haze, ...(fogLayer(sceneExtras.fog?.dyn) ? { dyn: fogLayer(sceneExtras.fog?.dyn) } : {}) }
  // THE GAME'S PARTICLE SYSTEMS, as effects generated here (lib/unity-particles.ts),
  // their pictures beside the stage under particles/ — the document keeps the
  // source, the stage's own files the pictures (lib/effect-textures.ts)
  type ParticleEntry = ParticleClass & { textures?: ({ png?: string; srgb?: boolean } | null)[] }
  const particlesJson = (sceneExtras as { particlesJson?: unknown }).particlesJson
  let particles: ParticleEntry[] | undefined
  try {
    particles = typeof particlesJson === "string" ? (JSON.parse(particlesJson) as ParticleEntry[]) : undefined
  } catch {
    notes.push("the stage's particle systems could not be read")
  }
  if (particles?.length) {
    rig.particles = particles.map((c) => ({
      name: c.name,
      wgsl: particleEffectWgsl(c, (c.metresPerUnit ?? 0.64) * PMX_PER_METRE),
      textures: (c.textures ?? []).map((t, i) => {
        if (!t?.png) return null
        const path = `particles/${c.prefix}${i}.png`
        files.push({ path: `${dir}${path}`, bytes: Uint8Array.from(atob(t.png), (ch) => ch.charCodeAt(0)) })
        return { path, srgb: t.srgb !== false }
      }),
    }))
    notes.push(`${particles.length} particle systems drawn by the game's own rules and pictures: ${particles.map((c) => c.name).join(", ")}`)
  }
  files.push({ path: `${dir}${stem}.lights.json`, bytes: new TextEncoder().encode(JSON.stringify(rig, null, 1)) })

  // ── The PMX ──
  const indexSize = (n: number): 1 | 2 | 4 => (n < 128 ? 1 : n < 32768 ? 2 : 4)
  const doc: PmxDocument = {
    version: 2,
    globals: {
      encoding: 0,
      additionalUvCount: 0,
      vertexIndexSize: vertices.length < 65536 ? 2 : 4,
      textureIndexSize: indexSize(textures.length),
      materialIndexSize: indexSize(pmxMaterials.length),
      boneIndexSize: indexSize(1 + wicks.length),
      morphIndexSize: 1,
      rigidbodyIndexSize: 1,
      extra: [],
    },
    name: stem,
    nameEn: stem,
    comment: `Read from ${stem}.glb${g.asset?.generator ? ` (${g.asset.generator})` : ""}`,
    commentEn: "",
    vertices,
    indices: new Uint32Array(indices),
    textures,
    materials: pmxMaterials,
    bones: [
      {
        name: "全ての親",
        nameEn: "master",
        position: [0, 0, 0],
        parentIndex: -1,
        layer: 0,
        flags: 0x0002 | 0x0004 | 0x0008 | 0x0010,
        tailPosition: [0, 0, 0],
      },
      ...wicks.map((w) => ({
        name: w.name,
        nameEn: w.name,
        position: w.head,
        parentIndex: 0,
        layer: 0,
        flags: 0x0002 | 0x0004 | 0x0008 | 0x0010,
        tailPosition: w.tail,
      })),
    ],
    morphs: [],
    displayFrames: [
      { name: "Root", nameEn: "Root", special: 1, elements: [{ type: 0, index: 0 }] },
      { name: "表情", nameEn: "Exp", special: 1, elements: [] },
    ],
    rigidbodies: [],
    joints: [],
    trailing: null,
  }
  for (const kind of ["flame", "splash", "spray"]) {
    const these = wicks.filter((w) => w.name.toLowerCase().startsWith(`${kind}.`))
    if (these.length) notes.push(`${these.length} ${kind} points as bones ${these[0].name}..${these[these.length - 1].name}`)
  }
  const pmxPath = `${dir}${stem}.pmx`
  files.push({ path: pmxPath, bytes: new Uint8Array(writePmxDocument(doc)) })
  return { files, pmxPath, materials, maps, notes }
}

// ── The looks ──

/**
 * The Stage PBR graph: the game's own maps, per texel. Slot 0 the normal map,
 * slot 1 occlusion-roughness-metal in glTF's channel order, slot 2 the emissive
 * picture, which `strength` scales — a lamp shade at 3 or a monitor at 8 is
 * brighter than white and blooms.
 *
 * Its highlights are the game's: no spec clamp, because a lamp's glint on a
 * polished floor IS the blown-out highlight the game draws — the clamp the
 * cast's graphs carry against bump-aliased fireflies capped every lamp at a
 * dull sheen here — and roughness picks the reflection's blur by Unity's probe
 * curve, which the stage was tuned under (reflection_lod 1). Its lamps and sun
 * shade with URP's direct-light BRDF (unity_direct 1): the lobe the game drew
 * a candelabra's pool on the marble with, where the engine's own took the
 * roughness unsquared and spread every lamp into a faint wash.
 */
export function stagePbrGraph(strength: number): ShaderGraph {
  return {
    version: 1,
    name: strength > 0 ? `Stage PBR ×${strength}` : "Stage PBR",
    tags: ["stage", "pbr"],
    nodes: [
      { id: "tex", type: "texture" },
      { id: "mat", type: "material_diffuse" },
      { id: "base", type: "mix/multiply", inputs: { fac: 1.0 } },
      { id: "orm", type: "tex_image/1" },
      { id: "ch", type: "separate_color" },
      { id: "ao_rgb", type: "combine_color" },
      { id: "albedo", type: "mix/multiply", inputs: { fac: 1.0 } },
      { id: "relief", type: "tex_image/0" },
      { id: "relief_scale", type: "material_shininess" },
      { id: "normal", type: "normal_map" },
      { id: "glow", type: "tex_image/2" },
      { id: "principled", type: "principled", inputs: { specular_ior_level: 0.5, reflection_lod: 1.0, unity_direct: 1.0, emission_strength: strength } },
    ],
    links: [
      { from: { node: "tex", socket: "color" }, to: { node: "base", socket: "a" } },
      { from: { node: "mat", socket: "color" }, to: { node: "base", socket: "b" } },
      { from: { node: "orm", socket: "color" }, to: { node: "ch", socket: "color" } },
      { from: { node: "ch", socket: "r" }, to: { node: "ao_rgb", socket: "r" } },
      { from: { node: "ch", socket: "r" }, to: { node: "ao_rgb", socket: "g" } },
      { from: { node: "ch", socket: "r" }, to: { node: "ao_rgb", socket: "b" } },
      { from: { node: "base", socket: "color" }, to: { node: "albedo", socket: "a" } },
      { from: { node: "ao_rgb", socket: "color" }, to: { node: "albedo", socket: "b" } },
      { from: { node: "albedo", socket: "color" }, to: { node: "principled", socket: "base_color" } },
      { from: { node: "ch", socket: "b" }, to: { node: "principled", socket: "metallic" } },
      { from: { node: "ch", socket: "g" }, to: { node: "principled", socket: "roughness" } },
      { from: { node: "relief", socket: "color" }, to: { node: "normal", socket: "color" } },
      { from: { node: "relief_scale", socket: "value" }, to: { node: "normal", socket: "strength" } },
      { from: { node: "normal", socket: "normal" }, to: { node: "principled", socket: "normal" } },
      { from: { node: "glow", socket: "color" }, to: { node: "principled", socket: "emission_color" } },
    ],
    output: { node: "principled", socket: "color" },
  }
}

/**
 * The Stage Sheet graph: a painted sheet — a sky layer, an effect decal, a
 * shadow projection — as the game draws it, its emissive picture (slot 2) given
 * off at `strength` and no light taken. Its coverage is its base picture's
 * alpha, as every material's is. Drawn through Stage PBR instead, a sheet over
 * black was a glossy black surface, and X340's floor projection under its spot
 * lamp lit up as the whole rectangle of its quad.
 */
export function stageSheetGraph(strength: number): ShaderGraph {
  return {
    version: 1,
    name: `Stage Sheet ×${strength}`,
    tags: ["stage", "unlit"],
    nodes: [
      { id: "glow", type: "tex_image/2" },
      { id: "emit", type: "emission", inputs: { strength } },
    ],
    links: [{ from: { node: "glow", socket: "color" }, to: { node: "emit", socket: "color" } }],
    output: { node: "emit", socket: "color" },
  }
}

/**
 * The Stage Light Sheet graph: a baked sheet the game ADDS (Blend One One —
 * Effect_Common at _DstBlend 1, Tong_jichu_Add): its emissive picture's colour ·
 * alpha · `strength` is the light, blended additively so nothing behind it is
 * covered. The bake stores straight colour and the least alpha that carries the
 * light (unity_effect_bake.py); laid over as a Stage Sheet, that alpha dimmed
 * what was behind, and X306's monitors drew as dark translucent panes with a
 * faint glow on them.
 */
export function stageLightSheetGraph(strength: number): ShaderGraph {
  return {
    version: 1,
    name: `Stage Light Sheet ×${strength}`,
    tags: ["stage", "unlit", "effect"],
    nodes: [
      { id: "glow", type: "tex_image/2" },
      { id: "light", type: "vector_math/scale", inputs: {} },
      { id: "emit", type: "emission", inputs: { strength } },
    ],
    links: [
      { from: { node: "glow", socket: "color" }, to: { node: "light", socket: "a" } },
      { from: { node: "glow", socket: "alpha" }, to: { node: "light", socket: "scale" } },
      { from: { node: "light", socket: "vector" }, to: { node: "emit", socket: "color" } },
    ],
    output: { node: "emit", socket: "color" },
  }
}

/**
 * A moving effect sheet: the game's Effect_Common, drawn live — X348's
 * waterfalls, fountains and water sheets, which a bake could only freeze.
 *
 * Each layer's UV is the vertex shader's: `(u + time · speed.y, v + time ·
 * speed.x)`, rotated about 0.5, then `· scale + offset`, clamped where the slot
 * does not tile,
 * in Unity's v-up (so 1 − v on the way in and out). Main and plus sit in the
 * data slots 0 and 1 and are decoded from sRGB here; the mask sits in slot 2,
 * which the maps upload as colour. Then the fragment, as the bake has it
 * (unity_effect_bake.py): main raised and mixed by _MainPow, times _Color;
 * plus mixed in by _PlusMode; alpha times the mask; and the result laid down
 * as the game's One/OneMinusSrcAlpha does — `a·rgb` added, and what it covers
 * dimmed by `a·(_DstBlend − 1)/9` — so a _DstBlend of 1 is pure light (the
 * group blends additively) and 10 an ordinary layer. Noise and dissolve are
 * not drawn.
 */
export function effectSheetGraph(name: string, e: EffectSpec): ShaderGraph {
  type Ref = { node: string; socket: string }
  type In = Ref | number | [number, number, number]
  const nodes: ShaderGraph["nodes"] = []
  const links: ShaderGraph["links"] = []
  let count = 0
  const node = (type: string, inputs: Record<string, In>, socket: string): Ref => {
    const id = `n${count++}`
    const literals: Record<string, number | [number, number, number]> = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === "number" || Array.isArray(v)) literals[k] = v
      else links.push({ from: v, to: { node: id, socket: k } })
    }
    nodes.push({ id, type, inputs: literals })
    return { node: id, socket }
  }
  const at = (r: Ref, socket: string): Ref => ({ node: r.node, socket })
  const mul = (a: In, b: In) => node("math/multiply", { a, b }, "value")
  const vscale = (a: In, scale: In) => node("vector_math/scale", { a, scale }, "vector")
  const time = node("time", {}, "value")
  // the mesh UV in Unity's v-up: (u, 1 − v)
  const q = node("vector_math/multiply_add", { a: node("geometry", {}, "uv"), b: [1, -1, 0], c: [0, 1, 0] }, "vector")

  // A layer's picture, linear, and its alpha. Rotation about 0.5, scale, offset,
  // scroll and the flip back to the image's rows fold into two dot products and
  // two constants: engine (x, y) = (su, 1 − sv).
  // THE NOISE: its red, sampled on the mesh UV scrolled by speed a second and
  // then scaled, and in Unity's v-up the pull is uv + k·(n − uv); in the
  // engine's rows (x, 1 − v) that is x + kx·(n − x), y + ky·((1 − n) − y).
  const nz = e.noise
  let nred: In | null = null
  if (nz) {
    const nuv = node(
      "vector_math/multiply_add",
      {
        a: node("vector_math/multiply_add", { a: [nz.speed[0], nz.speed[1], 0], b: node("combine_xyz", { x: time, y: time, z: 0 }, "vector"), c: q }, "vector"),
        b: [nz.scale[0], -nz.scale[1], 0],
        c: [nz.offset[0], 1 - nz.offset[1], 0],
      },
      "vector",
    )
    nred = node("separate_color", { color: node("tex_image/3", { uv: nuv }, "color") }, "r")
  }
  const bend = (uv: In, on: boolean): In => {
    if (!nz || !nred || !on) return uv
    const [kx, ky] = nz.strength
    const pull = node("vector_math/multiply_add", { a: node("combine_xyz", { x: nred, y: nred, z: 0 }, "vector"), b: [kx, -ky, 0], c: [0, ky, 0] }, "vector")
    return node("vector_math/multiply_add", { a: uv, b: [1 - kx, 1 - ky, 1], c: pull }, "vector")
  }
  const sample = (slot: 0 | 1 | 2, l: EffectLayer) => {
    const th = 2 * Math.PI * ((((l.rotation / 360) % 1) + 1) % 1)
    const c = Math.cos(th)
    const s = Math.sin(th)
    const [sx, sy] = l.scale
    const bu = sx * (0.5 - 0.5 * c - 0.5 * s) + l.offset[0]
    const bv = sy * (0.5 + 0.5 * s - 0.5 * c) + l.offset[1]
    const su = node("vector_math/dot", { a: q, b: [sx * c, sx * s, 0] }, "value")
    const sv = node("vector_math/dot", { a: q, b: [-sy * s, sy * c, 0] }, "value")
    let uv: In = node("vector_math/multiply_add", { a: node("combine_xyz", { x: su, y: sv, z: 0 }, "vector"), b: [1, -1, 0], c: [bu, 1 - bv, 0] }, "vector")
    // THE SCROLL IS ADDED BEFORE THE ROTATION, AND CROSSED: the vertex shader adds
    // time · speed to (v, u) — speed.x moves v, speed.y moves u — then rotates and
    // scales. Rotation and scale are linear, so the scroll arrives as a constant
    // velocity through them: X348's falls roll their mask down the fall (the
    // mesh's u) instead of across it.
    const du0 = l.speed[1]
    const dv0 = l.speed[0]
    const rate = [sx * (c * du0 + s * dv0), -sy * (-s * du0 + c * dv0)]
    if (rate[0] || rate[1]) uv = node("vector_math/multiply_add", { a: [rate[0], rate[1], 0], b: node("combine_xyz", { x: time, y: time, z: 0 }, "vector"), c: uv }, "vector")
    uv = bend(uv, slot === 0 ? !!nz?.main : slot === 1 ? !!nz?.plus : !!nz?.mask)
    if (!l.tiling) uv = node("vector_math/minimum", { a: node("vector_math/maximum", { a: uv, b: [0, 0, 0] }, "vector"), b: [1, 1, 1] }, "vector")
    const tex = node(`tex_image/${slot}`, { uv }, "color")
    // slots 0 and 1 are data maps: decode here what the mask's slot decodes on upload
    const rgb: In = slot === 2 ? tex : node("gamma", { color: tex, gamma: 2.2 }, "color")
    return { rgb, a: at(tex, "alpha") as In }
  }
  // lerp(P.x·t, P.y·t^P.z, P.w)
  const powMix = (t: In, p: number[]): In => {
    const [x, y, z, w] = p
    if (!w) return x === 1 ? t : vscale(t, x)
    return node("vector_math/multiply_add", { a: t, b: [(1 - w) * x, (1 - w) * x, (1 - w) * x], c: vscale(node("gamma", { color: t, gamma: Math.max(z, 0.01) }, "color"), w * y) }, "vector")
  }
  const red = (c: In) => node("separate_color", { color: c }, "r")

  const main = sample(0, e.layers.main!)
  let rgb: In = powMix(main.rgb, e.mainPow)
  let a: In = e.redAlphaMain ? red(rgb) : main.a
  rgb = node("vector_math/multiply", { a: rgb, b: [e.color[0], e.color[1], e.color[2]] }, "vector")
  if ((e.color[3] ?? 1) !== 1) a = mul(a, e.color[3])
  if (e.layers.plus) {
    const p = sample(1, e.layers.plus)
    const pa: In = e.redAlphaPlus ? red(p.rgb) : p.a
    const plusRgb = node("vector_math/multiply", { a: powMix(vscale(p.rgb, pa), e.plusPow), b: [e.plusColor[0], e.plusColor[1], e.plusColor[2]] }, "vector")
    const plusA: In = (e.plusColor[3] ?? 1) === 1 ? pa : mul(pa, e.plusColor[3])
    const kc = e.plusColorOn * e.plusStrength
    const ka = e.plusAlphaOn * e.plusStrength
    if (e.plusMode === 2) {
      if (kc) rgb = node("vector_math/multiply_add", { a: plusRgb, b: [kc, kc, kc], c: vscale(rgb, 1 - kc) }, "vector")
      if (ka) a = node("math/multiply_add", { a: plusA, b: ka, c: mul(a, 1 - ka) }, "value")
    } else if (e.plusMode === 1) {
      if (kc) rgb = node("vector_math/multiply_add", { a: plusRgb, b: [kc, kc, kc], c: rgb }, "vector")
      if (ka) a = node("math/multiply_add", { a: plusA, b: ka, c: a }, "value")
    } else {
      if (kc) rgb = node("vector_math/multiply", { a: rgb, b: node("vector_math/multiply_add", { a: plusRgb, b: [kc, kc, kc], c: [1 - kc, 1 - kc, 1 - kc] }, "vector") }, "vector")
      if (ka) a = mul(a, node("math/multiply_add", { a: plusA, b: ka, c: 1 - ka }, "value"))
    }
  }
  rgb = node("vector_math/maximum", { a: rgb, b: [0, 0, 0] }, "vector")
  if (e.layers.mask) {
    const m = sample(2, e.layers.mask)
    const mv: In = e.redAlphaMask ? red(m.rgb) : m.a
    a = mul(a, e.maskStrength ? node("math/add", { a: mv, b: -e.maskStrength }, "value") : mv)
  }
  a = node("math/minimum", { a: node("math/maximum", { a, b: 0 }, "value"), b: 1 }, "value")

  const additive = e.dstBlend <= 1.0001
  const cover = Math.max((e.dstBlend - 1) / 9, 1e-3)
  // additive: the light a·rgb; laid over: colour rgb/cover at opacity cover·a
  const out = node("emission", { color: additive ? vscale(rgb, a) : vscale(rgb, 1 / cover), strength: 1 }, "color")
  return {
    version: 1,
    name: `Effect ${name}`,
    tags: ["stage", "unlit", "effect"],
    nodes,
    links,
    output: out,
    ...(additive ? {} : { opacity: cover === 1 ? a : mul(a, cover) }),
  }
}

/**
 * The game's Ripplet water (SimPipeline/Scene/Ripplet), from its decompiled
 * fragment — X348's pool, whose glints are the sky mirrored in its ripples.
 *
 * Two samples of the ripple map, each in world space: (x, z) in the game's
 * units times density, tiling and the layer's own density, scrolled by time ·
 * speed · 0.1 · _RippleUVOffest (the converter folds those into per-metre
 * scales and per-second drifts). Each is unpacked as the game unpacks it (its
 * red times its alpha: the converter's maps are RGB, alpha 1) — lifted toward flat by
 * its strength, the two blended (xy summed, z multiplied), and the result
 * leaned from straight up by _RippleScale. Then:
 *
 *   F      = (1 − N·V)^4
 *   refl   = mix(_ReflectionColor.rgb, _ReflectionColor.a, F)
 *   colour = (sky(reflect(−V, N)) · cube² · refl + _Color · (1 + N·L · sun · shadow))
 *            · _ReflectionIntensity
 *   alpha  = min(luminance(refl) + _Color.a, 1)
 *
 * The sky is the stage's own world picture — the reflection probe the
 * converter bakes — where the game reads its own cubemap. Its sun highlight
 * falls to zero at X348's _ReflectionColor.a of 1 (a roughness of 0), so it is
 * not drawn; nor are the horizon fade, the rim against depth and the fluid
 * simulation.
 */
/**
 * ZTong/Tong_jichu_Fresnel_Add, from its decompiled fragment (Blend One One,
 * Cull Off, both faces turned to the eye):
 *
 *   f      = 1 − max(N·V, 0)           — 1 − f again under _OneMinus
 *   colour = f ^ e^(1 − _Fresnel_Intensity) · _Fresnel_Color.rgb · .a · mask
 *
 * The mask (its luminance · alpha) is baked into the emissive picture, slot 2;
 * the rest is live, since it turns with the camera. X316's scene glow, which
 * wore Standard and drew as a lit solid.
 */
export function fresnelGraph(name: string, fr: FresnelSpec): ShaderGraph {
  type Ref = { node: string; socket: string }
  type In = Ref | number | [number, number, number]
  const nodes: ShaderGraph["nodes"] = []
  const links: ShaderGraph["links"] = []
  let count = 0
  const node = (type: string, inputs: Record<string, In>, socket: string): Ref => {
    const id = `n${count++}`
    const literals: Record<string, number | [number, number, number]> = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === "number" || Array.isArray(v)) literals[k] = v
      else links.push({ from: v, to: { node: id, socket: k } })
    }
    nodes.push({ id, type, inputs: literals })
    return { node: id, socket }
  }
  const geo = node("geometry", {}, "normal")
  // both faces: the back face's normal is turned to the eye, so |N·V|
  const ndv = node("math/absolute", { a: node("vector_math/dot", { a: geo, b: { node: geo.node, socket: "view" } }, "value") }, "value")
  const edge = fr.oneMinus ? ndv : node("math/subtract", { a: 1, b: ndv }, "value")
  const f = node("math/power", { a: node("math/maximum", { a: edge, b: 0.0001 }, "value"), b: fr.power }, "value")
  const mask = node("tex_image/2", {}, "color")
  const tint: [number, number, number] = [fr.color[0] ?? 1, fr.color[1] ?? 1, fr.color[2] ?? 1]
  const rgb = node("vector_math/scale", { a: node("vector_math/multiply", { a: mask, b: tint }, "vector"), scale: f }, "vector")
  const out = node("emission", { color: rgb, strength: 1 }, "color")
  // AN OPACITY, full, so it draws in the transparent phase: light added in the
  // opaque one wrote depth, and X316's glow cone hid the window glows behind it
  // (the game's pass is ZWrite Off). The additive blend ignores the value.
  const opacity = node("math/add", { a: 1, b: 0 }, "value")
  return { version: 1, name: `Glow ${name}`, tags: ["stage", "unlit", "effect"], nodes, links, output: out, opacity }
}

export function rippletGraph(name: string, r: RippleSpec): ShaderGraph {
  type Ref = { node: string; socket: string }
  type In = Ref | number | [number, number, number]
  const nodes: ShaderGraph["nodes"] = []
  const links: ShaderGraph["links"] = []
  let count = 0
  const node = (type: string, inputs: Record<string, In>, socket: string): Ref => {
    const id = `n${count++}`
    const literals: Record<string, number | [number, number, number]> = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === "number" || Array.isArray(v)) literals[k] = v
      else links.push({ from: v, to: { node: id, socket: k } })
    }
    nodes.push({ id, type, inputs: literals })
    return { node: id, socket }
  }
  const at = (ref: Ref, socket: string): Ref => ({ node: ref.node, socket })
  const mul = (a: In, b: In) => node("math/multiply", { a, b }, "value")
  const geo = node("geometry", {}, "world_pos")
  const time = node("time", {}, "value")
  const clock = node("combine_xyz", { x: time, y: time, z: 0 }, "vector")

  // One layer's tangent normal (x, y, z), lifted toward flat by its strength.
  const layer = (l: RippleSpec["layers"][number]): Ref => {
    // THE WORLD HERE IS THE PMX'S: 12.5 to the metre, and the game's (x, z)
    // is (−X, −Z) of it. So u = −X·k and, the image's rows running down and
    // the map tiling, −v = Z·k.
    const ku = l.scale[0] / PMX_PER_METRE
    const kv = l.scale[1] / PMX_PER_METRE
    const su = node("vector_math/dot", { a: geo, b: [-ku, 0, 0] }, "value")
    const sv = node("vector_math/dot", { a: geo, b: [0, 0, kv] }, "value")
    const uv = node("vector_math/multiply_add", { a: [l.drift[0], -l.drift[1], 0], b: clock, c: node("combine_xyz", { x: su, y: sv, z: 0 }, "vector") }, "vector")
    const tex = node("tex_image/0", { uv }, "color")
    const sep = node("separate_color", { color: tex }, "r")
    const t = node(
      "vector_math/multiply_add",
      { a: node("combine_xyz", { x: sep, y: at(sep, "g"), z: 0 }, "vector"), b: [2, 2, 0], c: [-1, -1, 0] },
      "vector",
    )
    const z = node(
      "math/sqrt",
      { a: node("math/maximum", { a: node("math/subtract", { a: 1, b: node("vector_math/dot", { a: t, b: t }, "value") }, "value"), b: 1e-8 }, "value") },
      "value",
    )
    const full = node("vector_math/add", { a: t, b: node("combine_xyz", { x: 0, y: 0, z }, "vector") }, "vector")
    const k = l.strength
    return node("vector_math/multiply_add", { a: full, b: [k, k, k], c: [0, 0, 1 - k] }, "vector")
  }
  const a = layer(r.layers[0])
  const b = layer(r.layers[1])
  const sum = node("separate_xyz", { vector: node("vector_math/add", { a, b }, "vector") }, "x")
  const bz = mul(node("separate_xyz", { vector: a }, "z"), node("separate_xyz", { vector: b }, "z"))
  // tangent (x, y, z) is the game's world (x, z, y), leaned from up by S; the PMX mirrors x and z
  const S = r.strength
  const n = node(
    "vector_math/normalize",
    { a: node("combine_xyz", { x: mul(sum, -S), y: node("math/multiply_add", { a: bz, b: S, c: 1 - S }, "value"), z: mul(at(sum, "y"), -S) }, "vector") },
    "vector",
  )
  const view = at(geo, "view")
  // the water faces the camera and the sun is above it: neither dot needs a floor
  const ndv = node("vector_math/dot", { a: n, b: view }, "value")
  const f = node("math/power", { a: node("math/subtract", { a: 1, b: ndv }, "value"), b: 4 }, "value")
  const [rr, rg, rb, ra] = r.reflection
  const refl = node(
    "vector_math/multiply_add",
    { a: node("combine_xyz", { x: f, y: f, z: f }, "vector"), b: [ra - rr, ra - rg, ra - rb], c: [rr, rg, rb] },
    "vector",
  )
  const bounce = node("vector_math/reflect", { a: node("vector_math/scale", { a: view, scale: -1 }, "vector"), b: n }, "vector")
  // ITS OWN CUBEMAP where it has one (_CustomEnvCube, slot 1): X348's pool mirrors
  // ReflectionProbe-1, baked in the pool — the arches and pillars its ripples
  // break into glints — not the stage's sky. Looked up along the reflection
  // the way the converter laid it out: u = atan2(x, z)/2π + 0.5, v = acos(y)/π.
  let sky: Ref
  if (r.env) {
    const rsep = node("separate_xyz", { vector: bounce }, "x")
    const u = node("math/multiply_add", { a: node("math/arctan2", { a: rsep, b: at(rsep, "z") }, "value"), b: 1 / (2 * Math.PI), c: 0.5 }, "value")
    const v = mul(node("math/arccosine", { a: node("math/minimum", { a: node("math/maximum", { a: at(rsep, "y"), b: -1 }, "value"), b: 1 }, "value") }, "value"), 1 / Math.PI)
    const probe = node("tex_image/1", { uv: node("combine_xyz", { x: u, y: v, z: 0 }, "vector") }, "color")
    sky = node("vector_math/scale", { a: probe, scale: mul(at(probe, "alpha"), r.env.range) }, "vector")
  } else sky = node("environment", { vector: bounce, roughness: 0 }, "color")
  const mirrored = node("vector_math/multiply", { a: node("vector_math/scale", { a: sky, scale: r.cube * r.cube }, "vector"), b: refl }, "vector")
  const light = node("light", {}, "direction")
  const ndl = node("vector_math/dot", { a: n, b: light }, "value")
  const lit = node("vector_math/scale", { a: at(light, "color"), scale: mul(ndl, at(light, "shadow")) }, "vector")
  const [cr, cg, cb, ca] = r.color
  const body = node("vector_math/multiply_add", { a: lit, b: [cr, cg, cb], c: [cr, cg, cb] }, "vector")
  const colour = node("vector_math/scale", { a: node("vector_math/add", { a: mirrored, b: body }, "vector"), scale: r.intensity * (r.tint ?? 1) }, "vector")
  const out = node("emission", { color: colour, strength: 1 }, "color")
  // opaque where the reflection's own luminance and _Color.a reach 1; X348's pool is about 0.77
  const floor = 0.2126729 * rr + 0.7151522 * rg + 0.072175 * rb + (ca ?? 1)
  return {
    version: 1,
    name: `Water ${name}`,
    tags: ["stage", "water"],
    nodes,
    links,
    output: out,
    ...(floor >= 1
      ? {}
      : {
          opacity: node(
            "math/minimum",
            { a: node("math/add", { a: node("vector_math/dot", { a: refl, b: [0.2126729, 0.7151522, 0.072175] }, "value"), b: ca }, "value"), b: 1 },
            "value",
          ),
        }),
  }
}

/**
 * The game's sea (Scene/CartoonWaterV2), from its decompiled fragment — where
 * X348's water is shallow it clears to the sand under it, is lit by caustics
 * and draws a foam line along the shore; out at sea it is its own lit picture.
 *
 * All three turn on d, how much water the eye looks through. The game reads it
 * off the depth buffer; the stage never moves, so the converter baked the
 * vertical depth over a grid (slot 1, 0..range game units) and d here is that
 * leaned by the view, as a slant sees more water:
 *
 *   rim   = pow(saturate(d·rim[0]), rim[1])                     → alpha
 *   foam  = step(clipping, saturate(n·fall + fall)), fall = saturate((1 − saturate(e^d / length)) / falloff)
 *   caustics = min(tex(cuv + t·s), tex(0.8·cuv − t·s)) · max(1 − rim − foam, 0) · brightness · sun
 *   colour   = lit(mix(_MainTex · _MainColor, foam colour, foam), normal) + caustics
 *
 * Slots: 0 the ripple normal, 1 the depth map, 2 the caustics, 3 the foam noise.
 * Sun glint, sparkle and reflection are scaled to 0 on X348 and not drawn.
 */
export function seaGraph(name: string, s: SeaSpec): ShaderGraph {
  type Ref = { node: string; socket: string }
  type In = Ref | number | [number, number, number]
  const nodes: ShaderGraph["nodes"] = []
  const links: ShaderGraph["links"] = []
  let count = 0
  const node = (type: string, inputs: Record<string, In>, socket: string): Ref => {
    const id = `n${count++}`
    const literals: Record<string, number | [number, number, number]> = {}
    for (const [k, v] of Object.entries(inputs)) {
      if (typeof v === "number" || Array.isArray(v)) literals[k] = v
      else links.push({ from: v, to: { node: id, socket: k } })
    }
    nodes.push({ id, type, inputs: literals })
    return { node: id, socket }
  }
  const at = (ref: Ref, socket: string): Ref => ({ node: ref.node, socket })
  const mul = (a: In, b: In) => node("math/multiply", { a, b }, "value")
  const clamp01 = (a: In) => node("math/clamp01", { a }, "value")
  const geo = node("geometry", {}, "world_pos")
  const uv = at(geo, "uv")
  const view = at(geo, "view")
  const time = node("time", {}, "value")
  const clock = node("combine_xyz", { x: time, y: time, z: 0 }, "vector")
  // the PMX world is the glTF's at 12.5 to the metre with z turned: (x, z)m = (X, −Z)/12.5
  const m = 1 / PMX_PER_METRE

  // d: the depth map over (x, z), leaned by the view
  const [x0, z0] = s.depth.origin
  const [w, h] = s.depth.size
  const dxz = node("separate_xyz", { vector: node("vector_math/multiply_add", { a: geo, b: [m / w, 0, -m / h], c: [-x0 / w, 0, -z0 / h] }, "vector") }, "x")
  const depthUv = node("combine_xyz", { x: dxz, y: at(dxz, "z"), z: 0 }, "vector")
  const vertical = mul(node("separate_color", { color: node("tex_image/1", { uv: depthUv }, "color") }, "r"), s.depth.range)
  // the camera is above the sea, so the view's y is never below zero
  const lean = node("math/maximum", { a: node("vector_math/dot", { a: view, b: [0, 1, 0] }, "value"), b: 0.1 }, "value")
  const d = node("math/divide", { a: vertical, b: lean }, "value")

  // the soft edge
  const rim = node("math/power", { a: clamp01(mul(d, s.rim[0])), b: s.rim[1] }, "value")

  // the foam line
  const f = s.foam
  const inter = node("math/subtract", { a: 1, b: clamp01(mul(node("math/exponent", { a: d }, "value"), 1 / Math.max(f.length, 1e-3))) }, "value")
  const fall = clamp01(mul(inter, 1 / Math.max(f.falloff, 1e-3)))
  const noiseUv = node("vector_math/multiply_add", { a: [f.speed, -f.speed, 0], b: clock, c: node("vector_math/scale", { a: uv, scale: f.tiling }, "vector") }, "vector")
  const noise = node("separate_color", { color: node("tex_image/3", { uv: noiseUv }, "color") }, "r")
  const foam = node("math/less_than", { a: f.clipping, b: clamp01(node("math/multiply_add", { a: noise, b: fall, c: fall }, "value")) }, "value")

  // the surface: its picture lit through its ripple normal
  // the ripples scroll, as the game's do
  const [rt, rs, rd] = s.ripple ?? [1, 0, 0]
  const rippleUv = node("vector_math/multiply_add", { a: [rs, rs, 0], b: clock, c: rt === 1 ? uv : node("vector_math/scale", { a: uv, scale: rt }, "vector") }, "vector")
  const nt = node("vector_math/multiply_add", { a: node("tex_image/0", { uv: rippleUv }, "color"), b: [2, 2, 0], c: [-1, -1, 0] }, "vector")
  const nsep = node("separate_xyz", { vector: nt }, "x")
  const k = s.normal
  const normal = node("vector_math/normalize", { a: node("combine_xyz", { x: mul(nsep, k), y: 1, z: mul(at(nsep, "y"), -k) }, "vector") }, "vector")
  // the foam is laid into the surface's colour BEFORE the light, as the game does,
  // so the sun lights it white; laid over after, it was a grey band
  const base = node("mix/blend", {
    fac: foam,
    a: node("vector_math/multiply", { a: node("texture", {}, "color"), b: [s.color[0], s.color[1], s.color[2]] }, "vector"),
    b: [f.color[0], f.color[1], f.color[2]],
  }, "color")
  const lit = node("principled", { base_color: base, normal, roughness: 1, metallic: 0, specular_ior_level: 0 }, "color")

  // the caustics, on the world (x, z)
  const c = s.caustics
  const cxz = node("separate_xyz", { vector: node("vector_math/scale", { a: geo, scale: c.tiling * m }, "vector") }, "x")
  // bent by the moving ripples (_CausticsDistortion), which is what makes them swim
  const cuv = node("vector_math/multiply_add", { a: nt, b: [rd, rd, 0], c: node("combine_xyz", { x: cxz, y: mul(at(cxz, "z"), -1), z: 0 }, "vector") }, "vector")
  const tapA = node("tex_image/2", { uv: node("vector_math/multiply_add", { a: [c.speed, c.speed, 0], b: clock, c: cuv }, "vector") }, "color")
  const tapB = node("tex_image/2", { uv: node("vector_math/multiply_add", { a: [-c.speed, -c.speed, 0], b: clock, c: node("vector_math/scale", { a: cuv, scale: 0.8 }, "vector") }, "vector") }, "color")
  const shallow = node("math/maximum", { a: node("math/subtract", { a: node("math/subtract", { a: 1, b: rim }, "value"), b: foam }, "value"), b: 0 }, "value")
  const sun = node("light", {}, "color")
  const caustics = node("vector_math/multiply", { a: node("vector_math/scale", { a: node("vector_math/minimum", { a: tapA, b: tapB }, "vector"), scale: mul(shallow, c.brightness) }, "vector"), b: sun }, "vector")

  const out = node("emission", { color: node("vector_math/add", { a: lit, b: caustics }, "vector"), strength: 1 }, "color")
  return {
    version: 1,
    name: `Sea ${name}`,
    tags: ["stage", "water"],
    nodes,
    links,
    output: out,
    opacity: node("math/minimum", { a: node("math/add", { a: rim, b: foam }, "value"), b: 1 }, "value"),
  }
}

/**
 * The style groups a glTF stage wears: Stage PBR per emissive strength (and
 * per cutout), the app's own look where the file names one, Unlit for what
 * takes no light.
 */
export function glbStyleGroups(materials: GlbMaterial[]): StyleGroup[] {
  const groups: StyleGroup[] = []
  const byKey = new Map<string, StyleGroup>()
  const add = (key: string, make: () => StyleGroup, material: string) => {
    let g = byKey.get(key)
    if (!g) {
      g = make()
      byKey.set(key, g)
      groups.push(g)
    }
    g.materials.push(material)
  }
  for (const m of materials) {
    // A moving effect sheet, drawn live — one group each, its numbers its own.
    if (m.effect?.layers?.main) {
      const effect = m.effect
      add(
        `effect:${m.name}`,
        () => ({
          id: `stage-effect-${fileSafe(m.name).toLowerCase()}`,
          label: `Effect ${m.name}`,
          materials: [],
          graph: effectSheetGraph(m.name, effect),
          renderClass: "auto",
          ...(effect.dstBlend <= 1.0001 ? { blend: "additive" as const } : {}),
        }),
        m.name,
      )
      continue
    }
    // A FRESNEL GLOW, its view-angle term live over its baked mask — one group each.
    if (m.fresnel) {
      const fresnel = m.fresnel
      add(
        `fresnel:${m.name}`,
        () => ({ id: `stage-fresnel-${fileSafe(m.name).toLowerCase()}`, label: `Glow ${m.name}`, materials: [], graph: fresnelGraph(m.name, fresnel), renderClass: "auto", blend: "additive" as const }),
        m.name,
      )
      continue
    }
    // THE GAME'S SEA, its shallows from the depth baked under it — one group each.
    if (m.sea) {
      const sea = m.sea
      add(
        `sea:${m.name}`,
        () => ({ id: `stage-sea-${fileSafe(m.name).toLowerCase()}`, label: `Sea ${m.name}`, materials: [], graph: seaGraph(m.name, sea), renderClass: "auto" }),
        m.name,
      )
      continue
    }
    // THE GAME'S WATER, on its own numbers — one group each.
    if (m.ripple && m.ripple.layers?.length === 2) {
      const ripple = m.ripple
      add(
        `ripple:${m.name}`,
        () => ({ id: `stage-water-${fileSafe(m.name).toLowerCase()}`, label: `Water ${m.name}`, materials: [], graph: rippletGraph(m.name, ripple), renderClass: "auto" }),
        m.name,
      )
      continue
    }
    const hashed = m.alphaMode === "MASK"
    // A look the file states, or one its NAME says for the two real surfaces:
    // x333's pool is a Standard material called X333_shui, which the file can
    // only describe as a painted sheet, and the name table knows better. Only
    // Glass and Water are taken from the name — every other keyword look would
    // replace the per-texel maps the file brought with a guess. Never for an
    // unlit sheet: a surface look is lit, and X323's water stains
    // (sc_X323_shuizi, "shui" for water) wore Water over their baked glow and
    // drew as the faintest ripple of it.
    const named = !m.look && !m.unlit ? stageLookFor(m.name) : null
    const look = m.look ?? (named && SURFACE_LOOKS.has(named) ? named.toLowerCase() : null)
    if (look && libraryGraph(look === "glass" ? "Glass" : look === "water" ? "Water" : "Foliage")) {
      const label = look === "glass" ? "Glass" : look === "water" ? "Water" : "Foliage"
      add(`look:${label}`, () => ({ id: `stage-${label.toLowerCase()}`, label, materials: [], graph: structuredClone(libraryGraph(label)!), renderClass: "auto", ...(label === "Foliage" ? { alphaMode: "hashed" as const } : {}) }), m.name)
      continue
    }
    if (m.unlit && m.emissiveStrength === 0) {
      add("unlit", () => ({ id: "stage-unlit", label: "Unlit", materials: [], graph: structuredClone(UNLIT_GRAPH), renderClass: "auto" }), m.name)
      continue
    }
    // A baked sheet the game adds is light, not cover — see stageLightSheetGraph.
    if (m.unlit && m.additive) {
      add(
        `light:${m.emissiveStrength}`,
        () => ({
          id: `stage-light-sheet-x${m.emissiveStrength}`,
          label: `Stage Light Sheet ×${m.emissiveStrength}`,
          materials: [],
          graph: stageLightSheetGraph(m.emissiveStrength),
          renderClass: "auto",
          blend: "additive" as const,
        }),
        m.name,
      )
      continue
    }
    // An unlit sheet the exporter wrote as emission over black takes no light
    // either — see stageSheetGraph.
    if (m.unlit) {
      add(
        `sheet:${m.emissiveStrength}:${hashed ? "cut" : ""}`,
        () => ({
          id: `stage-sheet-x${m.emissiveStrength}${hashed ? "-cutout" : ""}`,
          label: `Stage Sheet ×${m.emissiveStrength}${hashed ? " (cutout)" : ""}`,
          materials: [],
          graph: stageSheetGraph(m.emissiveStrength),
          renderClass: "auto",
          ...(hashed ? { alphaMode: "hashed" as const } : {}),
        }),
        m.name,
      )
      continue
    }
    const key = `pbr:${m.emissiveStrength}:${hashed ? "cut" : ""}`
    add(
      key,
      () => ({
        id: `stage-pbr${m.emissiveStrength > 0 ? `-x${m.emissiveStrength}` : ""}${hashed ? "-cutout" : ""}`,
        label: `Stage PBR${m.emissiveStrength > 0 ? ` ×${m.emissiveStrength}` : ""}${hashed ? " (cutout)" : ""}`,
        materials: [],
        graph: stagePbrGraph(m.emissiveStrength),
        renderClass: "auto",
        ...(hashed ? { alphaMode: "hashed" as const } : {}),
        // NOT blend: "additive" — see the note above the key. The engine can now
        // say it, but these materials have no diffuse texture, so tex_s is the
        // 1x1 white fallback and they were never being discarded on alpha; the
        // blend was a fix for a problem they did not have.
      }),
      m.name,
    )
  }
  return groups
}

// ── Uploads ──

/** What a converted .glb needs later, keyed by the PMX file it became. */
const converted = new WeakMap<File, { materials: GlbMaterial[]; notes: string[] }>()

export const isFromGlb = (pmx: File) => converted.has(pmx)
export const glbStageOf = (pmx: File) => converted.get(pmx)

/**
 * The identity a rewritten .pmx has to keep.
 *
 * KEYED BY THE FILE OBJECT, so anything that replaces the .pmx — the texture
 * transcode rewrites its table and returns a new File — loses it unless it says
 * so here. When it was lost, glbStageOf came back empty, the stage fell through
 * to the name-based looks a PMX gets, and X309's sky layers lost the ×16
 * emission that IS their picture: the dome stayed, the galaxy went, and nothing
 * about textures or blending could bring it back.
 */
export function carryGlbStage(from: File, to: File): void {
  const glb = converted.get(from)
  if (glb && from !== to) converted.set(to, glb)
}

/** A 1x1 PNG of one colour, for a map slot the material did not bring. */
async function solidPng(r: number, g: number, b: number): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = `rgb(${r},${g},${b})`
  ctx.fillRect(0, 0, 1, 1)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png"))
}

/**
 * An upload with every .glb replaced by the folder it reads as — the .pmx at
 * the same path, its textures, its maps, its world and its rig — so the stage
 * path loads it as it loads a converted PMX, and the bundle keeps the folder.
 */
export async function convertGlbUploads(files: File[]): Promise<File[]> {
  if (!files.some((f) => /\.glb$/i.test(f.name))) return files
  const out: File[] = []
  for (const f of files) {
    if (!/\.glb$/i.test(f.name)) {
      out.push(f)
      continue
    }
    const path = relFilePath(f)
    const stage = glbToStage(await f.arrayBuffer(), path)
    let pmx: File | null = null
    for (const file of stage.files) {
      const made = new File([file.bytes as BlobPart], file.path)
      if (file.path === stage.pmxPath) pmx = made
      out.push(made)
    }
    // A map the material did not bring is stood in for, so every material in
    // a Stage PBR group samples something sensible: a flat normal, its own
    // roughness and metal, its own emissive colour (black for most).
    const dir = path.slice(0, path.lastIndexOf("/") + 1)
    for (const m of stage.materials) {
      const have = stage.maps.get(m.name)
      const stem = `${dir}maps/${fileSafe(m.name)}`
      if (!have?.normal) out.push(new File([await solidPng(128, 128, 255)], `${stem}_N.png`))
      if (!have?.orm) out.push(new File([await solidPng(255, Math.round(m.roughness * 255), Math.round(m.metallic * 255))], `${stem}_ORM.png`))
      if (!have?.emissive) {
        const [r, g, b] = m.emissiveFactor.map((c) => Math.round(srgb(Math.min(1, c)) * 255))
        out.push(new File([await solidPng(r, g, b)], `${stem}_E.png`))
      }
    }
    if (pmx) converted.set(pmx, { materials: stage.materials, notes: stage.notes })
    if (stage.notes.length) console.warn(`[glb] ${path}`, stage.notes)
  }
  return out
}
