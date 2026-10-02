// Upload plumbing for model files: ZIP reading and drag-&-drop directory traversal.

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const UNICODE_PATH_EXTRA = 0x7075;

/**
 * A zip entry carries no content type, so one is named from the extension.
 *
 * This is not cosmetic. A File built without a `type` makes an object URL that
 * serves no Content-Type, and WebKit will not play media it has not been told
 * the type of — `<audio src="blob:…">` fails with MEDIA_ERR_SRC_NOT_SUPPORTED
 * where Chrome sniffs the bytes and plays it anyway. That is the whole of "the
 * published scene is silent on iPhone and fine on the desktop": the editor's
 * track comes from a file input, which the OS types for us, while a viewer's
 * comes out of the scene's own zip, which does not.
 *
 * Only the kinds that travel in a bundle and are handed to an element or a
 * decoder. A .pmx or a .vmd is read as bytes by code that never asks, and
 * inventing a type for those would be noise.
 */
const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  hdr: "image/vnd.radiance",
  mid: "audio/midi",
  midi: "audio/midi",
  lrc: "text/plain",
};

/** The content type for a path, or "" when we have nothing useful to say —
 *  which is what a File gets today and stays correct for bytes nobody types. */
export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "";
}

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

const LOCAL_SIG = 0x04034b50;

/**
 * Inflations in flight at once, across every open zip.
 *
 * A stage asks for its whole folder in one go and a game scene's folder is
 * hundreds of files, so each request queues here rather than starting a
 * decompressor at once. One per core keeps every core busy without a hundred
 * streams fighting over them.
 */
const INFLATE_LIMIT = Math.max(
  2,
  (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4,
);
let inflating = 0;
const inflateQueue: (() => void)[] = [];

async function bounded<T>(run: () => Promise<T>): Promise<T> {
  // A released slot is handed straight to the next waiter, so the count only
  // drops when nobody is queued.
  if (inflating >= INFLATE_LIMIT)
    await new Promise<void>((resolve) => inflateQueue.push(resolve));
  else inflating++;
  try {
    return await run();
  } finally {
    const next = inflateQueue.shift();
    if (next) next();
    else inflating--;
  }
}

/**
 * One file inside a zip, not yet read.
 *
 * Opening a zip reads its central directory and nothing else, so a 100MB scene
 * with thousands of entries is open in milliseconds, and only the entries a
 * loader actually asks for are ever touched. A stored entry is a slice of the
 * zip — no bytes copied; a deflated one is inflated when asked for, and not
 * kept: whoever asked holds the bytes for as long as they need them.
 *
 * `name` is the zip path, which is what a bundle file's name is everywhere.
 */
export class ZipEntry {
  readonly type: string;
  constructor(
    /** The whole zip this entry lives in. */
    readonly zip: Blob,
    readonly name: string,
    readonly method: number,
    readonly compSize: number,
    /** Uncompressed. */
    readonly size: number,
    readonly localOff: number,
  ) {
    this.type = mimeForPath(name);
  }

  /** The same bytes under another path. */
  as(name: string): ZipEntry {
    return new ZipEntry(
      this.zip,
      name,
      this.method,
      this.compSize,
      this.size,
      this.localOff,
    );
  }

  /** The bytes as a File named by its path. */
  async file(): Promise<File> {
    // The local header's name and extra lengths can differ from the central
    // directory's, so the data's start is read from the entry itself.
    const head = new DataView(
      await this.zip.slice(this.localOff, this.localOff + 30).arrayBuffer(),
    );
    if (head.byteLength < 30 || head.getUint32(0, true) !== LOCAL_SIG)
      throw new Error(`Corrupt zip entry: ${this.name}`);
    const start =
      this.localOff + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const comp = this.zip.slice(start, start + this.compSize);
    if (this.method === 0)
      return new File([comp], this.name, { type: this.type });
    if (this.method !== 8)
      throw new Error(
        `Unsupported zip compression (${this.method}) in ${this.name}`,
      );
    // The compressed bytes in one read first: streaming a slice of a file on
    // disk arrives in small chunks, and measured slower than the read itself.
    const blob = await bounded(async () =>
      new Response(
        new Blob([await comp.arrayBuffer()])
          .stream()
          .pipeThrough(new DecompressionStream("deflate-raw")),
      ).blob(),
    );
    return new File([blob], this.name, { type: this.type });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.file()).arrayBuffer();
  }

  async text(): Promise<string> {
    return (await this.file()).text();
  }
}

/**
 * A file of a scene bundle, by its bundle path: a File already in memory (an
 * upload, a record written before bundles kept their zips) or an entry of a
 * zip that has not been read. Both carry `name`, `size`, `type` and
 * `arrayBuffer()`; a consumer that needs a real File asks `readBundleFile`.
 */
export type BundleFile = File | ZipEntry;

/**
 * Bytes under a bundle path, as a bundle file whose name is that path.
 *
 * The type is named from the path when the blob has none, which is the common
 * case: a Blob out of the zip packer carries no type at all, and WebKit will
 * not play a typeless object URL (see MIME_BY_EXT).
 */
export function bundleFileOf(path: string, file: Blob | ZipEntry): BundleFile {
  if (file instanceof ZipEntry) return file.name === path ? file : file.as(path);
  return new File([file], path, { type: file.type || mimeForPath(path) });
}

export function readBundleFile(f: BundleFile): Promise<File> {
  return f instanceof ZipEntry ? f.file() : Promise.resolve(f);
}

/** Every one of them, read concurrently — inflation is bounded underneath. */
export function readBundleFiles(files: readonly BundleFile[]): Promise<File[]> {
  return Promise.all(files.map(readBundleFile));
}

/**
 * A zip's files, from its central directory alone (relative paths in the
 * names). Reads the tail of the blob and nothing else; directory entries are
 * left out.
 */
export async function openZip(
  zip: Blob,
  label = zip instanceof File ? zip.name : "zip",
): Promise<ZipEntry[]> {
  // The end record is the last 22 bytes, plus a comment of at most 64KB.
  const tailStart = Math.max(0, zip.size - 22 - 65536);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${label}`);
  const count = tail.getUint16(eocd + 10, true);
  const cdirSize = tail.getUint32(eocd + 12, true);
  const cdirOff = tail.getUint32(eocd + 16, true);
  const u8 = new Uint8Array(
    await zip.slice(cdirOff, cdirOff + cdirSize).arrayBuffer(),
  );
  const view = new DataView(u8.buffer);

  // Pass 1: collect entries + name bytes, resolve UTF-8 sources (extra field / flag)
  type Entry = {
    name: string | null;
    bytes: Uint8Array;
    method: number;
    compSize: number;
    size: number;
    localOff: number;
  };
  const entries: Entry[] = [];
  const undecided: Uint8Array[] = [];
  const utf8Strict = new TextDecoder("utf-8", { fatal: true });
  let allValidUtf8 = true;
  let off = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > u8.length || view.getUint32(off, true) !== CDIR_SIG)
      throw new Error(`Corrupt zip: ${label}`);
    const flags = view.getUint16(off + 8, true);
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const size = view.getUint32(off + 24, true);
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
    entries.push({ name, bytes, method, compSize, size, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }

  // Pass 2: decode the undecided names
  if (undecided.length > 0) {
    const enc = allValidUtf8 ? "utf-8" : detectLegacyEncoding(undecided);
    const dec = new TextDecoder(enc);
    for (const e of entries) if (e.name === null) e.name = dec.decode(e.bytes);
  }

  const out: ZipEntry[] = [];
  for (const e of entries) {
    const name = (e.name ?? "").replace(/\\/g, "/");
    if (!name || name.endsWith("/")) continue; // directory entry
    out.push(new ZipEntry(zip, name, e.method, e.compSize, e.size, e.localOff));
  }
  return out;
}

/** Extract a .zip into File objects (relative paths in the names). */
export async function unzipToFiles(zip: File): Promise<File[]> {
  return readBundleFiles(await openZip(zip));
}

/**
 * Bundles this tab already holds open, by the blob: URL a document names them
 * with.
 *
 * An imported zip is opened once to read its scene.json; handing the document
 * a plain object URL of it would make the loader fetch those bytes back and
 * open them a second time. Held here, the loader takes the open bundle as is.
 * The URL is still a real blob: one, so everything that treats a blob: bundle
 * as this session's alone keeps doing so.
 */
const heldBundles = new Map<string, BundleFile[]>();

export function holdBundle(
  files: BundleFile[],
  blob: Blob = new Blob(),
): string {
  const url = URL.createObjectURL(blob);
  heldBundles.set(url, files);
  return url;
}

export function heldBundle(url: string): BundleFile[] | undefined {
  return heldBundles.get(url);
}

export function releaseBundle(url: string): void {
  heldBundles.delete(url);
  URL.revokeObjectURL(url);
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
      // Carrying `type` across the re-wrap, since dropping it is the same silent
      // failure the zip path had: the OS typed this file for us and a File built
      // without one makes an object URL WebKit will not play.
      out.push(
        prefix
          ? new File([file], prefix + file.name, {
              type: file.type || mimeForPath(file.name),
            })
          : file,
      );
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
