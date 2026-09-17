// Sky panoramas that ship inside a stage folder, offered when the stage loads.
//
// A stage package often carries skies beside the model and names none of them —
// the x348 wedding stage brings 75 of its game's panoramas — so which one
// belongs is the user's call. Candidates are found from file headers alone: an
// equirect still is exactly 2:1. The stage's own textures and channel-packed
// maps (_M, _M_L, _N) are left out, and one file copied into several folders is
// offered once.

import { relFilePath } from "@/lib/scene-files"
import { decodeTga } from "@/lib/tga"

export type SkyCandidate = { file: File; path: string; name: string }

const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1)

async function headerSize(file: File): Promise<{ width: number; height: number } | null> {
  const ext = file.name.toLowerCase().split(".").pop()
  if (ext === "tga") {
    const b = new Uint8Array(await file.slice(0, 18).arrayBuffer())
    if (b.length < 18 || ![2, 3, 10, 11].includes(b[2])) return null
    return { width: b[12] | (b[13] << 8), height: b[14] | (b[15] << 8) }
  }
  if (ext === "png") {
    const v = new DataView(await file.slice(0, 24).arrayBuffer())
    if (v.byteLength < 24 || v.getUint32(0) !== 0x89504e47) return null
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (ext === "bmp") {
    const v = new DataView(await file.slice(0, 26).arrayBuffer())
    if (v.byteLength < 26 || v.getUint16(0) !== 0x424d) return null
    return { width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)) }
  }
  if (ext === "jpg" || ext === "jpeg") {
    // The frame header follows whatever metadata precedes it; walk the markers.
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
    for (let at = 2; at + 9 < v.byteLength; ) {
      if (v.getUint8(at) !== 0xff) return null
      const marker = v.getUint8(at + 1)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return { width: v.getUint16(at + 7), height: v.getUint16(at + 5) }
      at += 2 + v.getUint16(at + 2)
    }
  }
  return null
}

/**
 * The panoramas in an upload, by name.
 *
 * `stageTextures` are the file names the stage's own materials use, lower-case:
 * a texture on the set is not a sky, whatever its shape.
 */
export async function findSkies(files: File[], stageTextures: Set<string>): Promise<SkyCandidate[]> {
  const seen = new Set<string>()
  const picked = files.filter((f) => {
    const name = baseOf(relFilePath(f))
    if (!/\.(tga|png|jpe?g|bmp)$/i.test(name)) return false
    if (/_(m|m_l|n|l)\.[^.]+$/i.test(name)) return false
    if (stageTextures.has(name.toLowerCase())) return false
    const key = `${name.toLowerCase()}:${f.size}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const sizes = await Promise.all(picked.map((f) => headerSize(f).catch(() => null)))
  return picked
    .filter((_, i) => {
      const s = sizes[i]
      return s !== null && s.width >= 1024 && s.width === s.height * 2
    })
    .map((file) => ({ file, path: relFilePath(file), name: baseOf(relFilePath(file)).replace(/\.[^.]+$/, "") }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** A small PNG of a sky, as an object URL the caller revokes. */
export async function skyThumbnail(file: File, width: number): Promise<string> {
  const resize = { resizeWidth: width, resizeHeight: Math.round(width / 2), resizeQuality: "medium" } as const
  let bitmap: ImageBitmap
  if (/\.tga$/i.test(file.name)) {
    const img = decodeTga(await file.arrayBuffer())
    bitmap = await createImageBitmap(new ImageData(img.data, img.width, img.height), resize)
  } else {
    bitmap = await createImageBitmap(file, resize)
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }))
}
