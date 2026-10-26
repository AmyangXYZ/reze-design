// Candle Flames (wick bones): no line across the card at the flame's foot.
//
//   node --env-file=.env.local scripts/db-patch-candle-foot.mjs
//   node --env-file=.env.local scripts/db-patch-candle-foot.mjs --write
//
// DRY RUN by default. Then `npm run db:refresh`.
//
// At y = 0 the teardrop's half-width is exactly 0, and smoothstep(0, 0, x) is
// undefined in WGSL: on Apple GPUs it reads as inside, so the card's bottom
// row drew a dotted line wider than the candle. The foot is cut at y = 0 and
// the half-width never reaches zero. Pinned versions are patched too.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")
const ID = "f2069c55-bf31-4ce7-9cde-c815417712a2"

const EDITS = [
  ["  if (y >= 1.0) { return vec4f(0.0); }", "  if (y <= 0.0 || y >= 1.0) { return vec4f(0.0); }"],
  [
    "  let edge = sqrt(y) * pow(1.0 - y, 1.5) / 0.325 * (1.0 - 0.06 * params.FLICKER * life.x);",
    "  let edge = max(sqrt(y) * pow(1.0 - y, 1.5) / 0.325 * (1.0 - 0.06 * params.FLICKER * life.x), 1e-4);",
  ],
]

const patch = (wgsl) => {
  let out = wgsl
  for (const [from, to] of EDITS) if (out.includes(from)) out = out.replace(from, to)
  return out === wgsl ? null : out
}

const item = (await pool.query(`select id, name, payload from library_items where id = $1`, [ID])).rows[0]
const versions = (await pool.query(`select version, payload from library_item_versions where item_id = $1`, [ID])).rows
const fixes = []
const latest = patch(item.payload.wgsl)
if (latest) fixes.push(["latest", { ...item.payload, wgsl: latest }])
for (const v of versions) {
  const out = typeof v.payload?.wgsl === "string" ? patch(v.payload.wgsl) : null
  if (out) fixes.push([v.version, { ...v.payload, wgsl: out }])
}
console.log(`${item.name}: ${fixes.length} payload(s) to patch — ${fixes.map((f) => f[0]).join(", ") || "none"}`)

if (!WRITE) console.log("Dry run. Re-run with --write to apply.")
else {
  for (const [which, payload] of fixes) {
    if (which === "latest") await pool.query(`update library_items set payload = $2 where id = $1`, [ID, payload])
    else await pool.query(`update library_item_versions set payload = $3 where item_id = $1 and version = $2`, [ID, which, payload])
  }
  console.log("Written. Now: npm run db:refresh")
}
await pool.end()
