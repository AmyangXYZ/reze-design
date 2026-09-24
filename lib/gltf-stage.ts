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
type RezeMaterial = { shader?: string; unlit?: boolean; additive?: boolean; sky?: boolean; castShadow?: boolean; look?: string | null }
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
  const wicks: { name: string; head: [number, number, number]; tail: [number, number, number] }[] = []
  const visit = (index: number, parent: Mat4) => {
    const node = g.nodes![index]
    const world = mul(parent, localMatrix(node))
    if (node.extensions?.KHR_lights_punctual) lamps.push({ node, world })
    if (node.mesh === undefined && /^flame\.\d+$/i.test(node.name ?? "")) {
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
  ordered.sort((a, b) => {
    const sa = skyOf(a), sb = skyOf(b)
    if (sa !== sb) return sa ? -1 : 1
    if (sa && sb) return skyRadius(b) - skyRadius(a)
    return 0
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
    maps.set(name, {
      normal: mapFile(m.normalTexture, "N"),
      orm: mapFile(pbr.metallicRoughnessTexture ?? m.occlusionTexture, "ORM"),
      emissive: mapFile(m.emissiveTexture, "E"),
    })
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
  if (wicks.length) notes.push(`${wicks.length} candle flames as bones ${wicks[0].name}..${wicks[wicks.length - 1].name}`)
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
    const hashed = m.alphaMode === "MASK"
    // A look the file states, or one its NAME says for the two real surfaces:
    // x333's pool is a Standard material called X333_shui, which the file can
    // only describe as a painted sheet, and the name table knows better. Only
    // Glass and Water are taken from the name — every other keyword look would
    // replace the per-texel maps the file brought with a guess.
    const named = !m.look ? stageLookFor(m.name) : null
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
