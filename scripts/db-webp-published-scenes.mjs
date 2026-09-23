// Re-encode published scenes' textures as WebP, in place of the bundle they ship.
//
//   node --import ./scripts/register.mjs --env-file=.env.local scripts/db-webp-published-scenes.mjs
//   … --only KLyKGk          one scene, by the id in its share URL
//   … --limit 5              the largest N that have not been done
//   … --write                actually do it
//
// DRY RUN by default.
//
// Scenes published before lib/texture-webp.ts carry their textures as they were
// uploaded — PNG and TGA, routinely 90% of the bundle — and everyone who opens
// the link downloads all of it before the scene appears. An upload converts at
// the boundary now; this is the same conversion for what is already out there.
//
// ONLY PUBLIC SCENES. A private scene is the author's own working copy and
// nobody is waiting on its download; rewriting one would be editing someone's
// unpublished work to no one's benefit.
//
// WHAT IS LEFT ALONE, and why it is a path rule rather than a type rule: the
// .pmx NAMES its textures, so a renamed texture is followed by rewriting that
// table. Everything else in a bundle is named by the DOCUMENT — a skybox, a
// backdrop, a plate, a media plane, the audio, the motions — and renaming one
// of those silently breaks a scene that points at it. So only files under a
// model's own folder are touched: `models/<id>/…` and `stages/<id>/…`. The
// `maps/` beside a stage need no rewrite either way, since lib/material-maps.ts
// already probes for .webp.
//
// A NEW KEY, NEVER AN OVERWRITE. Bundles carry a one-year immutable header, so
// an overwritten key keeps serving the old bytes from the edge long after the
// bucket has forgotten them. The old object is left in place: the row points at
// the new one, and rolling a scene back is a matter of putting the old key and
// URL back.
//
// Three things move together or the scene breaks: `bundle_key`, `bundle_bytes`,
// and `payload.doc.assets.bundle`, which carries the absolute URL.

import { randomUUID } from "node:crypto"
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { readPmxDocument, writePmxDocument } from "reze-engine"
import { readZip, writeZip } from "./lib/zip.mjs"
import { CONVERT, toWebp, retargetTextures } from "./lib/webp-texture.mjs"

neonConfig.webSocketConstructor = ws

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, DATABASE_URL } = process.env
const WRITE = process.argv.includes("--write")
const argOf = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : (process.argv[i + 1] ?? null)
}
const ONLY = argOf("--only")
const LIMIT = Number(argOf("--limit") ?? 0) || null

for (const [k, v] of Object.entries({ DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL }))
  if (!v) throw new Error(`${k} is not set — run with --env-file=.env.local`)

// Kept in step with app/api/upload/route.ts by hand — one string.
const IMMUTABLE = "public, max-age=31536000, immutable"
const MB = (n) => (n / 1048576).toFixed(2)
/** A model's own folder, which is the only place a .pmx names its own files. */
const MODEL_ROOT = /^(?:models|stages)\/[^/]+\//

const pool = new Pool({ connectionString: DATABASE_URL })
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
})

/** One bundle, converted. Returns null when there was nothing to do. */
async function convertBundle(entries) {
  const byRoot = new Map()
  for (const e of entries) {
    const root = e.path.match(MODEL_ROOT)?.[0]
    if (!root) continue
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(e)
  }

  let converted = 0
  let before = 0
  let after = 0
  const kept = new Map()
  const out = new Map(entries.map((e) => [e.path, e]))

  for (const [root, group] of byRoot) {
    // Scoped per model: two models in one bundle can share a texture basename,
    // and a table rewritten from a shared map would point at the other's file.
    const renamed = new Map()
    for (const e of group) {
      if (!CONVERT.test(e.path)) continue
      const r = await toWebp(e.bytes, e.path)
      if (r.kept) {
        kept.set(r.kept, (kept.get(r.kept) ?? 0) + 1)
        continue
      }
      const to = e.path.replace(/\.[^./]+$/, ".webp")
      out.delete(e.path)
      out.set(to, { path: to, bytes: r.out })
      renamed.set((e.path.split("/").pop()).toLowerCase(), to.split("/").pop())
      converted++
      before += e.bytes.length
      after += r.out.length
      console.log(
        `    ${e.path.slice(root.length).padEnd(34)} ${MB(e.bytes.length)} → ${MB(r.out.length)}MB  ` +
          `${r.mode.padEnd(9)} PSNR ${r.psnr} worst±${r.worst}${r.dropped ? ` (+${r.dropped} px under alpha 0)` : ""}`,
      )
    }
    if (!renamed.size) continue

    // The table follows its files, or the model loses them.
    for (const e of group) {
      if (!/\.pmx$/i.test(e.path)) continue
      const buf = e.bytes
      const doc = readPmxDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      const touched = retargetTextures(doc, renamed)
      if (!touched) continue
      out.set(e.path, { path: e.path, bytes: Buffer.from(writePmxDocument(doc)) })
      console.log(`    ${e.path}: ${touched}/${doc.textures.length} texture paths rewritten`)
    }
  }

  if (!converted) return { converted: 0, kept }
  // Central-directory order preserved where it can be: a bundle reads by name,
  // but a diff of two listings is easier when nothing has moved for no reason.
  return { entries: [...out.values()], converted, before, after, kept }
}

const where = ONLY
  ? `id = '${ONLY.replace(/'/g, "''")}'`
  : `kind = 'scene' AND visibility = 'public' AND bundle_key IS NOT NULL`
const { rows } = await pool.query(
  `SELECT id, name, author, owner_id, bundle_key, bundle_bytes, visibility, kind, payload
     FROM library_items
    WHERE ${where}
    ORDER BY bundle_bytes DESC${LIMIT ? ` LIMIT ${LIMIT}` : ""}`,
)

if (!rows.length) {
  console.log(ONLY ? `no scene with id ${ONLY}` : "no public published scenes with a bundle")
  await pool.end()
  process.exit(0)
}

let totalBefore = 0
let totalAfter = 0
let done = 0
for (const row of rows) {
  const label = `${row.id} "${row.name}" by ${row.author}`
  if (row.kind !== "scene" || !row.bundle_key) {
    console.log(`\n${label} — skipped: ${row.kind} with no bundle`)
    continue
  }
  // Stated rather than filtered when --only names one, so asking for a private
  // scene by hand gets an answer instead of an empty list.
  if (row.visibility !== "public") {
    console.log(`\n${label} — skipped: ${row.visibility}, and only public scenes are rewritten`)
    continue
  }
  console.log(`\n${label} — ${MB(row.bundle_bytes)}MB`)
  try {
    const url = `${R2_PUBLIC_BASE_URL}/${row.bundle_key}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`bundle ${res.status}`)
    const zip = Buffer.from(await res.arrayBuffer())
    const entries = readZip(zip)
    const result = await convertBundle(entries)
    for (const [reason, n] of result.kept) console.log(`    ${n} kept — ${reason}`)
    if (!result.converted) {
      console.log("  nothing to convert")
      continue
    }

    const rebuilt = writeZip(result.entries)
    // READ IT BACK BEFORE IT GOES ANYWHERE. This writes the format the browser
    // reads, and a bundle that will not open is a scene that will not open.
    const check = readZip(rebuilt)
    if (check.length !== result.entries.length) throw new Error(`rebuilt zip has ${check.length} of ${result.entries.length} entries`)
    for (const e of check) {
      const want = result.entries.find((x) => x.path === e.path)
      if (!want || !want.bytes.equals(e.bytes)) throw new Error(`rebuilt zip lost ${e.path}`)
    }

    totalBefore += row.bundle_bytes
    totalAfter += rebuilt.length
    done++
    console.log(
      `  textures ${MB(result.before)} → ${MB(result.after)}MB · bundle ${MB(row.bundle_bytes)} → ${MB(rebuilt.length)}MB` +
        `  (−${Math.round((1 - rebuilt.length / row.bundle_bytes) * 100)}%)`,
    )
    if (!WRITE) continue

    const key = `scenes/${row.owner_id}/${randomUUID()}/assets.zip`
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: rebuilt,
        ContentType: "application/zip",
        CacheControl: IMMUTABLE,
      }),
    )
    // The document carries the absolute URL; the row carries the key and the
    // size. All three, in one statement, after the bytes are up.
    const payload = { ...row.payload, doc: { ...row.payload.doc, assets: { ...row.payload.doc.assets, bundle: `${R2_PUBLIC_BASE_URL}/${key}` } } }
    await pool.query(`UPDATE library_items SET bundle_key = $1, bundle_bytes = $2, payload = $3 WHERE id = $4`, [
      key,
      rebuilt.length,
      payload,
      row.id,
    ])
    console.log(`  ✓ ${key}`)
    console.log(`    the old bundle is still at ${row.bundle_key} — roll back by putting that key and URL back`)
  } catch (e) {
    // One scene short, never the run: a bundle that will not read is the case
    // this is most likely to meet, and it must not stop the rest.
    console.error(`  ✗ left as it was — ${e.message}`)
  }
}

console.log(
  `\n${done} scene(s) ${WRITE ? "rewritten" : "would be rewritten"}` +
    (done ? ` · ${MB(totalBefore)} → ${MB(totalAfter)}MB (−${Math.round((1 - totalAfter / totalBefore) * 100)}%)` : "") +
    (WRITE ? "" : "   — dry run, nothing written; pass --write"),
)
await pool.end()
