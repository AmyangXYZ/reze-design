// Backdrop media (a static image or a video behind the 3D scene) + the shared
// cover-fit math. The SAME coverRect() drives the live CSS layer (object-fit:
// cover equivalent) and the export composite's drawImage — so what you see is
// exactly what renders. The original File is kept on the object: the export
// pipeline demuxes it (frame-accurate decode + its audio track) via mediabunny.

import { ALL_FORMATS, BlobSource, Input } from "mediabunny"

export type BackdropMedia = {
  kind: "image" | "video"
  /** The original upload — export demuxes this (BlobSource). */
  file: File
  /** Object URL for the live DOM layer. Revoke when replaced/removed. */
  url: string
  name: string
  width: number
  height: number
  /** Video only: duration in seconds (loops when shorter than the clip). */
  duration: number
  /** Video only: whether it carries an audio track (drives the export audio picker). */
  hasAudio: boolean
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

/** Load + inspect an upload into BackdropMedia (dims, duration, audio presence).
 *  Throws on undecodable files; the caller surfaces the message. */
export async function probeBackdrop(file: File): Promise<BackdropMedia> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith("image/")) {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error(`Can't decode image: ${file.name}`))
        el.src = url
      })
      return {
        kind: "image",
        file,
        url,
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
        duration: 0,
        hasAudio: false,
      }
    }

    // Video: dims/duration from a metadata load; audio presence via demux (the
    // <video> element can't report it reliably cross-browser).
    const video = await new Promise<HTMLVideoElement>((resolve, reject) => {
      const el = document.createElement("video")
      el.preload = "metadata"
      el.onloadedmetadata = () => resolve(el)
      el.onerror = () => reject(new Error(`Can't decode video: ${file.name}`))
      el.src = url
    })
    let hasAudio = false
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    try {
      hasAudio = (await input.getPrimaryAudioTrack()) !== null
    } finally {
      input.dispose()
    }
    return {
      kind: "video",
      file,
      url,
      name: file.name,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      hasAudio,
    }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export function releaseBackdrop(b: BackdropMedia | null) {
  if (b) URL.revokeObjectURL(b.url)
}
