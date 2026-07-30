// Scene asset bundle: ONE zip per scene, built in the browser at publish time.
//
// Store-only (no compression): PMX textures are already-compressed PNGs and
// deflating them again buys single-digit percents for real CPU time. Store
// entries also round-trip through lib/uploads.ts's unzipToFiles (method 0), so
// the write and read paths share one format with no dependency.

/** Entry paths are bundle-relative and become File names on the way back out —
 *  the engine resolves textures by relative path, so structure is content. */
export type BundleEntry = { path: string; file: Blob }

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

/** Build a store-only zip. Names are written as UTF-8 with the language flag set,
 *  which every modern reader (ours included) honors. */
export async function buildZip(entries: BundleEntry[]): Promise<Blob> {
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const central: BlobPart[] = []
  let offset = 0

  for (const e of entries) {
    const name = encoder.encode(e.path)
    const data = new Uint8Array(await e.file.arrayBuffer())
    const crc = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // method: store
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true) // compressed
    local.setUint32(22, data.length, true) // uncompressed
    local.setUint16(26, name.length, true)
    parts.push(local.buffer, name, data)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, 0, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true) // local header offset
    central.push(dir.buffer, name)

    offset += 30 + name.length + data.length
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
