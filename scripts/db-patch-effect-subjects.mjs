// Let the stock effects that capped the cast at four reach all of it.
//
//   node --env-file=.env.local scripts/db-patch-effect-subjects.mjs
//   node --env-file=.env.local scripts/db-patch-effect-subjects.mjs --write
//   npm run db:refresh
//
// DRY RUN by default.
//
// reze-engine 0.70.1 gives effects eight characters where they had four. These
// effects wrote the old ceiling into their own code, so they kept drawing four:
// Laser Eyes, Laser Stare and CS looped to min(rzSubjectCount(), 4), and
// Aemeath Footprint kept one particle per character in a pool of four. The
// loops go to the count; the footprint's pool and clamp go to eight.
//
// Only the stock account's own effects, by id. Another maker's effect with the
// same cap is theirs to change.
//
// VERSIONS ARE PATCHED TOO, for the reason db-patch-effect-api.mjs gives: a
// scene pins the version it used.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

const IDS = [
  "3cf2f107-bcd7-5737-930b-ce4098dedbfe", // Laser Eyes
  "036f5b2a-b8c4-5c9a-ac62-02c5f1edefc0", // Laser Stare
  "ec836b40-4145-478c-9dc2-c2787c72e63e", // CS
  "31ac6063-d02a-4032-b44d-d42081478a88", // Aemeath Footprint
]

/** [pattern, replacement], each literal. */
const EDITS = [
  ["min(rzSubjectCount(), 4)", "rzSubjectCount()"],
  ["clamp(rzSubjectCount(), 0, 4)", "clamp(rzSubjectCount(), 0, 8)"],
  ["#particles 4\n", "#particles 8\n"],
]

const migrate = (wgsl) => {
  let out = wgsl.replace(/\r\n/g, "\n")
  const crlf = wgsl.includes("\r\n")
  const hits = []
  for (const [from, to] of EDITS) {
    const n = out.split(from).length - 1
    if (n) {
      hits.push(`${from.trim()} -> ${to.trim()} (${n})`)
      out = out.split(from).join(to)
    }
  }
  return { out: crlf ? out.replace(/\n/g, "\r\n") : out, hits }
}

const items = (await pool.query(`select id, name, author, payload from library_items where id = any($1::text[])`, [IDS])).rows
const versions = (
  await pool.query(
    `select v.item_id, v.version, v.payload, i.name
       from library_item_versions v join library_items i on i.id = v.item_id
      where v.item_id = any($1::text[])`,
    [IDS],
  )
).rows

const itemFixes = []
for (const r of items) {
  if (typeof r.payload?.wgsl !== "string") continue
  const { out, hits } = migrate(r.payload.wgsl)
  if (hits.length) itemFixes.push({ r, payload: { ...r.payload, wgsl: out }, hits })
}
const versionFixes = []
for (const v of versions) {
  if (typeof v.payload?.wgsl !== "string") continue
  const { out, hits } = migrate(v.payload.wgsl)
  if (hits.length) versionFixes.push({ v, payload: { ...v.payload, wgsl: out }, hits })
}

console.log(`items found: ${items.length}/${IDS.length}   versions: ${versions.length}`)
console.log(`\nLATEST payloads: ${itemFixes.length}`)
for (const f of itemFixes) console.log(`  ${f.r.name} · ${f.r.author} — ${f.hits.join(", ")}`)
console.log(`\nPINNED versions: ${versionFixes.length}`)
for (const f of versionFixes) console.log(`  ${f.v.name} v${f.v.version} — ${f.hits.join(", ")}`)

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply, then npm run db:refresh.")
} else {
  for (const f of itemFixes) {
    await pool.query(`update library_items set payload = $1::jsonb where id = $2`, [JSON.stringify(f.payload), f.r.id])
  }
  for (const f of versionFixes) {
    await pool.query(`update library_item_versions set payload = $1::jsonb where item_id = $2 and version = $3`, [
      JSON.stringify(f.payload),
      f.v.item_id,
      f.v.version,
    ])
  }
  console.log(`\npatched ${itemFixes.length} payload(s) and ${versionFixes.length} version(s)`)
}

await pool.end()
