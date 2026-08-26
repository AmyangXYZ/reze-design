// Publish the demo assets — the model, motion and music a first-time visitor
// lands on — to `demo/<site>/` in the R2 bucket.
//
//   node --env-file=.env.local scripts/r2-upload-demo.mjs <dir> <site>           # dry run
//   node --env-file=.env.local scripts/r2-upload-demo.mjs <dir> <site> --write
//   … --only models/A,x.vmd    only these paths (a folder, or one file)
//   … --skip .onnx,hkx/        drop any path containing one of these
//
// One bucket serves every site, so <site> keeps each one's demo its own: a site
// can change or drop its model without reaching into another's. An asset two
// sites genuinely share belongs under a name of its own rather than in either.
//
// Everything under <dir> is uploaded, and its layout is reproduced under
// `demo/<site>/` verbatim — a PMX names its textures by relative filename, so a
// model and its .png files must stay siblings or the engine resolves them
// against nothing.
//
// Objects are versioned by PATH, which is what lets them carry a one-year
// immutable cache header: rename, never overwrite in place. Overwriting a key
// leaves every browser that already has it serving the old bytes for a year.
import { readFile, stat } from "node:fs/promises"
import { glob } from "node:fs/promises"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env
const WRITE = process.argv.includes("--write")
const [DIR, SITE] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const listArg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? [] : (process.argv[i + 1] ?? "").split(",").filter(Boolean)
}
const ONLY = listArg("--only")
const SKIP = listArg("--skip")

if (!DIR || !SITE) {
  console.error("usage: node --env-file=.env.local scripts/r2-upload-demo.mjs <dir> <site> [--write]")
  process.exit(2)
}

// Kept in step with app/api/upload/route.ts by hand — one string.
const IMMUTABLE = "public, max-age=31536000, immutable"
// Anything not named here still uploads, as application/octet-stream — the MMD
// formats have no registered type anyway and the engine reads them as bytes.
const TYPES = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const root = DIR.replace(/\/+$/, "")
const paths = []
for await (const p of glob(`${root}/**/*`)) {
  // macOS hands back decomposed filenames (NFD) while git stores and source
  // code spells them composed (NFC). R2 keys are byte-exact, so a Hangul or
  // kana name uploaded as read from disk would never match the URL the app
  // asks for.
  const rel = p.slice(root.length + 1).normalize("NFC")
  // Dotfiles are the tool droppings — .DS_Store rides along in every folder.
  if (rel.split("/").some((seg) => seg.startsWith("."))) continue
  // Match a whole path segment, so `models/A` never sweeps in `models/A2`.
  if (ONLY.length && !ONLY.some((o) => rel === o || rel.startsWith(`${o}/`))) continue
  if (SKIP.some((x) => rel.includes(x))) continue
  paths.push(p)
}
paths.sort()

let total = 0
let n = 0
for (const path of paths) {
  // The glob yields directories too, and only a stat tells them apart now that
  // an unknown extension is uploaded rather than skipped.
  if (!(await stat(path)).isFile()) continue
  const type = TYPES[path.slice(path.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream"
  const body = await readFile(path)
  const key = `demo/${SITE}/${path.slice(root.length + 1).normalize("NFC")}`
  total += body.byteLength
  n++
  if (!WRITE) {
    console.log(`   ${(body.byteLength / 1e6).toFixed(2).padStart(6)} MB  ${key}`)
    continue
  }
  await s3.send(
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: type, CacheControl: IMMUTABLE }),
  )
  console.log(`✓  ${(body.byteLength / 1e6).toFixed(2).padStart(6)} MB  ${key}`)
}
console.log(`\n${n} files, ${(total / 1e6).toFixed(1)} MB ${WRITE ? "uploaded" : "(dry run — pass --write)"}`)
console.log(`base: ${R2_PUBLIC_BASE_URL}/demo/${SITE}/`)
