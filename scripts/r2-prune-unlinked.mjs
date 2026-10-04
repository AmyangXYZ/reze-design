// Delete scene bundles and covers nothing links to any more.
//
//   node --env-file=.env.local scripts/r2-prune-unlinked.mjs            # dry run
//   node --env-file=.env.local scripts/r2-prune-unlinked.mjs --write
//
// DRY RUN by default: it lists what it would delete, and why each kept thing is
// kept.
//
// Only `scenes/` and `b/` — what publishing writes. A key is LINKED, and kept,
// when any library_items row (soft-deleted ones too: a deleted scene can be
// restored) names it as its bundle_key or poster_key, or when it appears
// anywhere in any row's stored document (a scene may load a file by its public
// URL). Everything else under those two prefixes is a replaced bundle, a
// superseded cover, or an abandoned upload, and goes.
//
// `demo/` is never touched: it serves every site's landing demo, and which of
// those still read a file is not something this database knows.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

neonConfig.webSocketConstructor = ws
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, DATABASE_URL } = process.env
const WRITE = process.argv.includes("--write")
const PREFIXES = ["scenes/", "b/"]

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

const pool = new Pool({ connectionString: DATABASE_URL })
const { rows } = await pool.query(`SELECT id, bundle_key, poster_key, payload::text AS doc FROM library_items`)
await pool.end()
const keep = new Set()
for (const r of rows) {
  if (r.bundle_key) keep.add(r.bundle_key)
  if (r.poster_key) keep.add(r.poster_key)
}
const docs = rows.map((r) => r.doc ?? "").join("\n")

const objects = []
for (const prefix of PREFIXES) {
  let token
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token }))
    for (const o of r.Contents ?? []) objects.push({ key: o.Key, size: o.Size })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
}

const gone = objects.filter((o) => !keep.has(o.key) && !docs.includes(o.key))
const kept = objects.length - gone.length
const mb = (n) => (n / 1e6).toFixed(1)
const total = (list) => list.reduce((a, o) => a + o.size, 0)
console.log(`${rows.length} library rows; ${keep.size} keys named by a row`)
console.log(`${objects.length} objects under ${PREFIXES.join(", ")}: ${kept} linked (${mb(total(objects) - total(gone))} MB), ${gone.length} unlinked (${mb(total(gone))} MB)`)
for (const o of gone.slice(0, 40)) console.log(`  - ${o.key}  ${mb(o.size)} MB`)
if (gone.length > 40) console.log(`  … and ${gone.length - 40} more`)

if (!WRITE) {
  console.log("\ndry run — pass --write to delete")
  process.exit(0)
}
for (let i = 0; i < gone.length; i += 1000) {
  const batch = gone.slice(i, i + 1000)
  const r = await s3.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET, Delete: { Objects: batch.map((o) => ({ Key: o.key })) } }))
  if (r.Errors?.length) console.log("  errors:", r.Errors.map((e) => `${e.Key}: ${e.Message}`).join("; "))
}
console.log(`deleted ${gone.length} objects, ${mb(total(gone))} MB`)
