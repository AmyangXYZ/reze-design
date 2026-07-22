// Generates a minimal preview sphere: a UV-sphere PMX 2.0 (one material, one
// root bone, BDEF1 weights, no-cull) + a neutral checker texture, for the node-
// graph library's live preview. reze-engine loads it like any PMX — no engine
// primitive API needed.
//
//   node scripts/generate-sphere-pmx.mjs
//
// Outputs public/models/preview/sphere.pmx and sphere.png.

import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "preview")
const STACKS = 24 // latitude bands
const SLICES = 32 // longitude segments
const RADIUS = 1

// ── Growable little-endian byte writer ───────────────────────────────────────
class Writer {
  constructor() {
    this.buf = Buffer.alloc(1024)
    this.len = 0
  }
  _ensure(n) {
    if (this.len + n <= this.buf.length) return
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.len + n))
    this.buf.copy(next)
    this.buf = next
  }
  u8(v) { this._ensure(1); this.buf.writeUInt8(v & 0xff, this.len); this.len += 1 }
  u16(v) { this._ensure(2); this.buf.writeUInt16LE(v & 0xffff, this.len); this.len += 2 }
  i32(v) { this._ensure(4); this.buf.writeInt32LE(v | 0, this.len); this.len += 4 }
  f32(v) { this._ensure(4); this.buf.writeFloatLE(v, this.len); this.len += 4 }
  bytes(b) { this._ensure(b.length); b.copy(this.buf, this.len); this.len += b.length }
  /** PMX text: int32 byte-length + UTF-8 bytes. */
  text(s) { const b = Buffer.from(s, "utf8"); this.i32(b.length); this.bytes(b) }
  /** Signed index of `size` bytes (−1 → all 0xFF). */
  sidx(size, v) { this._ensure(size); this.buf.writeIntLE(v, this.len, size); this.len += size }
  /** Unsigned face vertex index of `size` bytes. */
  uidx(size, v) { this._ensure(size); this.buf.writeUIntLE(v, this.len, size); this.len += size }
  out() { return this.buf.subarray(0, this.len) }
}

// ── UV sphere geometry ───────────────────────────────────────────────────────
const verts = []
for (let i = 0; i <= STACKS; i++) {
  const phi = (Math.PI * i) / STACKS
  const sy = Math.cos(phi)
  const sr = Math.sin(phi)
  for (let j = 0; j <= SLICES; j++) {
    const theta = (2 * Math.PI * j) / SLICES
    const nx = sr * Math.cos(theta)
    const ny = sy
    const nz = sr * Math.sin(theta)
    verts.push({
      pos: [nx * RADIUS, ny * RADIUS, nz * RADIUS],
      nrm: [nx, ny, nz],
      uv: [j / SLICES, i / STACKS],
    })
  }
}
const indices = []
const row = SLICES + 1
for (let i = 0; i < STACKS; i++) {
  for (let j = 0; j < SLICES; j++) {
    const a = i * row + j
    const b = a + 1
    const c = a + row
    const d = c + 1
    indices.push(a, b, d, a, d, c) // no-cull material, so winding is cosmetic
  }
}

const VIDX = 2 // vertex index size (bytes) — < 65536 verts
const XIDX = 1 // texture / material / bone / morph / rigidbody index size

const w = new Writer()
// Header
w.bytes(Buffer.from("PMX ", "ascii"))
w.f32(2.0)
w.u8(8) // globals count
w.u8(1) // encoding: UTF-8
w.u8(0) // additional UVs
w.u8(VIDX)
w.u8(XIDX) // texture
w.u8(XIDX) // material
w.u8(XIDX) // bone
w.u8(XIDX) // morph
w.u8(XIDX) // rigidbody
w.text("Preview Sphere")
w.text("Preview Sphere")
w.text("") // comment
w.text("") // english comment

// Vertices
w.i32(verts.length)
for (const v of verts) {
  w.f32(v.pos[0]); w.f32(v.pos[1]); w.f32(v.pos[2])
  w.f32(v.nrm[0]); w.f32(v.nrm[1]); w.f32(v.nrm[2])
  w.f32(v.uv[0]); w.f32(v.uv[1])
  w.u8(0) // weight deform: BDEF1
  w.sidx(XIDX, 0) // bone 0
  w.f32(1.0) // edge scale
}

// Faces (indices)
w.i32(indices.length)
for (const idx of indices) w.uidx(VIDX, idx)

// Textures
w.i32(1)
w.text("sphere.png")

// Materials (one, covering all faces)
w.i32(1)
w.text("sphere"); w.text("sphere")
w.f32(0.85); w.f32(0.85); w.f32(0.85); w.f32(1.0) // diffuse RGBA
w.f32(0); w.f32(0); w.f32(0) // specular RGB
w.f32(0) // specular strength
w.f32(0.5); w.f32(0.5); w.f32(0.5) // ambient RGB
w.u8(0x01) // drawing flags: no cull (double-sided)
w.f32(0); w.f32(0); w.f32(0); w.f32(1) // edge color
w.f32(1.0) // edge size
w.sidx(XIDX, 0) // texture index → sphere.png
w.sidx(XIDX, -1) // sphere texture: none
w.u8(0) // sphere mode: none
w.u8(1) // toon reference: shared
w.u8(0) // shared toon index
w.text("") // memo
w.i32(indices.length) // this material's face-vertex count

// Bones (one root)
w.i32(1)
w.text("root"); w.text("root")
w.f32(0); w.f32(0); w.f32(0) // position
w.sidx(XIDX, -1) // parent: none
w.i32(0) // deform layer
w.u16(0x001a) // rotatable | visible | enabled ; tail = offset (bit0 unset)
w.f32(0); w.f32(1); w.f32(0) // tail offset

// Empty tail sections (loader still reads each count)
w.i32(0) // morphs
w.i32(0) // display frames
w.i32(0) // rigidbodies
w.i32(0) // joints

// ── Neutral checker texture (256×256 RGB) ────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, "ascii")
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}
const SIZE = 256
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3))
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 3)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const light = ((x >> 5) + (y >> 5)) & 1
    const g = light ? 210 : 190 // subtle gray checker
    const o = rowStart + 1 + x * 3
    raw[o] = g; raw[o + 1] = g; raw[o + 2] = g
  }
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 2 // 8-bit, RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(raw)),
  pngChunk("IEND", Buffer.alloc(0)),
])

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, "sphere.pmx"), w.out())
writeFileSync(join(OUT_DIR, "sphere.png"), png)
console.log(`sphere.pmx (${w.len} bytes, ${verts.length} verts, ${indices.length / 3} tris) + sphere.png → ${OUT_DIR}`)
