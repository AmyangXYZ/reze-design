// Wrap published scenes' effect entries in their new shape.
//
//   node --env-file=.env.local scripts/db-patch-scene-effect-entries.mjs
//   node --env-file=.env.local scripts/db-patch-scene-effect-entries.mjs --write
//
// DRY RUN by default.
//
// An entry used to BE the source — a pin, a snapshot, or a built-in's name. It
// could not stay that way once an effect could be scheduled or dialled down: a
// pin is a reference to somebody else's published effect, and the timing
// belongs to THIS scene's use of it. So an entry is `{ source, influence?,
// window? }` now, and a reader handed a bare source drops it rather than
// reaching into a string for `.source` and taking the whole page down.
//
// Dropping it is right for a reader and wrong for a library: every scene
// published before the change lost every effect it had. This restores them —
// the source moves inside the wrapper untouched, and nothing else is added,
// because a scene that was never scheduled has nothing to say about timing.
//
// ORDER MATTERS, the opposite way round from the directive patch. The wrapped
// form is only legible to the build that expects it, so this runs AFTER that
// build is live — which is also when the breakage it fixes becomes visible.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

/** Already wrapped? Anything with a `source` key is this shape and is left be,
 *  so the script is safe to run twice. */
const wrapped = (e) => e !== null && typeof e === "object" && "source" in e
/** The three forms an entry could take before: a built-in's name, a pin, or a
 *  by-value snapshot. All of them move inside `source` unchanged. */
const isSource = (e) =>
  typeof e === "string" || (e !== null && typeof e === "object" && ("id" in e || ("name" in e && "wgsl" in e)))

const migrate = (doc) => {
  const list = doc?.settings?.background?.effects
  if (!Array.isArray(list) || list.length === 0) return null
  if (list.every(wrapped)) return null
  // A shape this does not recognise is left EXACTLY as it is and reported. It
  // will read as no effect, which is the same as now — where guessing could
  // put something else in the scene instead.
  const unknown = list.filter((e) => !wrapped(e) && !isSource(e))
  const next = list.map((e) => (wrapped(e) || !isSource(e) ? e : { source: e }))
  return { next, unknown, n: next.length - list.filter(wrapped).length }
}

const rows = (await pool.query(`select id, name, author, payload from library_items where kind='scene'`)).rows
const versions = (
  await pool.query(
    `select v.item_id, v.version, v.payload, i.name
       from library_item_versions v join library_items i on i.id = v.item_id
      where i.kind = 'scene'`,
  )
).rows

const fixes = []
for (const r of rows) {
  const m = migrate(r.payload?.doc)
  if (!m) continue
  const payload = { ...r.payload, doc: { ...r.payload.doc, settings: { ...r.payload.doc.settings, background: { ...r.payload.doc.settings.background, effects: m.next } } } }
  fixes.push({ kind: "item", r, payload, m })
}
const vFixes = []
for (const v of versions) {
  const m = migrate(v.payload?.doc)
  if (!m) continue
  const payload = { ...v.payload, doc: { ...v.payload.doc, settings: { ...v.payload.doc.settings, background: { ...v.payload.doc.settings.background, effects: m.next } } } }
  vFixes.push({ v, payload, m })
}

console.log(`scenes ${rows.length} · versions ${versions.length}`)
console.log(`\nscenes to wrap: ${fixes.length}`)
for (const f of fixes) {
  const u = f.m.unknown.length ? `  ⚠ ${f.m.unknown.length} unrecognised, left alone` : ""
  console.log(`  ${String(f.r.name).padEnd(26)} ${String(f.r.author).padEnd(13)} ${f.m.n} effect(s)${u}`)
}
console.log(`versions to wrap: ${vFixes.length}`)

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
} else {
  for (const f of fixes) {
    await pool.query(`update library_items set payload = $1::jsonb where id = $2`, [JSON.stringify(f.payload), f.r.id])
  }
  for (const f of vFixes) {
    await pool.query(`update library_item_versions set payload = $1::jsonb where item_id = $2 and version = $3`, [
      JSON.stringify(f.payload),
      f.v.item_id,
      f.v.version,
    ])
  }
  console.log(`\nwrapped ${fixes.length} scene(s) and ${vFixes.length} version(s)`)
}

await pool.end()
