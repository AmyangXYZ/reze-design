// Publish the app's current built-in effects to the library.
//
//   node --env-file=.env.local scripts/db-seed-builtins.mjs
//   node --env-file=.env.local scripts/db-seed-builtins.mjs --write
//
// DRY RUN by default.
//
// The built-ins ship inside the app bundle, so the editor always has the
// current ones. The LIBRARY is a different surface: it is what someone browsing
// discovers, and what a published scene pins. Those two drifted — several
// published payloads were thousands of characters behind what the app ships,
// and four built-ins had never been published at all, so nobody could find them.
//
// A changed effect gets a NEW VERSION rather than an edited one. Scenes pin an
// exact version precisely so they keep rendering what their author saw; editing
// a published payload in place would rewrite everyone's scene silently. New
// versions leave every existing pin exactly where it is, and db-patch-scene-pins
// is the separate, deliberate step that moves scenes forward.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { readFileSync } from "node:fs"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")
const OWN = "amyang-xyz"
/** Published, but no longer shipped — retired from the built-ins. */
const RETIRED = ["Immolation"]

const builtins = JSON.parse(readFileSync("content/effects.json", "utf8"))
const { rows } = await pool.query(`select id, name, author, version, payload, owner_id from library_items where kind = 'effect'`)
const db = new Map(rows.map((r) => [r.id, r]))
const ownerId = rows.find((r) => r.author === OWN)?.owner_id ?? null

const newVersions = []
const creations = []
for (const b of builtins) {
  const r = db.get(b.id)
  if (!r) {
    creations.push(b)
  } else if (r.payload?.wgsl !== b.payload.wgsl) {
    newVersions.push({ item: r, next: r.version + 1, effect: b })
  }
}
const retire = rows.filter((r) => RETIRED.includes(r.name) && r.author === OWN)

console.log(`built-ins: ${builtins.length}   published: ${rows.length}   owner: ${ownerId ?? "(none found)"}\n`)
console.log(`NEW VERSION (${newVersions.length}):`)
for (const v of newVersions) console.log(`  ${v.item.name}  v${v.item.version} -> v${v.next}`)
console.log(`\nCREATE, public (${creations.length}):`)
for (const c of creations) console.log(`  ${c.name}  ·  ${c.description?.slice(0, 60) ?? ""}`)
console.log(`\nRETIRE (${retire.length}):`)
for (const r of retire) console.log(`  ${r.name}  ·  ${r.id}`)

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
  await pool.end()
  process.exit(0)
}

for (const v of newVersions) {
  await pool.query(
    `insert into library_item_versions (item_id, version, payload, changelog) values ($1, $2, $3::jsonb, $4)`,
    [v.item.id, v.next, JSON.stringify(v.effect.payload), "synced from the shipped built-in"],
  )
  await pool.query(
    `update library_items
        set version = $1, payload = $2::jsonb, name = $3, description = $4, tags = $5, updated_at = now()
      where id = $6`,
    [v.next, JSON.stringify(v.effect.payload), v.effect.name, v.effect.description ?? "", v.effect.tags ?? [], v.item.id],
  )
}

for (const c of creations) {
  await pool.query(
    `insert into library_items (id, kind, name, author, description, tags, version, payload, owner_id, visibility)
     values ($1, 'effect', $2, $3, $4, $5, 1, $6::jsonb, $7, 'public')`,
    [c.id, c.name, OWN, c.description ?? "", c.tags ?? [], JSON.stringify(c.payload), ownerId],
  )
  await pool.query(`insert into library_item_versions (item_id, version, payload, changelog) values ($1, 1, $2::jsonb, $3)`, [
    c.id,
    JSON.stringify(c.payload),
    "first publish",
  ])
}

if (retire.length) {
  await pool.query(`delete from library_items where id = any($1::text[])`, [retire.map((r) => r.id)])
}

console.log(`\npublished ${newVersions.length} new version(s), created ${creations.length}, retired ${retire.length}`)
await pool.end()
