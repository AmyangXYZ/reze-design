// Backdrop media (a static image behind the 3D scene) + the shared cover-fit math.

export type BackdropMedia = {
  /** The original upload (kept for potential re-use/export needs). */
  file: File
  /** Object URL for the live DOM layer. Revoke when replaced/removed. */
  url: string
  name: string
  width: number
  height: number
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
  if (/\.hdr$/i.test(file.name)) {
    // Radiance HDRI: the DOM decoder rejects it, so size it with the engine's
    // parser — which also validates the file at upload time, when an error can
    // still reach the person who picked it. The object URL is kept for slot
    // bookkeeping; nothing DOM-renders it (the 360 slot draws in-canvas).
    const { parseHDR } = await import("reze-engine")
    const img = parseHDR(await file.arrayBuffer())
    return { file, url: URL.createObjectURL(file), name: file.name, width: img.width, height: img.height }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(`Can't decode image: ${file.name}`))
      el.src = url
    })
    return { file, url, name: file.name, width: img.naturalWidth, height: img.naturalHeight }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

export function releaseBackdrop(b: BackdropMedia | null) {
  if (b) URL.revokeObjectURL(b.url)
}
