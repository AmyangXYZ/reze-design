// Scene bundles, read and written from node.
//
// The node twin of lib/bundle.ts (write) and lib/uploads.ts (read), and it has
// to stay a twin: a bundle this writes is opened by the browser's reader, and a
// bundle the browser wrote is opened by this one.
//
// STORE-ONLY on the way out, matching buildZip. A bundle is already-compressed
// pictures and deflating them again buys single-digit percents for real CPU
// time. The browser's reader accepts method 8 as well, so this could deflate —
// it does not, because parity with the publish path is worth more than those
// percents, and a format that exists twice must not exist two ways.
//
// Names are UTF-8 with the language flag set, which is what the reader expects.

import { inflateRawSync } from "node:zlib"

const LOCAL_SIG = 0x04034b50
const CDIR_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Every entry, in central-directory order: `{ path, bytes }`.
 *
 * Read through the CENTRAL DIRECTORY rather than by walking local headers,
 * because a local header may carry sizes of zero and defer them to a data
 * descriptor — legal, and unreadable by a naive walk.
 */
export function readZip(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  // Backwards from the end: the comment field is variable, so the signature is
  // the only way in. 22 bytes is the record with no comment.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a zip file")

  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)
  const out = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== CDIR_SIG) throw new Error("corrupt zip: central directory")
    const method = view.getUint16(off + 10, true)
    const compSize = view.getUint32(off + 20, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    const path = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen))

    // The local header's own name/extra lengths, which need not match the
    // central directory's extra field.
    if (view.getUint32(localOff, true) !== LOCAL_SIG) throw new Error(`corrupt zip: ${path}`)
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const start = localOff + 30 + lNameLen + lExtraLen
    const comp = buf.subarray(start, start + compSize)

    let bytes
    if (method === 0) bytes = Buffer.from(comp)
    else if (method === 8) bytes = inflateRawSync(comp)
    else throw new Error(`unsupported zip compression (${method}) in ${path}`)

    // Directory entries: a trailing slash and nothing in them.
    if (!path.endsWith("/")) out.push({ path, bytes })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** A store-only zip, byte-for-byte the shape lib/bundle.ts writes. */
export function writeZip(entries) {
  const parts = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const name = Buffer.from(e.path, "utf8")
    const data = e.bytes
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(CDIR_SIG, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)

    offset += 30 + name.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, centralBuf, end])
}
