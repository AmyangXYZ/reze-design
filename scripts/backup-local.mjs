// A local backup of production: every database table as JSON, and every R2
// object as a file.
//
//   node --env-file=.env.local scripts/backup-local.mjs <dir>
//     (e.g. D:/reze-backup/2026-10-04)
//
// <dir>/db/<table>.json — every row of every table in the public schema (the
// app's and the auth tables), as the driver returns them. Restore by inserting
// them into a schema the app's own migrations created.
// <dir>/r2/<key> — every object, byte for byte, with r2/_index.json listing
// key, size and modified time. The folder mirrors the bucket: an object already
// there at the same size is skipped, so a second run only fetches what is new,
// and a file whose object is gone from the bucket is removed.
//
// Read only on the remote side: nothing in the database or the bucket changes.
import { mkdir, readdir, rm, rmdir, writeFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

neonConfig.webSocketConstructor = ws
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, DATABASE_URL } = process.env
const DIR = process.argv[2]
if (!DIR) {
  console.error("usage: node --env-file=.env.local scripts/backup-local.mjs <dir>")
  process.exit(2)
}

// ── the database ──
const pool = new Pool({ connectionString: DATABASE_URL })
const { rows: tables } = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
)
await mkdir(join(DIR, "db"), { recursive: true })
for (const { table_name: t } of tables) {
  const { rows } = await pool.query(`SELECT * FROM "${t}"`)
  await writeFile(join(DIR, "db", `${t}.json`), JSON.stringify(rows))
  console.log(`db  ${t}: ${rows.length} rows`)
}
await pool.end()

// ── the bucket ──
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})
const objects = []
let token
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }))
  for (const o of r.Contents ?? []) objects.push({ key: o.Key, size: o.Size, modified: o.LastModified })
  token = r.IsTruncated ? r.NextContinuationToken : undefined
} while (token)
await mkdir(join(DIR, "r2"), { recursive: true })
await writeFile(join(DIR, "r2", "_index.json"), JSON.stringify(objects))
let fetched = 0, bytes = 0
for (const o of objects) {
  const path = join(DIR, "r2", ...o.key.split("/"))
  const have = await stat(path).catch(() => null)
  if (have && have.size === o.size) continue
  await mkdir(dirname(path), { recursive: true })
  const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: o.key }))
  await writeFile(path, Buffer.from(await r.Body.transformToByteArray()))
  fetched++
  bytes += o.size
  if (fetched % 20 === 0) console.log(`r2  ${fetched} fetched, ${(bytes / 1e6).toFixed(0)} MB`)
}
console.log(`r2  ${objects.length} objects; ${fetched} fetched this run (${(bytes / 1e6).toFixed(0)} MB)`)

// what the bucket no longer holds: its files, then the folders that leaves empty
const want = new Set(objects.map((o) => join(DIR, "r2", ...o.key.split("/"))))
want.add(join(DIR, "r2", "_index.json"))
let removed = 0
async function sweep(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      await sweep(p)
      if (!(await readdir(p)).length) await rmdir(p)
    } else if (!want.has(p)) {
      await rm(p)
      removed++
    }
  }
}
await sweep(join(DIR, "r2"))
console.log(`r2  ${removed} files no longer in the bucket removed`)
