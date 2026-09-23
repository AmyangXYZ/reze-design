// Delete cover objects nothing points at any more.
//
//   node --env-file=.env.local scripts/r2-prune-posters.mjs
//   … --write
//
// DRY RUN by default.
//
// db-webp-posters.mjs re-encodes a cover to a NEW key — `poster.png` becomes
// `poster.webp` beside it — because everything in this bucket carries a
// one-year immutable header and an overwritten key keeps serving the old bytes
// from the edge. That is the right way round, and it leaves the originals
// behind once the row has moved on. This is the second half.
//
// WHAT IT KEEPS is decided by the database, never by the file name: every
// `poster_key` any row holds, INCLUDING soft-deleted rows. A deleted scene can
// be restored, and restoring one to a missing cover would be this script's
// doing. Everything else under `scenes/` that is named like a cover goes.
//
// It never touches `assets.zip`. A superseded BUNDLE is the rollback for a
// conversion that has not been looked at yet, which is a judgement about what
// has been verified rather than a fact about what is referenced — so bundles
// are left for a human to decide about.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

neonConfig.webSocketConstructor = ws

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, DATABASE_URL } = process.env
const WRITE = process.argv.includes("--write")
for (const [k, v] of Object.entries({ DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET }))
  if (!v) throw new Error(`${k} is not set — run with --env-file=.env.local`)

/** A cover, by the name the upload route gives one. */
const IS_POSTER = /\/poster\.[^/]+$/
const MB = (n) => (n / 1048576).toFixed(1)

const pool = new Pool({ connectionString: DATABASE_URL })
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

// No deleted_at filter, deliberately — see the header.
const { rows } = await pool.query(`SELECT poster_key FROM library_items WHERE poster_key IS NOT NULL`)
const keep = new Set(rows.map((r) => r.poster_key))
console.log(`${keep.size} cover(s) referenced by a row`)

const doomed = []
let seen = 0
let token
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: "scenes/", ContinuationToken: token }))
  for (const o of page.Contents ?? []) {
    if (!IS_POSTER.test(o.Key)) continue
    seen++
    if (!keep.has(o.Key)) doomed.push({ Key: o.Key, size: o.Size ?? 0 })
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined
} while (token)

const bytes = doomed.reduce((n, d) => n + d.size, 0)
console.log(`${seen} cover object(s) in the bucket · ${doomed.length} unreferenced · ${MB(bytes)}MB`)
for (const d of doomed.slice(0, 10)) console.log(`  ${d.Key}  ${MB(d.size)}MB`)
if (doomed.length > 10) console.log(`  … and ${doomed.length - 10} more`)

if (!WRITE) {
  console.log("\n— dry run, nothing deleted; pass --write")
  await pool.end()
  process.exit(0)
}

// A thousand keys per call is the API's limit.
for (let i = 0; i < doomed.length; i += 1000) {
  const batch = doomed.slice(i, i + 1000)
  const res = await s3.send(
    new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: batch.map(({ Key }) => ({ Key })) } }),
  )
  for (const e of res.Errors ?? []) console.error(`  ✗ ${e.Key}: ${e.Message}`)
  console.log(`deleted ${Math.min(i + 1000, doomed.length)}/${doomed.length}`)
}
console.log(`\n${doomed.length} cover(s) deleted · ${MB(bytes)}MB freed`)
await pool.end()
