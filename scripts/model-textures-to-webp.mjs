// A model folder's textures as WebP, and its .pmx pointed at them.
//
//   node scripts/model-textures-to-webp.mjs <dir>            # dry run
//   node scripts/model-textures-to-webp.mjs <dir> --write
//
// The offline twin of lib/texture-webp.ts, which does this to every upload. The
// demo model predates that pipeline and still ships 16MB of PNG, which every
// first-time visitor downloads before the scene can appear — and a private
// window, having no cache to spare it, downloads on every open.
//
// WHAT IS DIFFERENT HERE, and why this is not the browser's code path: a 2D
// canvas premultiplies, so the browser must leave any texture with real
// transparency alone or lose the colour under it. sharp has no such problem, so
// a texture whose alpha actually varies converts too — as LOSSLESS, because
// lossy WebP is free to rewrite the colour under a transparent pixel and that
// is what frays a matte edge.
//
// A file that grows keeps its PNG. Flat colour and small palettes are what PNG
// is good at, and a 256px ramp often comes back bigger.
//
// The error is measured, not asserted: every file reports the PSNR and the
// worst single-channel difference against what the GPU would have sampled from
// the original, so "no visible difference" is a number in the output.
import sharp from "sharp"
import { readdir, readFile, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { readPmxDocument, writePmxDocument } from "reze-engine"

const WRITE = process.argv.includes("--write")
const DIR = process.argv.slice(2).find((a) => !a.startsWith("--"))
if (!DIR) {
  console.error("usage: node scripts/model-textures-to-webp.mjs <dir> [--write]")
  process.exit(2)
}

const QUALITY = 90
const CONVERT = /\.(png|tga|bmp)$/i
/** Under this the encoder's overhead is the whole file. */
const FLOOR = 4096

/** Every file under the folder, with its path relative to it. */
async function walk(dir, base = "") {
  const out = []
  for (const e of await readdir(join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(dir, rel)))
    else out.push(rel)
  }
  return out
}

/** 8-bit RGBA — what the GPU samples, whatever the file said. */
const raw = (buf) => sharp(buf).ensureAlpha().raw().toBuffer()

const files = await walk(DIR)
const renamed = new Map()
let before = 0
let after = 0

for (const rel of files.filter((f) => CONVERT.test(f)).sort()) {
  const src = join(DIR, rel)
  const png = await readFile(src)
  if (png.length <= FLOOR) continue
  const stats = await sharp(png).stats()
  const alpha = stats.channels[3]
  // Constant alpha is padding, not transparency.
  const varies = !!alpha && alpha.min !== alpha.max
  const out = varies
    ? await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer()
    : await sharp(png).webp({ quality: QUALITY, alphaQuality: 100, effort: 6 }).toBuffer()

  before += png.length
  if (out.length >= png.length) {
    after += png.length
    console.log(`${rel.padEnd(34)} kept — WebP was ${(out.length / png.length).toFixed(2)}×`)
    continue
  }

  // OVER THE PIXELS ANYTHING CAN SAMPLE. libwebp discards the colour under a
  // fully transparent pixel unless cwebp's `-exact` is passed, which sharp does
  // not expose — measured on the demo's eye texture, that is 324,538 pixels at
  // alpha 0 rewritten, while every partially transparent pixel, every opaque
  // pixel and the whole alpha channel came back bit-identical. Colour under
  // alpha 0 contributes nothing to an alpha blend, so it is counted and named
  // rather than folded into an error figure it would dominate.
  const [a, b] = [await raw(png), await raw(out)]
  let sum = 0
  let worst = 0
  let dropped = 0
  let seen = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) {
      for (let c = 0; c < 3; c++) if (a[i + c] !== b[i + c]) { dropped++; break }
      continue
    }
    seen++
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[i + c] - b[i + c])
      sum += d * d
      if (d > worst) worst = d
    }
  }
  const mse = sum / Math.max(1, seen * 4)
  const psnr = mse === 0 ? "exact" : `${(10 * Math.log10((255 * 255) / mse)).toFixed(1)}dB`

  after += out.length
  const to = rel.replace(/\.[^./]+$/, ".webp")
  renamed.set((rel.split("/").pop() ?? rel).toLowerCase(), to.split("/").pop())
  console.log(
    `${rel.padEnd(34)} ${(png.length / 1048576).toFixed(2)} → ${(out.length / 1048576).toFixed(2)}MB` +
      `  −${(((1 - out.length / png.length) * 100) | 0)}%`.padEnd(7) +
      `  ${varies ? "lossless" : `q${QUALITY}`}`.padEnd(11) +
      `  visible PSNR ${psnr} worst±${worst}` +
      (dropped ? `  (+${dropped} px recoloured under alpha 0)` : ""),
  )
  if (WRITE) {
    await writeFile(join(DIR, to), out)
    await unlink(src)
  }
}

// The .pmx NAMES its textures, so the table follows them. Whole or not at all:
// a model with half its table rewritten is a model with half its textures.
for (const rel of files.filter((f) => /\.pmx$/i.test(f))) {
  const buf = await readFile(join(DIR, rel))
  const doc = readPmxDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  let touched = 0
  doc.textures = doc.textures.map((t) => {
    const base = (t.replace(/\\/g, "/").split("/").pop() ?? t).toLowerCase()
    const to = renamed.get(base)
    if (!to) return t
    touched++
    return t.replace(/[^/\\]+$/, to)
  })
  console.log(`\n${rel}: ${touched}/${doc.textures.length} texture paths rewritten`)
  if (WRITE && touched) await writeFile(join(DIR, rel), Buffer.from(writePmxDocument(doc)))
}

console.log(
  `\ntotal ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB` +
    `  (−${(((1 - after / before) * 100) | 0)}%)` +
    (WRITE ? "" : "   — dry run, nothing written; pass --write"),
)
