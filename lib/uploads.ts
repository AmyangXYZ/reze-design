// Upload plumbing for model files: ZIP extraction and drag-&-drop directory
// traversal. MMD models are distributed as zips with subfolder textures — a
// single .zip pick (the only sane path on mobile, where pickers can't select
// folders) or a dropped folder both expand to File[] whose NAMES carry the
// relative path ("塞尔凯特/tex/body.png"); the engine keys its file map by
// webkitRelativePath || name, so paths-in-names resolve exactly like a folder
// pick. Zip name encoding: UTF-8 when flag bit 11 is set, else Shift-JIS (the
// standard for Japanese community zips); separators normalized (PowerShell's
// Compress-Archive writes backslashes).

const EOCD_SIG = 0x06054b50
const CDIR_SIG = 0x02014b50

/** Extract a .zip into File objects (relative paths in the names). */
export async function unzipToFiles(zip: File): Promise<File[]> {
  const buffer = await zip.arrayBuffer()
  const view = new DataView(buffer)
  const u8 = new Uint8Array(buffer)
  let eocd = -1
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 65536); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${zip.name}`)
  const count = view.getUint16(eocd + 10, true)
  let off = view.getUint32(eocd + 16, true)

  const utf8 = new TextDecoder("utf-8")
  const sjis = new TextDecoder("shift-jis")
  const out: File[] = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== CDIR_SIG) throw new Error(`Corrupt zip: ${zip.name}`)
    const flags = view.getUint16(off + 8, true)
    const method = view.getUint16(off + 10, true)
    const compSize = view.getUint32(off + 20, true)
    const nameLen = view.getUint16(off + 28, true)
    const extraLen = view.getUint16(off + 30, true)
    const commentLen = view.getUint16(off + 32, true)
    const localOff = view.getUint32(off + 42, true)
    const nameBytes = u8.subarray(off + 46, off + 46 + nameLen)
    const name = ((flags & 0x800) !== 0 ? utf8 : sjis).decode(nameBytes).replace(/\\/g, "/")
    off += 46 + nameLen + extraLen + commentLen
    if (!name || name.endsWith("/")) continue // directory entry

    // Local header name/extra lengths differ from the central ones; sizes there
    // may be zero (data-descriptor zips) — central sizes are authoritative.
    const lNameLen = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const comp = u8.slice(dataStart, dataStart + compSize)
    let blob: Blob
    if (method === 0) blob = new Blob([comp])
    else if (method === 8) {
      const ds = new DecompressionStream("deflate-raw")
      blob = await new Response(new Blob([comp]).stream().pipeThrough(ds)).blob()
    } else throw new Error(`Unsupported zip compression (${method}) in ${zip.name}`)
    out.push(new File([blob], name))
  }
  return out
}

/** Expand any .zip files in a selection; everything else passes through. */
export async function expandUploadFiles(files: File[]): Promise<File[]> {
  const out: File[] = []
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) out.push(...(await unzipToFiles(f)))
    else out.push(f)
  }
  return out
}

/** Drag & drop: traverse dropped items (files AND directories) into File[] with
 *  relative paths in the names. readEntries returns batches — loop until empty. */
export async function readDroppedFiles(items: DataTransferItemList): Promise<File[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(items)) {
    const e = item.webkitGetAsEntry?.()
    if (e) entries.push(e)
  }
  const out: File[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      // Re-wrap with the path in the name (webkitRelativePath is read-only "").
      // File([blob]) references the data — no copy.
      out.push(prefix ? new File([file], prefix + file.name) : file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (batch.length === 0) break
        for (const child of batch) await walk(child, prefix + entry.name + "/")
      }
    }
  }
  for (const e of entries) await walk(e, "")
  return out
}
