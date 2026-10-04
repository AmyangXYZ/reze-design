// Every object in the bucket, as JSON (key, size, modified) — read only.
//
//   node --env-file=.env.local scripts/r2-inventory.mjs <out.json>
//
// The input to any cleanup: what is there, before deciding what is not linked.
import { writeFile } from "node:fs/promises"
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env
const out = process.argv[2]
if (!out) {
  console.error("usage: node --env-file=.env.local scripts/r2-inventory.mjs <out.json>")
  process.exit(2)
}
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
await writeFile(out, JSON.stringify(objects))
const byTop = new Map()
for (const o of objects) {
  const top = o.key.split("/").slice(0, o.key.startsWith("demo/") ? 3 : 1).join("/")
  const t = byTop.get(top) ?? { n: 0, bytes: 0 }
  t.n++
  t.bytes += o.size
  byTop.set(top, t)
}
const total = objects.reduce((a, o) => a + o.size, 0)
console.log(`${objects.length} objects, ${(total / 1e6).toFixed(1)} MB`)
for (const [k, t] of [...byTop].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`${(t.bytes / 1e6).toFixed(1).padStart(9)} MB  ${String(t.n).padStart(6)}  ${k}`)
