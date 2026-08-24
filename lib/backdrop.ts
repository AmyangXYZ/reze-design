// Backdrop media (an image or a video behind the 3D scene) + the shared
// cover-fit math.

/** Video files the backdrop slot accepts. Named, not `video/*`: the picker
 *  should not offer a codec the browser cannot decode into a frame. */
export const BACKDROP_VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i
/** Formats that MAY be animated, and which ImageDecoder can step. Which of
 *  them actually is, only the file says — a .webp is usually a still and a
 *  .png is usually not an APNG, so this selects who gets asked, not who is. */
export const BACKDROP_ANIMATED_RE = /\.(gif|webp|png|apng)$/i

/**
 * How this backdrop produces a frame, which is the only thing the three kinds
 * disagree about.
 *
 * An animated image is a still to the DOM and an animation to the export — it
 * already moved in the live layer long before anything decoded it, because an
 * <img> runs it on its own. What it never did was reach the file: drawImage
 * takes frame one, and a whole export got a frozen backdrop.
 */
export type BackdropKind = "image" | "video" | "animated"

export type BackdropMedia = {
  /** The original upload (kept for potential re-use/export needs). */
  file: File
  /** Object URL for the live DOM layer. Revoke when replaced/removed. */
  url: string
  name: string
  width: number
  height: number
  kind: BackdropKind
  /** Seconds of animation. Null for a still. */
  duration: number | null
  /** Frames per second, video only — measured, not assumed, so 29.97 is 29.97.
   *  What lets a paused seek land in the MIDDLE of a frame rather than on a
   *  boundary. Null when unknown. */
  fps: number | null
}

/** Source crop rect implementing object-fit: cover — drawImage(src, sx,sy,sw,sh → full dst). */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const sw = dstW / scale
  const sh = dstH / scale
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh }
}

/** Load + inspect an image upload into BackdropMedia. Throws on undecodable files. */
export async function probeBackdrop(file: File): Promise<BackdropMedia> {
  if (BACKDROP_VIDEO_RE.test(file.name)) return probeVideoBackdrop(file)
  if (BACKDROP_ANIMATED_RE.test(file.name)) return probeAnimatedBackdrop(file)
  if (/\.hdr$/i.test(file.name)) {
    // Radiance HDRI: the DOM decoder rejects it, so size it with the engine's
    // parser — which also validates the file at upload time, when an error can
    // still reach the person who picked it. The object URL is kept for slot
    // bookkeeping; nothing DOM-renders it (the 360 slot draws in-canvas).
    const { parseHDR } = await import("reze-engine")
    const img = parseHDR(await file.arrayBuffer())
    return {
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      width: img.width,
      height: img.height,
      kind: "image",
      duration: null,
      fps: null,
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`Can't decode image: ${file.name}`))
      el.src = url
    })
    return { file, url, name: file.name, width: img.naturalWidth, height: img.naturalHeight, kind: "image", duration: null, fps: null }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * Read a video's real dimensions and duration — through the DEMUXER, not a
 * <video> element.
 *
 * Same reasoning as the .hdr branch above: probing with the thing that will
 * actually be used validates the file while the person who picked it is still
 * here to be told. A <video> would report metadata for files the export cannot
 * then decode frame-exactly, and the failure would surface at render time.
 */
async function probeVideoBackdrop(file: File): Promise<BackdropMedia> {
  const { Input, BlobSource, ALL_FORMATS } = await import("mediabunny")
  const url = URL.createObjectURL(file)
  try {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`No video track in ${file.name}`)
    if (!(await track.canDecode())) throw new Error(`This browser can't decode ${file.name}`)
    const duration = await track.computeDuration()
    // MEASURED over the real packets, not assumed: 29.97 has to come back as
    // 29.97, because a rate a per-cent wrong puts the frame index a whole frame
    // out within half a minute. This walks packet metadata, not decoded frames,
    // and computeDuration above has already read to the end.
    const fps = await track
      .computePacketStats()
      .then((st) => (st.averagePacketRate > 0 ? st.averagePacketRate : null))
      .catch(() => null)
    return {
      file,
      url,
      name: file.name,
      width: track.displayWidth,
      height: track.displayHeight,
      kind: "video",
      duration,
      fps,
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * The MIME type for an image file, from the file or from its name.
 *
 * `File.type` is empty often enough to matter: a File rebuilt out of a scene
 * bundle carries only the name it was packed under, and ImageDecoder refuses to
 * construct without a type. Falling back to the extension is what keeps a
 * restored gif animating like the one that was just uploaded.
 */
export function imageMimeFor(file: File): string {
  if (file.type) return file.type
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase()
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  if (ext === "png" || ext === "apng") return "image/png"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  return ""
}

/**
 * Open an animated image for stepping, with its track metadata ready.
 *
 * TRACKS.READY, NOT COMPLETED — the distinction cost a whole feature. `completed`
 * resolves once the encoded data is BUFFERED, which for a whole ArrayBuffer is
 * essentially immediate and says nothing about parsing. Reading
 * `tracks.selectedTrack` there gets null, `frameCount` defaults to 1, and every
 * gif and animated webp is classified a still: the <img> keeps animating on the
 * browser's own clock (so it looks fine, and ignores the transport) while the
 * export writes one frozen frame. `tracks.ready` is the promise that the track
 * list has actually been read.
 *
 * Returns null when this browser or this file cannot be stepped, which is the
 * signal to use the still path — the one that already draws it correctly.
 */
export async function openAnimatedImage(file: File): Promise<{ dec: ImageDecoder; frames: number } | null> {
  const Decoder = (globalThis as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder
  const type = imageMimeFor(file)
  if (!Decoder || !type) return null
  let dec: ImageDecoder | null = null
  try {
    dec = new Decoder({ data: await file.arrayBuffer(), type })
    await dec.tracks.ready
    const frames = dec.tracks.selectedTrack?.frameCount ?? 1
    if (frames < 2) {
      dec.close()
      return null
    }
    return { dec, frames }
  } catch {
    // Not a format this decoder handles. The still path already draws it.
    dec?.close()
    return null
  }
}

/**
 * An image that might move: sized by the DOM, counted by WebCodecs.
 *
 * The <img> layer needs nothing from this — it has animated since the day the
 * slot accepted one. The count decides whether the EXPORT steps it or treats it
 * as the still it usually is.
 */
async function probeAnimatedBackdrop(file: File): Promise<BackdropMedia> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`Can't decode image: ${file.name}`))
      el.src = url
    })
    // Opened only to be counted, then closed: the export and the live layer
    // each open their own, and holding a decoder from upload to render would
    // keep the whole file decoded for a scene nobody has played yet.
    const animated = await openAnimatedImage(file)
    animated?.dec.close()
    return {
      file,
      url,
      name: file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
      // One frame — or nothing able to step it — is a still, and the still path
      // is the one that already works.
      kind: animated ? "animated" : "image",
      duration: null,
      fps: null,
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export function releaseBackdrop(b: BackdropMedia | null) {
  if (b) URL.revokeObjectURL(b.url)
}
