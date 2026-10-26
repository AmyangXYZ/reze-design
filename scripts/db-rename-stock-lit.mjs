// The stock stage material "Lit" becomes "Stage Lit".
//
//   node --env-file=.env.local scripts/db-rename-stock-lit.mjs
//   node --env-file=.env.local scripts/db-rename-stock-lit.mjs --write
//
// DRY RUN by default. Then `npm run db:refresh`.
//
// "Lit" is the engine's DEFAULT_GRAPH, the look a new group starts on. A stock
// graph of the same name made every lookup by name find the stage material:
// a new group read 默认 · 已修改 in the material list, the library marked
// 基础光照 as what it wore, and the editor's Reset restored the stage material.
// The name is renamed in the row, its payload and every version; scenes pin the
// row by id and load it under the new name.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")
const ID = "b4edbe64-8b7c-58b0-8955-cd24f99370a3"
const FROM = "Lit"
const TO = "Stage Lit"

const renamed = (payload) =>
  payload?.graph?.name === FROM ? { ...payload, graph: { ...payload.graph, name: TO } } : null

const item = (await pool.query(`select id, name, name_zh, payload from library_items where id = $1`, [ID])).rows[0]
const taken = (await pool.query(`select count(*)::int n from library_items where kind = 'graph' and lower(name) = lower($1) and deleted_at is null`, [TO])).rows[0].n
const versions = (await pool.query(`select version, payload from library_item_versions where item_id = $1`, [ID])).rows
const fixes = versions.map((v) => [v.version, renamed(v.payload)]).filter(([, p]) => p)
console.log(`${item.name} (${item.name_zh}) → ${TO}; payload graph name: ${item.payload?.graph?.name}; versions to rename: ${fixes.length}/${versions.length}`)
if (item.name !== FROM) throw new Error(`row is named ${item.name}, not ${FROM}`)
if (taken) throw new Error(`a graph named ${TO} already exists`)

if (!WRITE) console.log("Dry run. Re-run with --write to apply.")
else {
  await pool.query(`update library_items set name = $2, payload = $3 where id = $1`, [ID, TO, renamed(item.payload) ?? item.payload])
  for (const [version, payload] of fixes)
    await pool.query(`update library_item_versions set payload = $3 where item_id = $1 and version = $2`, [ID, version, payload])
  console.log("Written. Now: npm run db:refresh")
}
await pool.end()
