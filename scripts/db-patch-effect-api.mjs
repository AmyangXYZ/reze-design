// Bring published effect WGSL up to the current engine API.
//
//   node --env-file=.env.local scripts/db-patch-effect-api.mjs
//   node --env-file=.env.local scripts/db-patch-effect-api.mjs --write
//
// DRY RUN by default.
//
// The engine renamed the score interface to say what it reads — a MIDI file —
// so `rzScoreTime` and its siblings no longer exist. A published effect calling
// one does not degrade, it fails to COMPILE, and an effect that fails to compile
// is a blank card in the library and a missing layer in every scene pinned to it.
//
// VERSIONS ARE PATCHED TOO. A scene pins the exact version it used, so fixing
// only the latest payload would leave every existing scene rendering the broken
// one — the pin is the whole reason versions are kept, and it is also why this
// has to reach into them.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

/** Retired name -> current name. Word-boundaried, so rzScoreTimeSomething (if
 *  anyone ever wrote one) is left alone rather than half-renamed. */
const RENAMES = [
  ["rzScoreTime", "rzMidiTime"],
  ["rzScorePlaying", "rzMidiPlaying"],
  ["rzScoreDuration", "rzMidiDuration"],
]

const migrate = (wgsl) => {
  let out = wgsl
  const hits = []
  for (const [from, to] of RENAMES) {
    const re = new RegExp(`\\b${from}\\b`, "g")
    const n = (out.match(re) ?? []).length
    if (n) {
      hits.push(`${from} -> ${to} (${n})`)
      out = out.replace(re, to)
    }
  }
  return { out, hits }
}

const items = (await pool.query(`select id, name, author, payload from library_items where kind = 'effect'`)).rows
const versions = (
  await pool.query(
    `select v.item_id, v.version, v.payload, i.name, i.kind
       from library_item_versions v join library_items i on i.id = v.item_id
      where i.kind = 'effect'`,
  )
).rows

const itemFixes = []
for (const r of items) {
  const wgsl = r.payload?.wgsl
  if (typeof wgsl !== "string") continue
  const { out, hits } = migrate(wgsl)
  if (hits.length) itemFixes.push({ r, payload: { ...r.payload, wgsl: out }, hits })
}

const versionFixes = []
for (const v of versions) {
  const wgsl = v.payload?.wgsl
  if (typeof wgsl !== "string") continue
  const { out, hits } = migrate(wgsl)
  if (hits.length) versionFixes.push({ v, payload: { ...v.payload, wgsl: out }, hits })
}

console.log(`effects: ${items.length}   versions: ${versions.length}`)
console.log(`\nLATEST payloads needing a patch: ${itemFixes.length}`)
for (const f of itemFixes) console.log(`  ${f.r.name} · ${f.r.author} — ${f.hits.join(", ")}`)
console.log(`\nPINNED versions needing a patch: ${versionFixes.length}`)
for (const f of versionFixes) console.log(`  ${f.v.name} v${f.v.version} — ${f.hits.join(", ")}`)

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
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
