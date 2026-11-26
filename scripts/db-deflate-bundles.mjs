// Re-pack published scenes' bundles with their motions, models and text deflated.
//
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs                  dry run: what each would save
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs --write          re-pack, upload, repoint rows
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs --write --id XNBpPY
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs --write --limit 5
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs --rollback <id>  put a scene's old bundle back
//   node --env-file=.env.local scripts/db-deflate-bundles.mjs --delete-old     after `npm run db:refresh`
//
// Bundles were written store-only and then sealed, and sealed bytes are noise
// that nothing on the way to a reader can compress — so a scene's motions went
// out at full size: 44MB of VMD in a 138MB bundle that deflates to 91MB. The
// publish path deflates now (lib/bundle.ts); this is the same for what is
// already out there. The browser's reader has always opened deflated entries.
//
// ONLY PUBLIC SCENES, as scripts/db-webp-published-scenes.mjs: a private one is
// its author's working copy and nobody is waiting on its download.
//
// SAFE BY CONSTRUCTION, as scripts/db-seal-bundles.mjs:
// - the re-packed zip is read back and compared file by file before it goes up;
// - it goes up under a NEW key (bundles are immutable at the edge, so an
//   overwrite would keep serving the old bytes), and the old one stays;
// - a row is repointed only if it still names the bundle that was re-packed;
// - each move is recorded in the manifest, which --rollback and --delete-old read.
// Three things move together or the scene breaks: `bundle_key`, `bundle_bytes`
// and `payload.doc.assets.bundle`.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { createHmac, randomBytes } from "node:crypto"
import { neon } from "@neondatabase/serverless"
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { openSealedBundle, sealBundle, sealedName } from "../lib/bundle-cipher.ts"
import { readZip, writeZip } from "./lib/zip.mjs"

const WRITE = process.argv.includes("--write")
const DELETE_OLD = process.argv.includes("--delete-old")
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}
const ONLY = argOf("--id")
const ROLLBACK = argOf("--rollback")
const LIMIT = Number(argOf("--limit") ?? 0) || Infinity
const MANIFEST = "scripts/.deflated-bundles.json"
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"
/** Not worth a new bundle below this saving. */
const MIN_SAVING = 0.03

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

// lib/bundle-owner.ts (server-only, so not importable here), as in db-seal-bundles.
const ownerTag = (userId) => createHmac("sha256", BETTER_AUTH_SECRET).update(`bundle-owner:${userId}`).digest("base64url").slice(0, 16)
const newBundleKey = (userId) => `b/${ownerTag(userId)}/${randomBytes(18).toString("base64url")}.bin`
const mb = (n) => `${(Number(n) / 1024 / 1024).toFixed(1)}MB`
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : []
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))

if (ROLLBACK) {
  const m = [...manifest].reverse().find((x) => x.id === ROLLBACK && !x.rolledBack)
  if (!m) {
    console.error(`no re-pack of ${ROLLBACK} in ${MANIFEST}`)
    process.exit(1)
  }
  const oldUrl = `${R2_PUBLIC_BASE_URL}/${m.oldKey}`
  const back = await sql`
    update library_items
    set bundle_key = ${m.oldKey}, bundle_bytes = ${m.oldBytes},
        payload = jsonb_set(payload, '{doc,assets,bundle}', to_jsonb(${oldUrl}::text))
    where id = ${m.id} and bundle_key = ${m.newKey}
    returning id`
  if (!back.length) {
    console.error(`${m.id} no longer names ${m.newKey} — left as it is`)
    process.exit(1)
  }
  m.rolledBack = true
  saveManifest()
  console.log(`${m.id} is back on ${m.oldKey}. Next: npm run db:refresh`)
  process.exit(0)
}

if (DELETE_OLD) {
  let deleted = 0
  for (const m of manifest) {
    if (m.deleted) continue
    // A rolled-back scene names its old key again; its NEW one is the orphan.
    const key = m.rolledBack ? m.newKey : m.oldKey
    const [still] = await sql`select count(*)::int n from library_items where bundle_key = ${key}`
    if (still.n > 0) {
      console.log(`  keep ${key} — still named by ${still.n} row(s)`)
      continue
    }
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    m.deleted = true
    deleted++
    console.log(`  deleted ${key}`)
  }
  saveManifest()
  console.log(`\n${deleted} bundle(s) deleted`)
  process.exit(0)
}

const rows = ONLY
  ? await sql`
      select id, name, author, owner_id, visibility, bundle_key, bundle_bytes, payload->'doc'->'assets'->>'bundle' as url
      from library_items where id = ${ONLY} and kind = 'scene'`
  : await sql`
      select id, name, author, owner_id, visibility, bundle_key, bundle_bytes, payload->'doc'->'assets'->>'bundle' as url
      from library_items
      where kind = 'scene' and visibility = 'public' and deleted_at is null
        and bundle_key like 'b/%' and owner_id is not null
      order by bundle_bytes desc`
const done = new Set(manifest.filter((m) => !m.rolledBack).map((m) => m.newKey))
const todo = rows.filter((r) => !done.has(r.bundle_key)).slice(0, LIMIT)
console.log(`${WRITE ? "RE-PACKING" : "DRY RUN"} — ${todo.length} bundle(s), ${mb(todo.reduce((n, r) => n + Number(r.bundle_bytes ?? 0), 0))}\n`)

let before = 0
let after = 0
let moved = 0
for (const r of todo) {
  const label = `${r.id} ${mb(r.bundle_bytes ?? 0)} "${r.name}"`
  try {
    if (r.visibility !== "public") {
      console.log(`  skip ${label}: ${r.visibility}, and only public scenes are re-packed`)
      continue
    }
    const expected = `${R2_PUBLIC_BASE_URL}/${r.bundle_key}`
    if (r.url !== expected) {
      console.log(`  skip ${label}: its document names ${r.url}, not ${expected}`)
      continue
    }
    const res = await fetch(r.url)
    if (!res.ok) {
      console.log(`  skip ${label}: fetch ${res.status}`)
      continue
    }
    const fetched = await res.blob()
    // A .bin that begins with a zip's signature was never sealed (bundleZip).
    const head = new Uint8Array(await fetched.slice(0, 4).arrayBuffer())
    const plain = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
    const zip = Buffer.from(await (plain ? fetched : await openSealedBundle(fetched, sealedName(r.bundle_key))).arrayBuffer())
    const entries = readZip(zip)
    const rebuilt = writeZip(entries)
    const saving = 1 - rebuilt.length / zip.length
    if (saving < MIN_SAVING) {
      console.log(`  skip ${label}: ${mb(zip.length)} → ${mb(rebuilt.length)}, nothing worth moving`)
      continue
    }
    // READ IT BACK BEFORE IT GOES ANYWHERE: every path, every byte.
    const check = readZip(rebuilt)
    if (check.length !== entries.length) throw new Error(`re-packed zip has ${check.length} of ${entries.length} files`)
    check.forEach((e, i) => {
      if (e.path !== entries[i].path || !e.bytes.equals(entries[i].bytes)) throw new Error(`re-packed zip lost ${entries[i].path}`)
    })
    before += zip.length
    after += rebuilt.length
    console.log(`  ${WRITE ? "re-pack" : "would  "} ${label}: ${mb(zip.length)} → ${mb(rebuilt.length)} (−${Math.round(saving * 100)}%)`)
    if (!WRITE) continue

    const newKey = newBundleKey(r.owner_id)
    const sealed = new Uint8Array(await (await sealBundle(new Blob([rebuilt]), sealedName(newKey))).arrayBuffer())
    await s3.send(
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: newKey, Body: sealed, ContentType: "application/octet-stream", CacheControl: IMMUTABLE_CACHE_CONTROL }),
    )
    const stored = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
    if (stored.ContentLength !== sealed.length) {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
      console.log(`    skip: stored ${stored.ContentLength} bytes, expected ${sealed.length}`)
      continue
    }
    const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`
    // Only if the row still names the bundle re-packed: a republish in between
    // already gave it a newer one, and this copy is then nobody's.
    const updated = await sql`
      update library_items
      set bundle_key = ${newKey}, bundle_bytes = ${sealed.length},
          payload = jsonb_set(payload, '{doc,assets,bundle}', to_jsonb(${newUrl}::text))
      where id = ${r.id} and bundle_key = ${r.bundle_key}
      returning id`
    if (!updated.length) {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: newKey }))
      console.log(`    skip: changed while re-packing`)
      continue
    }
    manifest.push({ id: r.id, oldKey: r.bundle_key, oldBytes: Number(r.bundle_bytes), newKey, newBytes: sealed.length })
    saveManifest()
    moved++
  } catch (e) {
    console.log(`  FAIL ${label}: ${e instanceof Error ? e.message : e}`)
  }
}
console.log(
  `\n${mb(before)} → ${mb(after)} across the re-packable ones` +
    (WRITE ? `; ${moved} moved. Next: npm run db:refresh, check a scene, then --delete-old` : ". Nothing written — re-run with --write"),
)
