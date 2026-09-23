// A .glb's embedded textures as WebP, in place of the PNGs it was built with.
//
//   node --import ./scripts/register.mjs scripts/glb-textures-to-webp.mjs <file-or-dir>
//   … --write
//
// DRY RUN by default. With a directory, every .glb under it.
//
// A stage exported from Blender carries its textures as PNG inside the binary
// chunk, and they are most of the file — X309 is 188MB. The app converts them on
// upload anyway (lib/texture-webp.ts), so this is the same bytes, earlier: a
// smaller file on disk, a shorter upload, and an import that skips re-encoding
// because what it extracts is already .webp.
//
// EXT_texture_webp, declared properly. lib/gltf-stage.ts already reads it
// (`t?.extensions?.EXT_texture_webp?.source ?? t?.source`), and the mime map
// there names an extracted file .webp — which is what lets the upload path
// recognise it. It goes in extensionsREQUIRED, not merely used: the extension
// permits a PNG fallback in `source` and there is none left here, so a reader
// without WebP support has to refuse the file rather than draw it wrong. The
// .blend beside it is the source of truth for anything that cannot read it.
//
// The binary chunk is rebuilt whole. Buffer views are copied in their existing
// order with fresh offsets, which is the only way to stay correct when a view
// changes length: byteStride and every accessor into it are untouched, so only
// where the bytes live has changed.

import { readdir, readFile, writeFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { toWebp } from "./lib/webp-texture.mjs"

const WRITE = process.argv.includes("--write")
const TARGET = process.argv.slice(2).find((a) => !a.startsWith("--"))
if (!TARGET) {
  console.error("usage: node --import ./scripts/register.mjs scripts/glb-textures-to-webp.mjs <file-or-dir> [--write]")
  process.exit(2)
}

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const MB = (n) => (n / 1048576).toFixed(1)
/** glTF requires every chunk and buffer view to start on a 4-byte boundary. */
const pad4 = (n) => (4 - (n % 4)) % 4

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a .glb")
  let off = 12
  let json = null
  let bin = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(data))
    else if (type === BIN_CHUNK) bin = data
    off += 8 + len + pad4(len)
  }
  if (!json) throw new Error("no JSON chunk")
  return { json, bin }
}

function writeGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8")
  const jsonPad = Buffer.alloc(pad4(jsonBytes.length), 0x20) // spaces
  const binPad = Buffer.alloc(pad4(bin.length), 0)
  const total = 12 + 8 + jsonBytes.length + jsonPad.length + 8 + bin.length + binPad.length

  const head = Buffer.alloc(12)
  head.writeUInt32LE(0x46546c67, 0)
  head.writeUInt32LE(2, 4)
  head.writeUInt32LE(total, 8)

  const jsonHead = Buffer.alloc(8)
  jsonHead.writeUInt32LE(jsonBytes.length + jsonPad.length, 0)
  jsonHead.writeUInt32LE(JSON_CHUNK, 4)

  const binHead = Buffer.alloc(8)
  binHead.writeUInt32LE(bin.length + binPad.length, 0)
  binHead.writeUInt32LE(BIN_CHUNK, 4)

  return Buffer.concat([head, jsonHead, jsonBytes, jsonPad, binHead, bin, binPad])
}

async function convert(path) {
  const buf = await readFile(path)
  const { json, bin } = readGlb(buf)
  if (!bin) {
    console.log(`${path} — no binary chunk, skipped`)
    return
  }
  const images = json.images ?? []
  if (!images.length) {
    console.log(`${path} — no images`)
    return
  }

  /** image index -> the WebP bytes that replace it. */
  const replaced = new Map()
  let before = 0
  let after = 0
  const kept = new Map()
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (img.bufferView === undefined) {
      kept.set("external uri", (kept.get("external uri") ?? 0) + 1)
      continue
    }
    if (img.mimeType === "image/webp") {
      kept.set("already webp", (kept.get("already webp") ?? 0) + 1)
      continue
    }
    const bv = json.bufferViews[img.bufferView]
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
    const name = img.name ?? `image ${i}`
    const r = await toWebp(bytes, `${name}.${img.mimeType === "image/jpeg" ? "jpg" : "png"}`)
    if (r.kept) {
      kept.set(r.kept, (kept.get(r.kept) ?? 0) + 1)
      continue
    }
    replaced.set(i, r.out)
    before += bytes.length
    after += r.out.length
    console.log(
      `    ${String(name).slice(0, 38).padEnd(38)} ${MB(bytes.length)} → ${MB(r.out.length)}MB  ${r.mode.padEnd(9)}` +
        ` PSNR ${r.psnr} worst±${r.worst}${r.dropped ? ` (+${r.dropped} px under alpha 0)` : ""}`,
    )
  }
  for (const [why, n] of kept) console.log(`    ${n} kept — ${why}`)
  if (!replaced.size) {
    console.log(`  nothing to convert`)
    return
  }

  // The binary chunk, rebuilt. Views keep their order and gain new offsets;
  // an image's view gets its new bytes and its new length.
  const bvBytes = json.bufferViews.map((bv, i) => {
    const img = images.findIndex((im) => im.bufferView === i)
    const swap = img >= 0 ? replaced.get(img) : undefined
    return swap ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
  })
  const parts = []
  let offset = 0
  json.bufferViews.forEach((bv, i) => {
    const bytes = bvBytes[i]
    bv.byteOffset = offset
    bv.byteLength = bytes.length
    parts.push(bytes)
    offset += bytes.length
    const pad = pad4(bytes.length)
    if (pad) {
      parts.push(Buffer.alloc(pad))
      offset += pad
    }
  })
  const nextBin = Buffer.concat(parts)
  json.buffers[0].byteLength = nextBin.length

  for (const i of replaced.keys()) images[i].mimeType = "image/webp"

  // Declared, so a reader knows what it is looking at. Required rather than
  // merely used: there is no PNG left in `source` to fall back to.
  const add = (list, name) => (list?.includes(name) ? list : [...(list ?? []), name])
  json.extensionsUsed = add(json.extensionsUsed, "EXT_texture_webp")
  json.extensionsRequired = add(json.extensionsRequired, "EXT_texture_webp")
  for (const t of json.textures ?? []) {
    if (t.source === undefined || !replaced.has(t.source)) continue
    t.extensions = { ...(t.extensions ?? {}), EXT_texture_webp: { source: t.source } }
  }

  const out = writeGlb(json, nextBin)
  console.log(
    `  textures ${MB(before)} → ${MB(after)}MB · file ${MB(buf.length)} → ${MB(out.length)}MB` +
      `  (−${Math.round((1 - out.length / buf.length) * 100)}%)`,
  )
  // READ BACK BEFORE IT REPLACES ANYTHING, and prove more than that it parses:
  // this overwrites a file whose only other copy is the .blend beside it.
  const check = readGlb(out)
  if ((check.json.images ?? []).length !== images.length) throw new Error("rebuilt .glb lost images")
  if ((check.json.bufferViews ?? []).length !== json.bufferViews.length) throw new Error("rebuilt .glb lost buffer views")
  if (!check.bin) throw new Error("rebuilt .glb lost its binary chunk")
  // Every view still inside the buffer it indexes into — the one thing that
  // rebuilding offsets can get wrong, and it would show as missing geometry
  // rather than as an error.
  for (const [i, bv] of (check.json.bufferViews ?? []).entries()) {
    if ((bv.byteOffset ?? 0) + bv.byteLength > check.bin.length) throw new Error(`buffer view ${i} runs past the binary chunk`)
  }
  if (check.json.buffers[0].byteLength !== check.bin.length && check.json.buffers[0].byteLength > check.bin.length)
    throw new Error("buffer length disagrees with the binary chunk")
  // And every converted image really is a WebP where the JSON says it is.
  for (const i of replaced.keys()) {
    const bv = check.json.bufferViews[check.json.images[i].bufferView]
    const head = check.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + 12)
    if (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WEBP")
      throw new Error(`image ${i} is not WebP at the offset the JSON gives`)
  }
  if (WRITE) await writeFile(path, out)
}

const st = await stat(TARGET)
const files = st.isDirectory()
  ? (await readdir(TARGET, { recursive: true })).filter((f) => f.endsWith(".glb")).map((f) => join(TARGET, f)).sort()
  : [TARGET]

for (const f of files) {
  console.log(`\n${f}`)
  try {
    await convert(f)
  } catch (e) {
    console.error(`  ✗ left as it was — ${e.message}`)
  }
}
console.log(WRITE ? "\ndone" : "\n— dry run, nothing written; pass --write")
