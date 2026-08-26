// Put published effect WGSL back on the `// @` directive syntax.
//
//   node --env-file=.env.local scripts/db-unpatch-hash-directives.mjs
//   node --env-file=.env.local scripts/db-unpatch-hash-directives.mjs --write
//
// DRY RUN by default. The inverse of db-patch-hash-directives, for the window
// between patching the database and shipping the build that can read it.
//
// THE ORDER MATTERS AND IT IS NOT SYMMETRIC. `// @particles 5000` on an engine
// that has never heard of it is a comment — the effect installs and draws
// without particles, which is wrong but alive. `#particles 5000` on that same
// engine is not a comment and not WGSL: the shader fails to compile, the effect
// is a blank card in the library, and every scene pinned to it renders a layer
// short. So the database may only move to `#` once the deployment can strip it.
//
// `@fullres` is NOT restored. It was rewritten to prose, and prose is what it
// should have been — the flag means nothing now that full resolution is the
// default. On the older engine those effects render at half resolution until
// the deploy lands, which is a soft edge on a glyph rather than a broken card.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

const TAGS = ["anchor", "param", "halfres", "layer", "blend", "particles", "lights", "grid", "bloom", "dissolve", "duration"]

const revert = (wgsl) => {
  const hits = []
  const out = wgsl
    .split("\n")
    .map((line) => {
      const m = /^([ \t]*)#([a-zA-Z]+)([ \t].*)?$/.exec(line)
      if (!m) return line
      const [, indent, tag, rest = ""] = m
      if (!TAGS.includes(tag)) return line
      hits.push(`#${tag} -> // @${tag}`)
      return `${indent}// @${tag}${rest}`
    })
    .join("\n")
  return { out, hits }
}

const items = (await pool.query(`select id, name, author, payload from library_items where kind = 'effect'`)).rows
const versions = (
  await pool.query(
    `select v.item_id, v.version, v.payload, i.name
       from library_item_versions v join library_items i on i.id = v.item_id
      where i.kind = 'effect'`,
  )
).rows

const itemFixes = []
for (const r of items) {
  const wgsl = r.payload?.wgsl
  if (typeof wgsl !== "string") continue
  const { out, hits } = revert(wgsl)
  if (hits.length) itemFixes.push({ r, payload: { ...r.payload, wgsl: out }, hits })
}
const versionFixes = []
for (const v of versions) {
  const wgsl = v.payload?.wgsl
  if (typeof wgsl !== "string") continue
  const { out, hits } = revert(wgsl)
  if (hits.length) versionFixes.push({ v, payload: { ...v.payload, wgsl: out }, hits })
}

console.log(`latest payloads to revert: ${itemFixes.length}   pinned versions: ${versionFixes.length}`)
for (const f of itemFixes) console.log(`  ${f.r.name} · ${f.r.author} — ${[...new Set(f.hits)].join(", ")}`)

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
  console.log(`\nreverted ${itemFixes.length} payload(s) and ${versionFixes.length} version(s)`)
}

await pool.end()
