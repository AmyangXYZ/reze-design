// The minimum of a PMX file that colour extraction needs: which triangles wear
// which texture, with enough geometry to know how BIG each one is.
//
// The engine parses all of this and more, but exposes models, not meshes — and
// the swatch is a design-layer concern that should not grow the engine's API.
// Parsing the file again here costs tens of milliseconds once per model, reads
// nothing but positions, UVs and material ranges, and touches nothing
// browser-specific — which is what let the extraction be validated offline in
// Node against a shelf of real models before it ever ran in the app.
//
// Field order and index conventions mirror the engine's PmxLoader — vertex
// indices are unsigned at sizes 1/2, other indices signed.

export type PmxMaterialMesh = {
  name: string
  /** RGBA, 0..1. */
  diffuse: [number, number, number, number]
  ambient: [number, number, number]
  /** Into `texturePaths`, or -1. */
  textureIndex: number
  /** This material's range in `indices` — PMX materials own consecutive runs. */
  indexStart: number
  indexCount: number
}

export type PmxMesh = {
  /** xyz per vertex, bind pose, model space. */
  positions: Float32Array
  /** uv per vertex. May tile outside [0,1]. */
  uvs: Float32Array
  indices: Uint32Array
  materials: PmxMaterialMesh[]
  texturePaths: string[]
}

export function parsePmxMesh(buffer: ArrayBuffer): PmxMesh {
  const view = new DataView(buffer)
  let offset = 0

  const u8 = () => view.getUint8(offset++)
  const i32 = () => {
    const v = view.getInt32(offset, true)
    offset += 4
    return v
  }
  const f32 = () => {
    const v = view.getFloat32(offset, true)
    offset += 4
    return v
  }

  // ── Header ──
  const magic = String.fromCharCode(u8(), u8(), u8())
  u8() // the space after "PMX"
  if (magic.toUpperCase() !== "PMX") throw new Error("Not a PMX file")
  f32() // version
  // The globals block, read once and named by position — the PMX spec's own
  // table, visible as a table. [4] material and [6][7] morph/rigid index sizes
  // are irrelevant here; extra globals beyond 8 are future-format padding.
  const globalsCount = u8()
  const globals = new Uint8Array(buffer, offset, globalsCount)
  offset += globalsCount
  const [encoding, additionalVec4, vertexIndexSize, textureIndexSize, , boneIndexSize] = globals

  const decoder = new TextDecoder(encoding === 0 ? "utf-16le" : "utf-8")
  const text = () => {
    const len = i32()
    if (len <= 0) return ""
    const s = decoder.decode(new Uint8Array(buffer, offset, len))
    offset += len
    return s
  }
  const index = (size: number, signed: boolean) => {
    if (size === 1) {
      const v = signed ? view.getInt8(offset) : view.getUint8(offset)
      offset += 1
      return v
    }
    if (size === 2) {
      const v = signed ? view.getInt16(offset, true) : view.getUint16(offset, true)
      offset += 2
      return v
    }
    return i32()
  }

  text() // model name
  text() // model name en
  text() // comment
  text() // comment en

  // ── Vertices ──
  const vertexCount = i32()
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = f32()
    positions[i * 3 + 1] = f32()
    positions[i * 3 + 2] = f32()
    offset += 12 // normal
    uvs[i * 2] = f32()
    uvs[i * 2 + 1] = f32()
    offset += additionalVec4 * 16
    const weightType = u8()
    // BDEF1 · BDEF2 · BDEF4 · SDEF (BDEF2 + 3 vec3) · QDEF
    if (weightType === 0) offset += boneIndexSize
    else if (weightType === 1) offset += boneIndexSize * 2 + 4
    else if (weightType === 2 || weightType === 4) offset += boneIndexSize * 4 + 16
    else if (weightType === 3) offset += boneIndexSize * 2 + 4 + 36
    offset += 4 // edge scale
  }

  // ── Faces ──
  const indexCount = i32()
  const indices = new Uint32Array(indexCount)
  for (let i = 0; i < indexCount; i++) indices[i] = index(vertexIndexSize, false)

  // ── Textures ──
  const textureCount = i32()
  const texturePaths: string[] = []
  for (let i = 0; i < textureCount; i++) texturePaths.push(text().replace(/\\/g, "/"))

  // ── Materials ──
  const materialCount = i32()
  const materials: PmxMaterialMesh[] = []
  let runningStart = 0
  for (let i = 0; i < materialCount; i++) {
    const name = text()
    text() // english name
    const diffuse: [number, number, number, number] = [f32(), f32(), f32(), f32()]
    offset += 16 // specular rgb + shininess
    const ambient: [number, number, number] = [f32(), f32(), f32()]
    u8() // flags
    offset += 20 // edge colour + edge size
    const textureIndex = index(textureIndexSize, true)
    index(textureIndexSize, true) // sphere texture
    u8() // sphere mode
    const sharedToon = u8()
    if (sharedToon === 1) u8()
    else index(textureIndexSize, true)
    text() // comment
    const count = i32()
    materials.push({ name, diffuse, ambient, textureIndex, indexStart: runningStart, indexCount: count })
    runningStart += count
  }

  return { positions, uvs, indices, materials, texturePaths }
}
