// Copy every object from the old R2 bucket to the new one, keeping keys identical.
//
//   node --env-file=.env.local scripts/r2-migrate.mjs           # dry run
//   node --env-file=.env.local scripts/r2-migrate.mjs --write
//   node --env-file=.env.local scripts/r2-migrate.mjs --verify  # compare both buckets
//
// Keys are preserved verbatim, so a URL only ever changes in its HOSTNAME and
// the old domain keeps serving the same paths. Nothing here touches the old
// bucket, the database, or production config — after this runs, the new bucket
// is a complete replica that nothing reads yet.
//
// Every object lands with a one-year immutable cache header. A published object
// is immutable by construction (each publish mints a new scene id and a new key,
// see app/api/upload/route.ts), and 85 of the 88 objects under `scenes/` reached
// the old bucket with no cache header at all — which is why opening a published
// scene re-downloaded its bundle, up to 204MB of it, on Cloudflare's 4-hour
// default rather than keeping it.
import {
  S3Client, ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand, PutObjectCommand, GetObjectCommand,
} from "@aws-sdk/client-s3"

const WRITE = process.argv.includes("--write")
const VERIFY = process.argv.includes("--verify")

const {
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
  NEW_BUCKET_NAME, NEW_BUCKET_BASE_URL,
  NEW_BUCKET_ACCESS_KEY_ID, NEW_BUCKET_SECRET_ACCESS_KEY,
} = process.env

const IMMUTABLE = "public, max-age=31536000, immutable"
const CONCURRENCY = 4

const client = (id, secret) =>
  new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: id, secretAccessKey: secret },
  })

const src = client(R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
// One token scoped to both buckets copies server-side; a token for the new
// bucket alone still works, by streaming each object through this machine.
const dst = NEW_BUCKET_ACCESS_KEY_ID
  ? client(NEW_BUCKET_ACCESS_KEY_ID, NEW_BUCKET_SECRET_ACCESS_KEY)
  : src

async function list(s3, Bucket) {
  const out = []
  let ContinuationToken
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken }))
    for (const o of page.Contents ?? []) out.push(o)
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  return out
}

async function pool(items, n, worker) {
  const queue = [...items.entries()]
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      await worker(next[1], next[0])
    }
  })
  await Promise.all(runners)
}

if (VERIFY) {
  const [a, b] = await Promise.all([list(src, R2_BUCKET), list(dst, NEW_BUCKET_NAME)])
  const bySize = new Map(b.map((o) => [o.Key, o.Size]))
  const missing = a.filter((o) => !bySize.has(o.Key))
  const wrong = a.filter((o) => bySize.has(o.Key) && bySize.get(o.Key) !== o.Size)
  console.log(`old ${a.length} objects, new ${b.length} objects`)
  console.log(`missing in new : ${missing.length}`)
  console.log(`size mismatch  : ${wrong.length}`)
  for (const o of [...missing, ...wrong].slice(0, 10)) console.log("  !", o.Key)
  // Headers are what the browser actually acts on, so check them over the real domain.
  const sample = a.filter((o) => o.Size > 0).slice(0, 3)
  for (const o of sample) {
    const r = await fetch(`${NEW_BUCKET_BASE_URL}/${encodeURI(o.Key)}`, { headers: { Range: "bytes=0-0" } })
    console.log(`  ${r.status}  ${r.headers.get("cache-control")}  ${r.headers.get("content-type")}  ${o.Key.slice(0, 50)}`)
  }
  process.exit(missing.length || wrong.length ? 1 : 0)
}

const objects = await list(src, R2_BUCKET)
const bytes = objects.reduce((n, o) => n + o.Size, 0)
console.log(`${objects.length} objects, ${(bytes / 1e9).toFixed(2)} GB  ${R2_BUCKET} -> ${NEW_BUCKET_NAME}`)
if (!WRITE) {
  console.log("(dry run — pass --write)")
  process.exit(0)
}

let done = 0
let streamed = 0
await pool(objects, CONCURRENCY, async (o) => {
  const head = await src.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: o.Key }))
  const meta = { ContentType: head.ContentType ?? "application/octet-stream", CacheControl: IMMUTABLE }
  try {
    await dst.send(new CopyObjectCommand({
      Bucket: NEW_BUCKET_NAME,
      Key: o.Key,
      // Non-ASCII keys and spaces must be encoded here; slashes must not.
      CopySource: encodeURI(`${R2_BUCKET}/${o.Key}`),
      MetadataDirective: "REPLACE",
      ...meta,
    }))
  } catch {
    // The destination token cannot read the source bucket — go through memory.
    const got = await src.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: o.Key }))
    const body = Buffer.from(await got.Body.transformToByteArray())
    await dst.send(new PutObjectCommand({ Bucket: NEW_BUCKET_NAME, Key: o.Key, Body: body, ...meta }))
    streamed++
  }
  done++
  console.log(`  ${String(done).padStart(3)}/${objects.length}  ${(o.Size / 1e6).toFixed(1).padStart(7)} MB  ${o.Key}`)
})
console.log(`\n${done} objects copied${streamed ? ` (${streamed} streamed)` : " server-side"}.`)
console.log(`verify: node --env-file=.env.local scripts/r2-migrate.mjs --verify`)
