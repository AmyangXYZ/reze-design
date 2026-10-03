// Seal every scene bundle published before sealing existed (lib/bundle-cipher).
//
//   node --env-file=.env.local scripts/db-seal-bundles.mjs                 dry run: what would move
//   node --env-file=.env.local scripts/db-seal-bundles.mjs --write         seal, upload, repoint rows
//   node --env-file=.env.local scripts/db-seal-bundles.mjs --write --limit 1
//   node --env-file=.env.local scripts/db-seal-bundles.mjs --write --id <scene id>
//   node --env-file=.env.local scripts/db-seal-bundles.mjs --delete-old    after `npm run db:refresh`
//
// TWO PASSES, so nothing is ever unreadable. --write uploads each sealed copy
// under a fresh opaque key and repoints its row — but leaves the old zip where
// it is, because cached scene pages still name it until the cache is dropped.
// --delete-old then removes only the old zips that no row names any more, from
// the manifest --write left behind.
//
// The live site must be running the loader that opens .bin before --write: a
// row repointed to a sealed bundle is unreadable to the old one.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createHmac, randomBytes } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
// The browser's own module, not a copy: Node strips its types, and the two
// sides agreeing byte for byte is the whole requirement.
import { sealBundle, sealedName } from "../lib/bundle-cipher.ts"

const WRITE = process.argv.includes("--write")
const DELETE_OLD = process.argv.includes("--delete-old")
const limitAt = process.argv.indexOf("--limit")
const LIMIT = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity
const idAt = process.argv.indexOf("--id")
const ONLY = idAt > 0 ? process.argv[idAt + 1] : null
const MANIFEST = "scripts/.sealed-bundles.json"
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"

const { DATABASE_URL_UNPOOLED, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, BETTER_AUTH_SECRET } =
  process.env
for (const [k, v] of Object.entries({ DATABASE_URL_UNPOOLED, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, BETTER_AUTH_SECRET })) {
  if (!v) {
    console.error(`${k} is not set (.env.local)`)
    process.exit(1)
  }
}

const sql = neon(DATABASE_URL_UNPOOLED)
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

// lib/bundle-owner.ts, which cannot be imported here (it is server-only). Must
// stay identical, or the owner could not replace their own migrated bundle.
const ownerTag = (userId) => createHmac("sha256", BETTER_AUTH_SECRET).update(`bundle-owner:${userId}`).digest("base64url").slice(0, 16)
const newBundleKey = (userId) => `b/${ownerTag(userId)}/${randomBytes(18).toString("base64url")}.bin`
const mb = (n) => `${(Number(n) / 1024 / 1024).toFixed(1)}MB`

if (DELETE_OLD) {
  if (!existsSync(MANIFEST)) {
    console.error(`no ${MANIFEST} — run --write first`)
    process.exit(1)
  }
  const moved = JSON.parse(readFileSync(MANIFEST, "utf8"))
  let deleted = 0
  for (const m of moved) {
    const [still] = await sql`select count(*)::int n from library_items where bundle_key = ${m.oldKey}`
    if (still.n > 0) {
      console.log(`  keep ${m.oldKey} — still named by ${still.n} row(s)`)
      continue
    }
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: m.oldKey }))
    deleted++
    console.log(`  deleted ${m.oldKey}`)
  }
  console.log(`\n${deleted} old bundle(s) deleted`)
  process.exit(0)
}

const rows = await sql`
  select id, name, owner_id, bundle_key, bundle_bytes, payload->'doc'->'assets'->>'bundle' as url
  from library_items
  where kind = 'scene' and bundle_key like 'scenes/%' and owner_id is not null
  order by created_at`
const todo = (ONLY ? rows.filter((r) => r.id === ONLY) : rows).slice(0, LIMIT)
const total = todo.reduce((n, r) => n + Number(r.bundle_bytes ?? 0), 0)
console.log(`${WRITE ? "SEALING" : "DRY RUN"} — ${todo.length} of ${rows.length} unsealed bundle(s), ${mb(total)}\n`)

if (!WRITE) {
  for (const r of todo) console.log(`  ${r.id}  ${mb(r.bundle_bytes ?? 0)}  ${r.bundle_key}  (${r.name})`)
  console.log(`\nnothing written — re-run with --write`)
  process.exit(0)
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : []
let done = 0
for (const r of todo) {
  const expected = `${R2_PUBLIC_BASE_URL}/${r.bundle_key}`
  if (r.url !== expected) {
    console.log(`  skip ${r.id}: its document names ${r.url}, not ${expected}`)
    continue
  }
  const res = await fetch(r.url)
  if (!res.ok) {
    console.log(`  skip ${r.id}: fetch ${res.status}`)
    continue
  }
  const zip = await res.blob()
  const head = new Uint8Array(await zip.slice(0, 2).arrayBuffer())
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    console.log(`  skip ${r.id}: not a zip`)
    continue
  }
  const newKey = newBundleKey(r.owner_id)
  const sealed = new Uint8Array(await (await sealBundle(zip, sealedName(newKey))).arrayBuffer())
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: newKey,
      Body: sealed,
      ContentType: "application/octet-stream",
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  )
  const stored = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
  if (stored.ContentLength !== zip.size) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
    console.log(`  skip ${r.id}: stored ${stored.ContentLength} bytes, expected ${zip.size}`)
    continue
  }
  const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`
  // Only if the row still names the bundle we sealed: a republish in between
  // already gave it a newer one, and this copy is then nobody's.
  const updated = await sql`
    update library_items
    set bundle_key = ${newKey},
        payload = jsonb_set(payload, '{doc,assets,bundle}', to_jsonb(${newUrl}::text))
    where id = ${r.id} and bundle_key = ${r.bundle_key}
    returning id`
  if (!updated.length) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
    console.log(`  skip ${r.id}: changed while sealing`)
    continue
  }
  manifest.push({ id: r.id, oldKey: r.bundle_key, newKey })
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  done++
  console.log(`  sealed ${r.id}  ${mb(zip.size)}  → ${newKey}`)
}
console.log(`\n${done} bundle(s) sealed. Next: npm run db:refresh, check a scene, then --delete-old`)
