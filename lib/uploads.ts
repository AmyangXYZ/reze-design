// Upload plumbing for model files: ZIP extraction and drag-&-drop directory traversal.

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const UNICODE_PATH_EXTRA = 0x7075;

/** UTF-8 name from the Info-ZIP Unicode Path extra field, if present. */
function unicodePathFromExtra(
  u8: Uint8Array,
  start: number,
  len: number,
): string | null {
  const view = new DataView(u8.buffer, u8.byteOffset + start, len);
  let p = 0;
  while (p + 4 <= len) {
    const id = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (id === UNICODE_PATH_EXTRA && size >= 5) {
      // 1 byte version + 4 bytes name-CRC, then the UTF-8 name.
      return new TextDecoder("utf-8").decode(
        u8.subarray(start + p + 4 + 5, start + p + 4 + size),
      );
    }
    p += 4 + size;
  }
  return null;
}

/** Pick the codepage that decodes every name in the zip most plausibly. */
function detectLegacyEncoding(nameBytes: Uint8Array[]): string {
  const candidates = ["shift-jis", "gb18030", "big5", "euc-kr"];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const enc of candidates) {
    const dec = new TextDecoder(enc);
    let score = 0;
    for (const bytes of nameBytes) {
      const s = dec.decode(bytes);
      for (const ch of s) {
        const c = ch.codePointAt(0)!;
        if (c === 0xfffd)
          score += 20; // undecodable — strong evidence against
        else if (c >= 0xff61 && c <= 0xff9f)
          score += 2; // halfwidth katakana (mojibake smell)
        else if (c >= 0xe000 && c <= 0xf8ff) score += 5; // private use area
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = enc;
    }
  }
  return best;
}

/** Extract a .zip into File objects (relative paths in the names). */
export async function unzipToFiles(zip: File): Promise<File[]> {
  const buffer = await zip.arrayBuffer();
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let eocd = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 22 - 65536);
    i--
  ) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${zip.name}`);
  const count = view.getUint16(eocd + 10, true);

  // Pass 1: collect entries + name bytes, resolve UTF-8 sources (extra field / flag)
  type Entry = {
    name: string | null;
    bytes: Uint8Array;
    method: number;
    compSize: number;
    localOff: number;
  };
  const entries: Entry[] = [];
  const undecided: Uint8Array[] = [];
  const utf8Strict = new TextDecoder("utf-8", { fatal: true });
  let allValidUtf8 = true;
  let off = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== CDIR_SIG)
      throw new Error(`Corrupt zip: ${zip.name}`);
    const flags = view.getUint16(off + 8, true);
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const bytes = u8.slice(off + 46, off + 46 + nameLen);
    let name: string | null = unicodePathFromExtra(
      u8,
      off + 46 + nameLen,
      extraLen,
    );
    if (name === null && (flags & 0x800) !== 0)
      name = new TextDecoder("utf-8").decode(bytes);
    if (name === null) {
      try {
        utf8Strict.decode(bytes);
      } catch {
        allValidUtf8 = false;
      }
      undecided.push(bytes);
    }
    entries.push({ name, bytes, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }

  // Pass 2: decode the undecided names
  if (undecided.length > 0) {
    const enc = allValidUtf8 ? "utf-8" : detectLegacyEncoding(undecided);
    const dec = new TextDecoder(enc);
    for (const e of entries) if (e.name === null) e.name = dec.decode(e.bytes);
  }

  const out: File[] = [];
  for (const e of entries) {
    const name = (e.name ?? "").replace(/\\/g, "/");
    if (!name || name.endsWith("/")) continue; // directory entry

    // Local header name/extra lengths differ from the central ones
    const lNameLen = view.getUint16(e.localOff + 26, true);
    const lExtraLen = view.getUint16(e.localOff + 28, true);
    const dataStart = e.localOff + 30 + lNameLen + lExtraLen;
    const comp = u8.slice(dataStart, dataStart + e.compSize);
    let blob: Blob;
    if (e.method === 0) blob = new Blob([comp]);
    else if (e.method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      blob = await new Response(
        new Blob([comp]).stream().pipeThrough(ds),
      ).blob();
    } else
      throw new Error(
        `Unsupported zip compression (${e.method}) in ${zip.name}`,
      );
    out.push(new File([blob], name));
  }
  return out;
}

/** Expand any .zip files in a selection; everything else passes through. */
export async function expandUploadFiles(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip"))
      out.push(...(await unzipToFiles(f)));
    else out.push(f);
  }
  return out;
}

/** Drag & drop: traverse dropped items (files AND directories) into File[] with relative paths */
export async function readDroppedFiles(
  items: DataTransferItemList,
): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    const e = item.webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  const out: File[] = [];
  const walk = async (
    entry: FileSystemEntry,
    prefix: string,
  ): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      // Re-wrap with the path in the name (webkitRelativePath is read-only "").
      out.push(prefix ? new File([file], prefix + file.name) : file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, prefix + entry.name + "/");
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
