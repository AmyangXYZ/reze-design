// A scene's cover, on the way to the bucket.
//
// The gallery is a grid of these and they arrive as whatever the author's
// screenshot tool produced — a Retina PNG is routinely past 10MB, and the card
// it fills is a few hundred pixels wide. That weight is paid on every gallery
// open by everyone, which makes it the one image on this site worth compressing
// hardest.
//
// WebP at q82 and a 3840px long edge: 4K, which the gallery's spotlight needs —
// it lays a cover across the whole page, near 3000 device pixels on a Retina
// laptop, and a 1920 cover read soft there. WebP keeps even 4K small.
//
// LOSSY IS RIGHT HERE, where it is wrong for a texture: nothing samples a cover,
// nothing lights from it, and no shader reads its alpha. It is a picture of a
// picture. Textures go through lib/texture-webp.ts, which is a different set of
// rules for a different job.
//
// NOTHING HERE MAY COST SOMEONE THEIR PUBLISH. Every failure — no
// OffscreenCanvas, a decoder that refuses the file, an encoder that returns
// something bigger — hands back the file that was picked. The worst outcome is
// a heavier cover.

/** What the gallery's spotlight can use. Beyond this is detail nobody sees. */
const MAX_EDGE = 3840
const QUALITY = 0.82

export async function posterToWebp(file: File): Promise<File> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const c2d = canvas.getContext("2d")
    if (!c2d) {
      bitmap.close()
      return file
    }
    // A cover is opaque — a screenshot of the canvas — so the premultiply that
    // makes this unsafe for textures has nothing to destroy here.
    c2d.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: QUALITY })
    // A small picture can come back bigger, and an author's JPEG may already be
    // tighter than anything re-encoding it will produce.
    if (blob.size >= file.size && scale === 1) return file
    return new File([blob], file.name.replace(/\.[^./]+$/, "") + ".webp", { type: "image/webp" })
  } catch {
    return file
  }
}
