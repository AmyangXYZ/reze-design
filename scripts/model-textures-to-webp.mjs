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
import { readdir, readFile, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { readPmxDocument, writePmxDocument } from "reze-engine"
import { CONVERT, FLOOR, toWebp, retargetTextures } from "./lib/webp-texture.mjs"

const WRITE = process.argv.includes("--write")
const DIR = process.argv.slice(2).find((a) => !a.startsWith("--"))
if (!DIR) {
  console.error("usage: node scripts/model-textures-to-webp.mjs <dir> [--write]")
  process.exit(2)
}

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

const files = await walk(DIR)
const renamed = new Map()
let before = 0
let after = 0

for (const rel of files.filter((f) => CONVERT.test(f)).sort()) {
  const src = join(DIR, rel)
  const bytes = await readFile(src)
  const r = await toWebp(bytes, rel)
  before += bytes.length
  if (r.kept) {
    after += bytes.length
    console.log(`${rel.padEnd(34)} kept — ${r.kept}`)
    continue
  }
  after += r.out.length
  const to = rel.replace(/\.[^./]+$/, ".webp")
  renamed.set((rel.split("/").pop() ?? rel).toLowerCase(), to.split("/").pop())
  console.log(
    `${rel.padEnd(34)} ${(bytes.length / 1048576).toFixed(2)} → ${(r.out.length / 1048576).toFixed(2)}MB` +
      `  −${(((1 - r.out.length / bytes.length) * 100) | 0)}%`.padEnd(7) +
      `  ${r.mode}`.padEnd(11) +
      `  visible PSNR ${r.psnr} worst±${r.worst}` +
      (r.dropped ? `  (+${r.dropped} px recoloured under alpha 0)` : ""),
  )
  if (WRITE) {
    await writeFile(join(DIR, to), r.out)
    await unlink(src)
  }
}

// The .pmx NAMES its textures, so the table follows them. Whole or not at all:
// a model with half its table rewritten is a model with half its textures.
for (const rel of files.filter((f) => /\.pmx$/i.test(f))) {
  const buf = await readFile(join(DIR, rel))
  const doc = readPmxDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const touched = retargetTextures(doc, renamed)
  console.log(`\n${rel}: ${touched}/${doc.textures.length} texture paths rewritten`)
  if (WRITE && touched) await writeFile(join(DIR, rel), Buffer.from(writePmxDocument(doc)))
}

console.log(
  `\ntotal ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB` +
    `  (−${(((1 - after / before) * 100) | 0)}%)` +
    (WRITE ? "" : "   — dry run, nothing written; pass --write"),
)
