// Bring published effect WGSL onto the `#` directive syntax.
//
//   node --env-file=.env.local scripts/db-patch-hash-directives.mjs
//   node --env-file=.env.local scripts/db-patch-hash-directives.mjs --write
//
// DRY RUN by default.
//
// Directives used to be comments — `// @particles 5000` — read by eight
// separate regexes scattered across the engine. They are real syntax now, one
// grammar and one parser, and the old form parses as what it always looked
// like: a comment. An effect carrying it does not fail to compile, which is
// worse than if it did — it installs, and quietly draws with no particles, no
// anchors and no lights.
//
// `@fullres` has no replacement because full resolution is now what you get for
// saying nothing. Its line is kept as prose rather than dropped: authors wrote
// a sentence after it explaining why their effect needed the resolution, and
// that sentence is still true.
//
// VERSIONS ARE PATCHED TOO. A scene pins the exact version it used, so fixing
// only the latest payload would leave every existing scene rendering the
// unpatched one — the pin is the whole reason versions are kept, and it is also
// why this has to reach into them.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

/** Every directive the engine reads. Anything else after `// @` is somebody's
 *  prose and is left exactly as it is. */
const TAGS = ["anchor", "param", "halfres", "layer", "blend", "particles", "lights", "grid", "bloom", "dissolve"]

const migrate = (wgsl) => {
  const hits = []
  const out = wgsl
    .split("\n")
    .map((line) => {
      // ONLY A LINE THAT IS the directive. `// @anchor` mid-sentence was never
      // read as one by the engine either, and promoting it now would turn a
      // sentence about an effect into a declaration by it.
      const m = /^([ \t]*)\/\/[ \t]*@([a-zA-Z]+)([ \t].*)?$/.exec(line)
      if (!m) return line
      const [, indent, tag, rest = ""] = m
      // Retired: full resolution is the default now, so the flag says nothing.
      // The line stays as a comment because the words after it still mean
      // something to whoever reads the source.
      if (tag === "fullres") {
        hits.push("@fullres -> comment")
        return `${indent}//${rest ? rest.replace(/^[ \t]*[—-]?[ \t]*/, " ") : " full resolution — now the default"}`
      }
      if (!TAGS.includes(tag)) return line
      hits.push(`@${tag} -> #${tag}`)
      return `${indent}#${tag}${rest}`
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
for (const f of itemFixes) console.log(`  ${f.r.name} · ${f.r.author} — ${[...new Set(f.hits)].join(", ")}`)
console.log(`\nPINNED versions needing a patch: ${versionFixes.length}`)
for (const f of versionFixes) console.log(`  ${f.v.name} v${f.v.version} — ${[...new Set(f.hits)].join(", ")}`)

// Anything still carrying a `// @` line the engine never read — somebody's own
// tag, or a typo for a real one. Reported, never rewritten: guessing at what an
// author meant is how a patch breaks the effect it came to fix.
const leftovers = []
for (const r of items) {
  const wgsl = itemFixes.find((f) => f.r.id === r.id)?.payload.wgsl ?? r.payload?.wgsl
  if (typeof wgsl !== "string") continue
  for (const m of wgsl.matchAll(/^[ \t]*\/\/[ \t]*@([a-zA-Z]+)/gm)) leftovers.push(`${r.name}: @${m[1]}`)
}
if (leftovers.length) {
  console.log(`\nUNRECOGNISED, left alone — check these by hand:`)
  for (const l of [...new Set(leftovers)]) console.log(`  ${l}`)
}

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
