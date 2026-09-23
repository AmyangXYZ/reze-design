// DirectX .x accessories — MMD's second mesh format — converted to PMX on upload.
//
// An accessory is plain geometry: vertices, faces, per-material colours and a
// texture name. Everything downstream of an upload (the folder reader, the
// bundle, publishing, a reload) already speaks PMX, so the conversion happens
// once at the door and the .x never travels further. The file that arrives in
// the scene is a real PMX that any PMX tool opens.
//
// Reads text .x ("xof 0303txt"), which is what Metasequoia and PMX Editor write
// and what MMD accessories ship as.

import { writePmxDocument, type PmxDocument, type PmxMaterial, type PmxVertex } from "reze-engine"
import { relFilePath } from "@/lib/scene-files"

/**
 * MMD draws an accessory at ten times its file coordinates. PMX Editor's .x
 * import defaults to the same factor, which is what makes a converted
 * accessory line up with the models around it.
 */
const X_SCALE = 10

/** MMD's default light colour, (154, 154, 154) / 255. */
const MMD_LIGHT = 154 / 255

type XNode = {
  type: string
  name: string
  /** Every number and string at this level, in order. Separators carry no
   *  information once the template is known, so they are dropped. */
  values: (number | string)[]
  children: XNode[]
}

type Token = { kind: "open" | "close" | "word" | "num" | "str"; text: string }

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

function tokenize(text: string): Token[] {
  const out: Token[] = []
  const re = /"((?:[^"\\]|\\.)*)"|\/\/[^\n]*|#[^\n]*|<[^>]*>|[{}]|[;,\s]+|[^\s{};,"<]+/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const t = m[0]
    if (m[1] !== undefined) out.push({ kind: "str", text: m[1].replace(/\\(.)/g, "$1") })
    else if (t === "{") out.push({ kind: "open", text: t })
    else if (t === "}") out.push({ kind: "close", text: t })
    else if (t.startsWith("//") || t.startsWith("#") || t.startsWith("<") || /^[;,\s]+$/.test(t)) continue
    else out.push({ kind: NUMBER.test(t) ? "num" : "word", text: t })
  }
  return out
}

/** Data objects from `pos` until a closing brace or the end. A reference —
 *  `{ Name }` inside a list — becomes a child of type "ref". */
function parseNodes(toks: Token[], pos: number): { nodes: XNode[]; values: (number | string)[]; pos: number } {
  const nodes: XNode[] = []
  const values: (number | string)[] = []
  while (pos < toks.length && toks[pos].kind !== "close") {
    const t = toks[pos]
    if (t.kind === "num") {
      values.push(Number(t.text))
      pos++
    } else if (t.kind === "str") {
      values.push(t.text)
      pos++
    } else if (t.kind === "open") {
      let name = ""
      for (pos++; pos < toks.length && toks[pos].kind !== "close"; pos++) name ||= toks[pos].text
      nodes.push({ type: "ref", name, values: [], children: [] })
      pos++
    } else {
      // `Type {` or `Type Name {` opens an object; any other word is template
      // vocabulary (FLOAT, array, DWORD) and is skipped.
      const named = toks[pos + 1]?.kind !== "open" && toks[pos + 2]?.kind === "open"
      const open = named ? pos + 2 : pos + 1
      if (toks[open]?.kind !== "open") {
        pos++
        continue
      }
      const body = parseNodes(toks, open + 1)
      nodes.push({ type: t.text, name: named ? toks[pos + 1].text : "", values: body.values, children: body.nodes })
      pos = body.pos + 1
    }
  }
  return { nodes, values, pos }
}

type Mat4 = number[]
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** D3D row-vector convention: a child's world matrix is local × parent. */
function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]
      out[r * 4 + c] = s
    }
  return out
}

type XMaterial = {
  name: string
  diffuse: [number, number, number, number]
  power: number
  specular: [number, number, number]
  emissive: [number, number, number]
  /** The raw TextureFilename, e.g. `tex\\body.png*shine.sph`. */
  texture: string
}

function readMaterial(node: XNode): XMaterial {
  const v = node.values.map(Number)
  const tex = node.children.find((c) => c.type === "TextureFilename")
  return {
    name: node.name,
    diffuse: [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1, v[3] ?? 1],
    power: v[4] ?? 0,
    specular: [v[5] ?? 0, v[6] ?? 0, v[7] ?? 0],
    emissive: [v[8] ?? 0, v[9] ?? 0, v[10] ?? 0],
    texture: typeof tex?.values[0] === "string" ? tex.values[0] : "",
  }
}

const DEFAULT_MATERIAL: XMaterial = {
  name: "",
  diffuse: [1, 1, 1, 1],
  power: 0,
  specular: [0, 0, 0],
  emissive: [0, 0, 0],
  texture: "",
}

/** Faces as `[count, i0, i1, …]` runs, from `at` in `v`. */
function readFaces(v: number[], at: number): { faces: number[][]; end: number } {
  const n = v[at++] ?? 0
  const faces: number[][] = []
  for (let f = 0; f < n; f++) {
    const count = v[at++]
    faces.push(v.slice(at, at + count))
    at += count
  }
  return { faces, end: at }
}

type Merged = {
  positions: number[]
  normals: number[]
  uvs: number[]
  /** One entry per triangle: [material, a, b, c]. */
  triangles: [number, number, number, number][]
  materials: XMaterial[]
}

function addMesh(node: XNode, world: Mat4, named: Map<string, XNode>, out: Merged) {
  const v = node.values.map(Number)
  const nv = v[0] ?? 0
  const pos = v.slice(1, 1 + nv * 3)
  const { faces } = readFaces(v, 1 + nv * 3)

  const normalNode = node.children.find((c) => c.type === "MeshNormals")
  let normals: number[] | null = null
  let normalFaces: number[][] | null = null
  if (normalNode) {
    const nn = normalNode.values.map(Number)
    normals = nn.slice(1, 1 + nn[0] * 3)
    normalFaces = readFaces(nn, 1 + nn[0] * 3).faces
  }
  const uvNode = node.children.find((c) => c.type === "MeshTextureCoords")
  const uvs = uvNode ? uvNode.values.map(Number).slice(1) : []

  const listNode = node.children.find((c) => c.type === "MeshMaterialList")
  const base = out.materials.length
  const faceMaterial: number[] = []
  if (listNode) {
    const lv = listNode.values.map(Number)
    const indices = lv.slice(2, 2 + lv[1])
    // A short list repeats its last entry for the remaining faces.
    for (let f = 0; f < faces.length; f++) faceMaterial.push(indices[Math.min(f, indices.length - 1)] ?? 0)
    for (const c of listNode.children) {
      const m = c.type === "ref" ? named.get(c.name) : c.type === "Material" ? c : undefined
      out.materials.push(m ? readMaterial(m) : DEFAULT_MATERIAL)
    }
  }
  if (out.materials.length === base) out.materials.push(DEFAULT_MATERIAL)

  const m = world
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])
  const xfPoint = (x: number, y: number, z: number) => [
    (x * m[0] + y * m[4] + z * m[8] + m[12]) * X_SCALE,
    (x * m[1] + y * m[5] + z * m[9] + m[13]) * X_SCALE,
    (x * m[2] + y * m[6] + z * m[10] + m[14]) * X_SCALE,
  ]
  const xfDir = (x: number, y: number, z: number) => {
    const d = [x * m[0] + y * m[4] + z * m[8], x * m[1] + y * m[5] + z * m[9], x * m[2] + y * m[6] + z * m[10]]
    const len = Math.hypot(d[0], d[1], d[2]) || 1
    return [d[0] / len, d[1] / len, d[2] / len]
  }

  // Where the file gives no normal, a position takes the area-weighted average
  // of the faces around it.
  const smooth = new Array<number>(nv * 3).fill(0)
  for (const f of faces)
    for (let k = 1; k + 1 < f.length; k++) {
      const [a, b, c] = [f[0], f[k], f[k + 1]]
      const e1 = [0, 1, 2].map((j) => pos[b * 3 + j] - pos[a * 3 + j])
      const e2 = [0, 1, 2].map((j) => pos[c * 3 + j] - pos[a * 3 + j])
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      for (const p of [a, b, c]) for (let j = 0; j < 3; j++) smooth[p * 3 + j] += n[j]
    }
  const nn = normals ? normals.length / 3 : 0

  // A corner is a (position, normal) pair: .x indexes normals separately, so one
  // position can carry a different normal on each face that meets there.
  const corners = new Map<string, number>()
  const corner = (p: number, n: number) => {
    const key = `${p}:${n}`
    let index = corners.get(key)
    if (index !== undefined) return index
    index = out.positions.length / 3
    corners.set(key, index)
    out.positions.push(...xfPoint(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]))
    const [src, at] = normals && n >= 0 && n < nn ? [normals, n] : [smooth, p]
    out.normals.push(...xfDir(src[at * 3], src[at * 3 + 1], src[at * 3 + 2]))
    out.uvs.push(uvs[p * 2] ?? 0, uvs[p * 2 + 1] ?? 0)
    return index
  }

  faces.forEach((f, fi) => {
    const nf = normalFaces?.[fi]
    const ids = f.map((p, k) => corner(p, nf && nf.length === f.length ? nf[k] : -1))
    const material = base + Math.min(faceMaterial[fi] ?? 0, out.materials.length - base - 1)
    // A mirroring frame turns every face inside out; swapping two corners puts
    // the front back where the normals say it is.
    for (let k = 1; k + 1 < ids.length; k++)
      out.triangles.push(
        det < 0 ? [material, ids[0], ids[k + 1], ids[k]] : [material, ids[0], ids[k], ids[k + 1]],
      )
  })
}

function walk(nodes: XNode[], world: Mat4, named: Map<string, XNode>, out: Merged) {
  for (const node of nodes) {
    if (node.type === "Mesh") addMesh(node, world, named, out)
    else if (node.type === "Frame") {
      const local = node.children.find((c) => c.type === "FrameTransformMatrix")
      const m = local && local.values.length >= 16 ? local.values.slice(0, 16).map(Number) : IDENTITY
      walk(node.children, mul(m, world), named, out)
    }
  }
}

function gatherNamedMaterials(nodes: XNode[], into: Map<string, XNode>) {
  for (const node of nodes) {
    if (node.type === "Material" && node.name) into.set(node.name, node)
    gatherNamedMaterials(node.children, into)
  }
}

/** The texture table entries a .x texture string names: a diffuse map and an
 *  optional sphere map, joined by `*`. */
function splitTexture(raw: string): { diffuse: string; sphere: string; sphereMode: number } {
  let diffuse = ""
  let sphere = ""
  let sphereMode = 0
  for (const part of raw.split("*")) {
    const path = part.trim().replace(/[\\/]+/g, "/")
    if (!path) continue
    const ext = path.toLowerCase().split(".").pop()
    if (ext === "sph" || ext === "spa") {
      sphere = path
      sphereMode = ext === "sph" ? 1 : 2
    } else diffuse = path
  }
  return { diffuse, sphere, sphereMode }
}

const indexSize = (count: number): 1 | 2 | 4 => (count < 128 ? 1 : count < 32768 ? 2 : 4)

function decode(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    // Japanese accessories are written in Shift_JIS, texture names included.
    return new TextDecoder("shift_jis").decode(buffer)
  }
}

export type XConversion = {
  pmx: ArrayBuffer
  /**
   * Materials MMD draws at their texture's full brightness whatever the light
   * does: its accessory shading clamps `diffuse × light + emissive`, so at the
   * default light any material where that reaches 1 has stopped responding to
   * it. This is how a skydome or a backdrop is made unlit in MMD.
   */
  unlit: string[]
  /** The PMX's texture table, relative to its folder. */
  textures: string[]
}

/** A text .x file as a PMX, plus the materials MMD shows unlit. */
export function xToPmx(buffer: ArrayBuffer, name: string): XConversion {
  const text = decode(buffer)
  if (!text.startsWith("xof ")) throw new Error(`${name} is not a DirectX .x file`)
  if (text.slice(8, 12) !== "txt ") throw new Error(`${name} is a binary .x file — re-save it as text`)

  const { nodes } = parseNodes(tokenize(text.slice(16)), 0)
  const named = new Map<string, XNode>()
  gatherNamedMaterials(nodes, named)
  const merged: Merged = { positions: [], normals: [], uvs: [], triangles: [], materials: [] }
  walk(nodes, IDENTITY, named, merged)
  if (merged.triangles.length === 0) throw new Error(`${name} has no mesh`)

  const vertices: PmxVertex[] = []
  for (let i = 0; i < merged.positions.length / 3; i++) {
    vertices.push({
      position: [merged.positions[i * 3], merged.positions[i * 3 + 1], merged.positions[i * 3 + 2]],
      normal: [merged.normals[i * 3], merged.normals[i * 3 + 1], merged.normals[i * 3 + 2]],
      uv: [merged.uvs[i * 2], merged.uvs[i * 2 + 1]],
      additionalUv: [],
      weightType: 0,
      bones: [0],
      weights: [],
      edgeScale: 1,
    })
  }

  // PMX materials own contiguous runs of the index buffer, so triangles are
  // grouped by material, keeping file order inside each group.
  const byMaterial = merged.materials.map(() => [] as number[])
  for (const [m, a, b, c] of merged.triangles) byMaterial[m].push(a, b, c)

  const textures: string[] = []
  const textureIndex = (path: string) => {
    if (!path) return -1
    const at = textures.indexOf(path)
    if (at >= 0) return at
    textures.push(path)
    return textures.length - 1
  }

  const taken = new Set<string>()
  const materials: PmxMaterial[] = []
  const unlit: string[] = []
  const indices: number[] = []
  merged.materials.forEach((xm, i) => {
    const run = byMaterial[i]
    if (run.length === 0) return
    const tex = splitTexture(xm.texture)
    // Names key style groups, so they must be unique. The .x's own name first,
    // then the texture's, then a number.
    const stem = tex.diffuse.split("/").pop()?.replace(/\.[^.]+$/, "")
    const wanted = xm.name || stem || `材質${materials.length + 1}`
    let matName = wanted
    for (let n = 2; taken.has(matName); n++) matName = `${wanted} ${n}`
    taken.add(matName)

    const isUnlit = [0, 1, 2].every((j) => xm.diffuse[j] * MMD_LIGHT + xm.emissive[j] >= 1)
    if (isUnlit) unlit.push(matName)
    materials.push({
      name: matName,
      nameEn: "",
      diffuse: xm.diffuse,
      specular: xm.specular,
      specularPower: xm.power,
      // PMX's ambient plays the part of the accessory's emissive in MMD's
      // shading, which is where PMX Editor puts it too.
      ambient: xm.emissive,
      // A material that ignores the light is light itself, and casts no shadow;
      // the rest cast and receive like any prop.
      drawFlags: isUnlit ? 0 : 0x02 | 0x04 | 0x08,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 0,
      textureIndex: textureIndex(tex.diffuse),
      sphereIndex: textureIndex(tex.sphere),
      sphereMode: tex.sphere ? tex.sphereMode : 0,
      toonShared: 0,
      toonIndex: -1,
      memo: "",
      indexCount: run.length,
    })
    indices.push(...run)
  })

  const stem = name.replace(/^.*\//, "").replace(/\.x$/i, "")
  const doc: PmxDocument = {
    version: 2,
    globals: {
      encoding: 0,
      additionalUvCount: 0,
      vertexIndexSize: vertices.length < 65536 ? 2 : 4,
      textureIndexSize: indexSize(textures.length),
      materialIndexSize: indexSize(materials.length),
      boneIndexSize: 1,
      morphIndexSize: 1,
      rigidbodyIndexSize: 1,
      extra: [],
    },
    name: stem,
    nameEn: stem,
    comment: `Converted from ${stem}.x`,
    commentEn: `Converted from ${stem}.x`,
    vertices,
    indices: new Uint32Array(indices),
    textures,
    materials,
    // One bone, because a PMX model needs a root. An accessory is placed by
    // the model transform and never posed.
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
  return { pmx: writePmxDocument(doc), unlit, textures }
}

/** What a converted upload needs later, keyed by the PMX file it became. */
const converted = new WeakMap<File, { unlit: string[]; textures: string[] }>()

/** The materials MMD shows unlit, for a PMX that came from a .x upload. */
export const xUnlitMaterials = (pmx: File) => converted.get(pmx)?.unlit

/** Whether this PMX is a .x accessory converted on upload. */
export const isFromX = (pmx: File) => converted.has(pmx)

/** Keyed by the File object, like gltf-stage's: a .pmx that is rewritten and
 *  handed back as a new File keeps its .x origin only if it is carried here. */
export function carryXFile(from: File, to: File): void {
  const x = converted.get(from)
  if (x && from !== to) converted.set(to, x)
}

/**
 * A converted accessory and the files its materials read, found the way the
 * engine finds a texture: at its path, else by name. What to keep for it when it
 * loads beside a stage out of the same folder.
 */
export function accessoryFiles(files: File[], pmx: File): File[] {
  const path = relFilePath(pmx)
  const dir = path.slice(0, path.lastIndexOf("/") + 1).toLowerCase()
  const kept = new Set<File>([pmx])
  for (const tex of converted.get(pmx)?.textures ?? []) {
    const want = (dir + tex).toLowerCase()
    const name = want.slice(want.lastIndexOf("/") + 1)
    const hit =
      files.find((f) => relFilePath(f).toLowerCase() === want) ??
      files.find((f) => relFilePath(f).toLowerCase().endsWith("/" + name) || relFilePath(f).toLowerCase() === name)
    if (hit) kept.add(hit)
  }
  return [...kept]
}

/**
 * An upload with every .x replaced by the PMX it converts to, at the same
 * folder path — so its textures resolve exactly as they did for the .x, and the
 * bundle stores the PMX.
 */
export async function convertXUploads(files: File[]): Promise<File[]> {
  if (!files.some((f) => /\.x$/i.test(f.name))) return files
  return Promise.all(
    files.map(async (f) => {
      if (!/\.x$/i.test(f.name)) return f
      const path = relFilePath(f)
      const { pmx, unlit, textures } = xToPmx(await f.arrayBuffer(), path)
      const out = new File([pmx], path.replace(/\.x$/i, ".pmx"))
      converted.set(out, { unlit, textures })
      return out
    }),
  )
}
