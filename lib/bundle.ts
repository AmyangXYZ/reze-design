// Scene asset bundle: ONE zip per scene, built in the browser at publish time.
//
// DEFLATED WHERE IT PAYS, stored where it does not. Pictures, audio and video
// are compressed already and stay as they are (method 0). Everything else —
// motions above all, then models, JSON and shaders — is deflated (method 8):
// measured on a 14-model scene, its 44MB of VMD came to 7MB and the whole
// bundle from 138 to 91MB. It has to happen HERE: a published bundle is sealed
// (lib/bundle-cipher), and sealed bytes are noise that nothing on the way to a
// reader can compress. lib/uploads.ts reads both methods, as it always has.
// scripts/lib/zip.mjs is this file's node twin and makes the same choice.

import type { ZipEntry } from "@/lib/uploads"

/** Entry paths are bundle-relative and become File names on the way back out —
 *  the engine resolves textures by relative path, so structure is content.
 *  A file carried over from an open bundle may still be inside its zip; it is
 *  read here only when a zip is actually built. */
export type BundleEntry = { path: string; file: Blob | ZipEntry }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Already compressed: deflating these again buys a percent or two. Shared
 *  with scripts/lib/zip.mjs by hand — one list. */
export const STORED_AS_IS = /\.(png|jpe?g|webp|gif|avif|mp3|m4a|aac|ogg|opus|flac|mp4|m4v|webm|mov|zip|7z|gz|br)$/i
/** Kept deflated only when it saves at least this share; less is not worth an
 *  inflate on the way back out. */
const MIN_SAVING = 0.05

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Build a zip, each entry deflated where that pays (see the top). Names are
 *  written as UTF-8 with the language flag set, which every modern reader (ours
 *  included) honors. */
export async function buildZip(entries: BundleEntry[]): Promise<Blob> {
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0
  // Read together: an entry still inside its zip inflates on the way, and
  // those run side by side (bounded in lib/uploads) rather than one by one.
  const datas = await Promise.all(entries.map(async (e) => new Uint8Array(await e.file.arrayBuffer())))
  // Deflated side by side too; the stream runs off the main thread.
  const packed = await Promise.all(
    entries.map(async (e, i) => {
      if (STORED_AS_IS.test(e.path) || datas[i].length < 256) return null
      const z = await deflateRaw(datas[i])
      return z.length <= datas[i].length * (1 - MIN_SAVING) ? z : null
    }),
  )

  for (const [i, e] of entries.entries()) {
    const name = encoder.encode(e.path)
    const data = datas[i]
    const crc = crc32(data)
    const body = packed[i] ?? data
    const method = packed[i] ? 8 : 0

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, method, true) // 0 store, 8 deflate
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true) // compressed
    local.setUint32(22, data.length, true) // uncompressed
    local.setUint16(26, name.length, true)
    parts.push(local.buffer, name, body)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, method, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, body.length, true)
    dir.setUint32(24, data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true) // local header offset
    central.push(dir.buffer, name)

    offset += 30 + name.length + body.length
  }

  let centralSize = 0
  for (const p of central) centralSize += p instanceof ArrayBuffer ? p.byteLength : (p as Uint8Array).length

  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" })
}
