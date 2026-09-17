// TGA to RGBA, for the maps MMD stages ship beside their PMX.
//
// Browsers cannot decode TGA, and the engine's decoder serves PMX textures from
// inside the engine. This one covers what material maps are saved as: true
// colour at 24 or 32 bits and 8-bit grayscale, raw or run-length encoded, with
// the origin bit honoured. The output is top-left origin.

export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }

export function decodeTga(buffer: ArrayBuffer): RgbaImage {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 18) throw new Error("TGA too small for its header")
  const idLength = bytes[0]
  const colorMapType = bytes[1]
  const type = bytes[2]
  const width = bytes[12] | (bytes[13] << 8)
  const height = bytes[14] | (bytes[15] << 8)
  const depth = bytes[16]
  const descriptor = bytes[17]
  const rle = type === 10 || type === 11
  const gray = type === 3 || type === 11
  if (!(type === 2 || type === 3 || rle)) throw new Error(`TGA image type ${type} is not supported`)
  if (gray ? depth !== 8 : depth !== 24 && depth !== 32) throw new Error(`TGA depth ${depth} is not supported`)

  const colorMapLength = bytes[5] | (bytes[6] << 8)
  let at = 18 + idLength + (colorMapType === 1 ? colorMapLength * Math.ceil(bytes[7] / 8) : 0)
  const step = depth / 8
  const count = width * height
  const pixels = new Uint8ClampedArray(count * 4)

  const put = (i: number, src: number) => {
    const o = i * 4
    if (gray) {
      pixels[o] = pixels[o + 1] = pixels[o + 2] = bytes[src]
      pixels[o + 3] = 255
    } else {
      pixels[o] = bytes[src + 2]
      pixels[o + 1] = bytes[src + 1]
      pixels[o + 2] = bytes[src]
      pixels[o + 3] = step === 4 ? bytes[src + 3] : 255
    }
  }

  if (!rle) {
    if (at + count * step > bytes.length) throw new Error("TGA pixel data is truncated")
    for (let i = 0; i < count; i++, at += step) put(i, at)
  } else {
    for (let i = 0; i < count; ) {
      const header = bytes[at++]
      const run = (header & 0x7f) + 1
      if (at + (header & 0x80 ? step : run * step) > bytes.length) throw new Error("TGA pixel data is truncated")
      if (header & 0x80) {
        for (let k = 0; k < run && i < count; k++) put(i++, at)
        at += step
      } else {
        for (let k = 0; k < run && i < count; k++, at += step) put(i++, at)
      }
    }
  }

  // Bottom-left origin unless bit 5 says top; right-to-left when bit 4 says so.
  const flipY = (descriptor & 0x20) === 0
  const flipX = (descriptor & 0x10) !== 0
  if (!flipY && !flipX) return { width, height, data: pixels }
  const out = new Uint8ClampedArray(pixels.length)
  const row = width * 4
  for (let y = 0; y < height; y++) {
    const src = (flipY ? height - 1 - y : y) * row
    if (!flipX) {
      out.set(pixels.subarray(src, src + row), y * row)
      continue
    }
    for (let x = 0; x < width; x++) {
      const s = src + (width - 1 - x) * 4
      const d = y * row + x * 4
      out[d] = pixels[s]
      out[d + 1] = pixels[s + 1]
      out[d + 2] = pixels[s + 2]
      out[d + 3] = pixels[s + 3]
    }
  }
  return { width, height, data: out }
}

/** A TGA re-encoded as PNG, which every image path in the browser can decode.
 *  Same name with the extension swapped. */
export async function tgaToPng(file: File): Promise<File> {
  const img = decodeTga(await file.arrayBuffer())
  const canvas = new OffscreenCanvas(img.width, img.height)
  canvas.getContext("2d")!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return new File([blob], file.name.replace(/\.tga$/i, ".png"), { type: "image/png" })
}
