// Whether a texture can survive a trip through a 2D canvas.
//
// A 2D CANVAS BACKING STORE IS PREMULTIPLIED. Drawing a pixel whose alpha is
// zero stores (0,0,0,0), and reading it back divides by that zero: the colour
// is gone, unrecoverably. For most textures this is harmless, because colour
// under no alpha is colour nobody sees.
//
// It is not harmless for an ADDITIVE layer, where alpha means nothing and the
// whole picture lives in RGB. X309's night sky is three of them — a nebula,
// twinkling stars, a purple band over the sea — with alpha 0.00 across the
// entire image and the starfield in the colour channels. Re-encoded through a
// canvas they came out pure black, and the beach lost its sky.
//
// So a texture is converted only when it is opaque everywhere. That costs
// almost nothing: measured over X309, X323 and X340, fully opaque images are
// 90–95% of all texture bytes.

/** Whether the file format even has an alpha channel — a header read, so the
 *  common case never pays for the pixel scan below. */
export function declaresAlpha(buffer: ArrayBuffer, path: string): boolean {
  const b = new Uint8Array(buffer)
  // PNG: IHDR colour type at byte 25. 4 is grey+alpha, 6 is RGBA.
  if (/\.png$/i.test(path)) return b.length > 25 && (b[25] === 4 || b[25] === 6)
  // TGA: bits per pixel at 16, and the low nibble of the descriptor at 17 is
  // how many of them are alpha.
  if (/\.tga$/i.test(path)) return b.length > 17 && (b[16] === 32 || (b[17] & 0x0f) > 0)
  // BMP: the bit count in BITMAPINFOHEADER, at 28.
  if (/\.bmp$/i.test(path)) return b.length > 29 && (b[28] | (b[29] << 8)) === 32
  return true
}

/** Whether every pixel is fully opaque. Alpha itself comes back intact — it is
 *  the colour beneath it that premultiplication destroys — so this is a safe
 *  question to ask of a canvas that has already been drawn to. */
export function opaqueEverywhere(c2d: OffscreenCanvasRenderingContext2D, width: number, height: number): boolean {
  const data = c2d.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false
  return true
}
