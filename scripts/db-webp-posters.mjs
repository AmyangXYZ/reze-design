// Re-encode published covers as WebP, in place of the screenshots they were.
//
//   node --env-file=.env.local scripts/db-webp-posters.mjs
//   … --only KLyKGk        one item, by id
//   … --write              actually do it
//
// DRY RUN by default.
//
// The offline twin of lib/poster.ts, which does this to every cover chosen from
// now on. The gallery is a grid of covers and its weight is paid on every open
// by everyone, so this is the one image on the site worth compressing hardest —
// a Retina screenshot is routinely past 10MB and the card it fills is a few
// hundred pixels wide.
//
// EVERY ITEM WITH A COVER, private ones included, unlike the bundle sweep. A
// bundle is someone's work and a private scene is their unfinished copy; a cover
// is a thumbnail, its owner waits on it in their own shelf, and re-encoding one
// changes nothing about the scene it belongs to.
//
// A NEW KEY, NEVER AN OVERWRITE — covers carry the same one-year immutable
// header as everything else in the bucket, so `poster.png` becomes `poster.webp`
// beside it and the old object stays where it is. A cover already named .webp is
// left alone, which is also what makes this safe to run twice.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import sharp from "sharp"

neonConfig.webSocketConstructor = ws

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, DATABASE_URL } = process.env
const WRITE = process.argv.includes("--write")
const argOf = (n) => {
  const i = process.argv.indexOf(n)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}
const ONLY = argOf("--only")

for (const [k, v] of Object.entries({ DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL }))
  if (!v) throw new Error(`${k} is not set — run with --env-file=.env.local`)

// Kept in step with lib/poster.ts by hand — a cover converted here and a cover
// converted in the browser should be the same picture.
const MAX_EDGE = 1920
const QUALITY = 82
// Kept in step with app/api/upload/route.ts by hand — one string.
const IMMUTABLE = "public, max-age=31536000, immutable"
const KB = (n) => (n / 1024).toFixed(0)

const pool = new Pool({ connectionString: DATABASE_URL })
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const { rows } = await pool.query(
  `SELECT id, name, author, poster_key, visibility
     FROM library_items
    WHERE poster_key IS NOT NULL AND deleted_at IS NULL
      ${ONLY ? "AND id = $1" : ""}
    ORDER BY created_at DESC`,
  ONLY ? [ONLY] : [],
)

let before = 0
let after = 0
let done = 0
let skipped = 0
for (const row of rows) {
  const label = `${row.id} "${row.name}" by ${row.author}`
  if (/\.webp$/i.test(row.poster_key)) {
    skipped++
    continue
  }
  try {
    const res = await fetch(`${R2_PUBLIC_BASE_URL}/${row.poster_key}`)
    if (!res.ok) throw new Error(`cover ${res.status}`)
    const src = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(src).metadata()
    const out = await sharp(src)
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer()
    if (out.length >= src.length && Math.max(meta.width, meta.height) <= MAX_EDGE) {
      console.log(`${label} — kept, WebP was ${(out.length / src.length).toFixed(2)}×`)
      skipped++
      continue
    }
    const next = await sharp(out).metadata()
    before += src.length
    after += out.length
    done++
    console.log(
      `${label}\n  ${KB(src.length)} → ${KB(out.length)}KB  (−${Math.round((1 - out.length / src.length) * 100)}%)` +
        `  ${meta.width}×${meta.height} → ${next.width}×${next.height}  [${row.visibility}]`,
    )
    if (!WRITE) continue

    const key = row.poster_key.replace(/\.[^./]+$/, ".webp")
    await s3.send(
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: out, ContentType: "image/webp", CacheControl: IMMUTABLE }),
    )
    await pool.query(`UPDATE library_items SET poster_key = $1 WHERE id = $2`, [key, row.id])
    console.log(`  ✓ ${key}  (was ${row.poster_key}, still in the bucket)`)
  } catch (e) {
    // One cover short, never the run.
    console.error(`${label} — left as it was: ${e.message}`)
  }
}

console.log(
  `\n${done} cover(s) ${WRITE ? "rewritten" : "would be rewritten"}, ${skipped} left alone` +
    (done ? ` · ${KB(before)} → ${KB(after)}KB (−${Math.round((1 - after / before) * 100)}%)` : "") +
    (WRITE ? "" : "   — dry run, nothing written; pass --write"),
)
await pool.end()
