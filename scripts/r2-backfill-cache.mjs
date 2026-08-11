// Give already-published objects the cache headers new ones now upload with.
//
//   node --env-file=.env.local scripts/r2-backfill-cache.mjs           # dry run
//   node --env-file=.env.local scripts/r2-backfill-cache.mjs --write
//
// /api/upload signs `CacheControl` into every presigned PUT, so anything
// published from now on is cached by the browser for a year. Everything already
// in the bucket was written without it, and R2 serves those with no cache
// headers at all — which is why opening a scene in the editor after viewing it
// downloaded the same bundle twice, and why every revisit and refresh paid the
// full transfer again.
//
// A published object is immutable (each publish mints a new scene id and a new
// key), so this is metadata-only: same bytes, same key, same content type. R2
// has no in-place metadata edit, so it goes through CopyObject onto itself with
// MetadataDirective REPLACE — which is why ContentType has to be restated, and
// why omitting it would quietly turn every zip into application/octet-stream.
import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env
const WRITE = process.argv.includes("--write")

// Kept in step with app/api/upload/route.ts by hand — two constants, one string.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const contentTypeFor = (key) => {
  if (key.endsWith(".zip")) return "application/zip"
  if (key.endsWith(".png")) return "image/png"
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg"
  return "image/webp"
}

// Only what publish writes. A prefix rather than the whole bucket, so a stray
// object someone put there by hand is never rewritten by this.
const objects = []
let token
do {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "scenes/", ContinuationToken: token }),
  )
  for (const o of page.Contents ?? []) objects.push(o)
  token = page.IsTruncated ? page.NextContinuationToken : undefined
} while (token)

console.log(`scenes/: ${objects.length} object(s)`)

const stale = []
for (const o of objects) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: o.Key }))
  if (head.CacheControl !== IMMUTABLE_CACHE_CONTROL) stale.push({ key: o.Key, size: o.Size, had: head.CacheControl })
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`
console.log(`\n${WRITE ? "APPLYING" : "DRY RUN"} — objects missing the header: ${stale.length}\n`)
for (const s of stale) console.log(`  ${s.key}  ${mb(s.size)}  ${s.had ? `(has "${s.had}")` : "(none)"}`)

if (!stale.length) {
  console.log(`\nnothing to do — every object already carries it`)
  process.exit(0)
}
if (!WRITE) {
  console.log(`\nnothing written — re-run with --write`)
  process.exit(0)
}

let done = 0
for (const s of stale) {
  await s3.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: s.key,
      CopySource: `${R2_BUCKET}/${s.key}`,
      MetadataDirective: "REPLACE",
      CacheControl: IMMUTABLE_CACHE_CONTROL,
      ContentType: contentTypeFor(s.key),
    }),
  )
  done++
  if (done % 10 === 0 || done === stale.length) console.log(`  ${done}/${stale.length}`)
}
console.log(`\nwrote: ${done} object(s) now cached immutably`)
