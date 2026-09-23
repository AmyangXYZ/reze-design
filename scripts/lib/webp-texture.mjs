// One texture as WebP, offline, measured.
//
// The shared half of scripts/model-textures-to-webp.mjs and
// scripts/db-webp-published-scenes.mjs, so a folder on disk and a published
// bundle are converted by the same rules rather than by two drifting copies.
//
// HOW THIS DIFFERS FROM lib/texture-webp.ts, deliberately: the browser draws
// through a 2D canvas, which premultiplies, so it must leave any texture with
// real transparency alone or lose the colour underneath. sharp does not
// premultiply, so those convert here — as LOSSLESS, because lossy WebP is free
// to rewrite the colour under a transparent pixel and that is what frays a
// matte edge.
//
// libwebp drops colour under alpha EXACTLY 0 whatever the mode (cwebp's
// `-exact` disables it; sharp does not expose the flag). Nothing can sample it
// through an alpha blend, so it is counted and named rather than folded into an
// error figure it would dominate.
//
// NOTHING HERE MAY COST SOMEONE THEIR MODEL. An encoder that refuses a file —
// and sharp has no TGA decoder at all, where the browser has lib/tga.ts — is a
// texture left exactly as it was.

import sharp from "sharp"

/** What is worth converting. TGA is listed because it is worth REPORTING: it is
 *  the format with the most to gain and the one sharp cannot read. */
export const CONVERT = /\.(png|tga|bmp)$/i
/** Under this, the encoder's overhead is the whole file. */
export const FLOOR = 4096
export const QUALITY = 90

/** 8-bit RGBA — what the GPU samples, whatever the file said. */
const raw = (buf) => sharp(buf).ensureAlpha().raw().toBuffer()

/**
 * @returns `{ out, mode, psnr, worst, dropped }` when it is worth replacing,
 *          or `{ kept: <reason> }` when the original stands.
 */
export async function toWebp(bytes, name) {
  if (bytes.length <= FLOOR) return { kept: "small" }
  let stats
  try {
    stats = await sharp(bytes).stats()
  } catch {
    // sharp cannot read it. TGA is the whole of this case in practice.
    return { kept: /\.tga$/i.test(name) ? "tga (sharp has no decoder)" : "unreadable" }
  }

  const alpha = stats.channels[3]
  // Constant alpha is padding, not transparency.
  const varies = !!alpha && alpha.min !== alpha.max

  let out
  try {
    out = varies
      ? await sharp(bytes).webp({ lossless: true, effort: 6 }).toBuffer()
      : await sharp(bytes).webp({ quality: QUALITY, alphaQuality: 100, effort: 6 }).toBuffer()
  } catch {
    return { kept: "encoder refused it" }
  }
  // Flat colour and small palettes are what PNG is good at; a stand-in map or a
  // 64px ramp often comes back bigger. The comparison is per file.
  if (out.length >= bytes.length) return { kept: `WebP was ${(out.length / bytes.length).toFixed(2)}×` }

  let sum = 0
  let worst = 0
  let dropped = 0
  let seen = 0
  try {
    const [a, b] = [await raw(bytes), await raw(out)]
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0) {
        for (let c = 0; c < 3; c++)
          if (a[i + c] !== b[i + c]) {
            dropped++
            break
          }
        continue
      }
      seen++
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a[i + c] - b[i + c])
        sum += d * d
        if (d > worst) worst = d
      }
    }
  } catch {
    return { kept: "could not be verified" }
  }
  const mse = sum / Math.max(1, seen * 4)
  return {
    out,
    mode: varies ? "lossless" : `q${QUALITY}`,
    psnr: mse === 0 ? "exact" : `${(10 * Math.log10((255 * 255) / mse)).toFixed(1)}dB`,
    worst,
    dropped,
  }
}

/**
 * A .pmx's texture table, pointed at what now exists.
 *
 * WHOLE OR NOT AT ALL: a model with half its table rewritten is a model with
 * half its textures. Matched on basename because a table writes its paths the
 * way MMD does, with backslashes and whatever prefix the author's folder had.
 *
 * @param renamed old basename (lower-case) -> new basename
 * @returns how many entries moved
 */
export function retargetTextures(doc, renamed) {
  let touched = 0
  doc.textures = doc.textures.map((t) => {
    const base = (t.replace(/\\/g, "/").split("/").pop() ?? t).toLowerCase()
    const to = renamed.get(base)
    if (!to) return t
    touched++
    return t.replace(/[^/\\]+$/, to)
  })
  return touched
}
