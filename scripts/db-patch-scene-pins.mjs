// Move published scenes onto the CURRENT version of the app's own effects.
//
//   node --env-file=.env.local scripts/db-patch-scene-pins.mjs
//   node --env-file=.env.local scripts/db-patch-scene-pins.mjs --write
//
// DRY RUN by default.
//
// A scene pins {id, version} precisely so it renders the same forever while the
// author keeps iterating — so this deliberately breaks that promise, and only
// for effects the app itself publishes. The reason is that those pins are not
// someone's frozen artwork, they are our own back catalogue: a scene pinned to
// an early Hand Ribbon is running a ribbon with no glow and a slower path, and
// nobody chose that — they chose "Hand Ribbon".
//
// Community-authored effects are left alone at whatever version the scene
// pinned. Bumping another person's work inside a third person's scene is a
// change neither of them asked for.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")
const OWN = "amyang-xyz"

const effects = new Map(
  (await pool.query(`select id, name, author, version from library_items where kind = 'effect'`)).rows.map((r) => [
    r.id,
    r,
  ]),
)

const scenes = (
  await pool.query(`select id, name, author, payload from library_items where kind = 'scene' order by created_at`)
).rows

const patched = []
for (const row of scenes) {
  const doc = row.payload
  const list = doc?.doc?.settings?.background?.effects
  if (!Array.isArray(list)) continue
  const changes = []
  for (const entry of list) {
    // Only PINS carry a version; an effect stored by value has no id to look up.
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.version !== "number") {
      continue
    }
    const item = effects.get(entry.id)
    if (!item) {
      changes.push(`! ${entry.id.slice(0, 8)} v${entry.version} — no such effect, left alone`)
      continue
    }
    if (item.author !== OWN || entry.version >= item.version) continue
    changes.push(`${item.name}: v${entry.version} -> v${item.version}`)
    entry.version = item.version
  }
  if (changes.some((c) => !c.startsWith("!"))) patched.push({ row, doc, changes })
  else if (changes.length) console.log(`  ${row.name} — ${changes.join(", ")}`)
}

console.log(`scenes: ${scenes.length}   with a stale pin: ${patched.length}\n`)
for (const p of patched) {
  console.log(`  ${p.row.name}  ·  ${p.row.author}`)
  for (const c of p.changes) console.log(`      ${c}`)
}

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
} else if (patched.length === 0) {
  console.log("\nNothing to patch.")
} else {
  for (const p of patched) {
    await pool.query(`update library_items set payload = $1::jsonb where id = $2`, [JSON.stringify(p.doc), p.row.id])
  }
  console.log(`\npatched ${patched.length} scene(s)`)
}

await pool.end()
