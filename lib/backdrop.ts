// Backdrop media (a static image behind the 3D scene) + the shared cover-fit
// math. The SAME coverCrop() drives the live DOM layer (object-fit: cover
// equivalent) and the export composite's drawImage — so what you see is exactly
// what renders. (Video backdrops were removed: a DOM <video> layer couldn't be
// made reliably smooth; if they return it will be via an engine-rendered path.)

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
