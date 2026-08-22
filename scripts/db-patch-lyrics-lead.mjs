// Drop the Lyrics effect's LEAD offset to zero, everywhere it is already published.
//
//   node --env-file=.env.local scripts/db-patch-lyrics-lead.mjs
//   node --env-file=.env.local scripts/db-patch-lyrics-lead.mjs --write
//
// DRY RUN by default.
//
// LEAD pushed the subtitle 0.3s ahead of the audio clock. That was never a
// typographic choice — it was covering an audio start offset, and that bug is
// fixed, so the compensation is now the thing putting the words out of time.
//
// THIS CANNOT BE A RESEED. db-seed.mjs upserts library_items.payload, so the
// latest Lyrics payload would pick the new value up — but its version insert is
// `on conflict do nothing`, deliberately, because re-running a seed must never
// rewrite a version a published scene is pinned to. Scenes pin { id, version },
// so seeding alone fixes the library card and leaves every published scene
// still 0.3s early. Reaching into the version rows is the whole point of this
// script existing separately, and is why it is a deliberate step rather than
// something the seed does quietly.
//
// SCOPED TO THE BUILT-IN. A fork is someone else's copy, and this is a tuning
// change rather than a breakage — an effect at 0.3 still compiles and still
// runs. Forks are counted and named below so the number is visible, never
// written to. That is the difference between this and db-patch-effect-api,
// which rewrote everything because the alternative was code that would not
// compile at all.

import { readFileSync } from "node:fs"
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

const LYRICS_ID = "bb01274d-1706-455b-bb5f-831c51b02131"

// The declaration and the comment lines aligned under it — one tunable block, so
// the DB ends up with the repo's current wording rather than a patched value
// under a comment still explaining the old one. Stops at the next declaration
// because that line does not start with `//`.
const BLOCK = /const LEAD = [\d.]+;[^\n]*\n(?:[ \t]*\/\/[^\n]*\n)*/

const builtins = JSON.parse(readFileSync(new URL("../content/effects.json", import.meta.url), "utf8"))
const repo = builtins.find((e) => e.id === LYRICS_ID)
if (!repo) throw new Error(`Lyrics (${LYRICS_ID}) is not in content/effects.json`)
const replacement = repo.payload?.wgsl?.match(BLOCK)?.[0]
if (!replacement) throw new Error("no LEAD block in the repo's Lyrics wgsl — has the tunable been renamed?")
if (!/const LEAD = 0(\.0+)?;/.test(replacement)) {
  throw new Error(`the repo's LEAD is not zero yet:\n${replacement}`)
}
console.log(`repo block:\n${replacement.trimEnd()}\n`)

/** null when the payload is already what the repo says. */
const patch = (payload) => {
  const wgsl = payload?.wgsl
  if (typeof wgsl !== "string") return null
  const found = wgsl.match(BLOCK)
  if (!found || found[0] === replacement) return null
  return { payload: { ...payload, wgsl: wgsl.replace(BLOCK, replacement) }, was: found[0].split("\n")[0].trim() }
}

const item = (await pool.query(`select id, name, payload from library_items where id = $1`, [LYRICS_ID])).rows[0]
const versions = (
  await pool.query(`select item_id, version, payload from library_item_versions where item_id = $1 order by version`, [
    LYRICS_ID,
  ])
).rows

if (!item) {
  console.log("Lyrics is not published yet — run db:seed first, then this.")
  await pool.end()
  process.exit(0)
}

const itemFix = patch(item.payload)
const versionFixes = versions.map((v) => ({ v, fix: patch(v.payload) })).filter((x) => x.fix)

console.log(`LATEST payload: ${itemFix ? `patch — ${itemFix.was}` : "already current"}`)
console.log(`PINNED versions: ${versionFixes.length} of ${versions.length} need a patch`)
for (const { v, fix } of versionFixes) console.log(`  v${v.version} — ${fix.was}`)

// Forks and inline copies: reported so the count is known, never written.
const others = (
  await pool.query(
    `select id, name, author, kind from library_items
      where kind = 'effect' and id <> $1 and payload->>'wgsl' like '%const LEAD = 0.3%'`,
    [LYRICS_ID],
  )
).rows
console.log(`\nforks still on the old lead (NOT touched): ${others.length}`)
for (const o of others) console.log(`  ${o.name} · ${o.author}`)

const scenes = (
  await pool.query(
    `select id, name, author from library_items
      where kind = 'scene' and payload::text like '%const LEAD = 0.3%'`,
  )
).rows
console.log(`\nscenes carrying an INLINE copy (NOT touched): ${scenes.length}`)
for (const s of scenes) console.log(`  ${s.name} · ${s.author}`)

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
} else {
  if (itemFix) {
    await pool.query(`update library_items set payload = $1::jsonb, updated_at = now() where id = $2`, [
      JSON.stringify(itemFix.payload),
      LYRICS_ID,
    ])
  }
  for (const { v, fix } of versionFixes) {
    await pool.query(`update library_item_versions set payload = $1::jsonb where item_id = $2 and version = $3`, [
      JSON.stringify(fix.payload),
      v.item_id,
      v.version,
    ])
  }
  console.log(`\npatched ${itemFix ? 1 : 0} payload and ${versionFixes.length} version(s)`)
}

await pool.end()
