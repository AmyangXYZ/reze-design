// Strip the dead `version` out of every pin inside a published scene.
//
//   node --env-file=.env.local scripts/db-patch-drop-pin-versions.mjs
//   node --env-file=.env.local scripts/db-patch-drop-pin-versions.mjs --write
//
// DRY RUN by default.
//
// A pin is `{ id }` now and resolves to the item as it currently stands. Every
// document published before that still carries `{ id, version }`, and it still
// works: isItemRef keys on the id and the version is simply read past, which is
// why nothing had to be migrated to ship the change. This is housekeeping, not
// a fix — the number is inert, and a stored number that means nothing is one
// somebody eventually tries to interpret.
//
// RUN IT AFTER THE DEPLOY, never before. The reverse order breaks every scene
// it touches: the build that is live until then requires `version` to be present
// to recognise a pin at all, so a stripped pin reads as an effect snapshot with
// no WGSL, or as a shader graph with no nodes.
//
// Three places carry one, and they are the three sceneRefs() reads:
//   settings.background.effects[]                  each layered effect
//   settings.grade.from                            the grade
//   assets.models[].materials.groups[].graph       each styled group
// Anything else in a document is a path, a number or a value — no other shape in
// here has an id, which is why this walks named paths instead of hunting for the
// pair anywhere it appears.
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const WRITE = process.argv.includes("--write")
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

/** A pin, as opposed to an inlined value: an object with an id and no content
 *  of its own. A ShaderGraph has `nodes`, an effect snapshot has `wgsl`. */
const isPin = (v) => !!v && typeof v === "object" && typeof v.id === "string" && !("nodes" in v) && !("wgsl" in v)

/** Returns true when it took a version off this pin. */
function strip(v) {
  if (!isPin(v) || !("version" in v)) return false
  delete v.version
  return true
}

const { rows } = await pool.query(
  `select id, name, author, payload from library_items where kind = 'scene' order by created_at`,
)

const edits = []
for (const row of rows) {
  const doc = structuredClone(row.payload?.doc)
  if (!doc) continue
  let n = 0

  for (const e of doc.settings?.background?.effects ?? []) if (strip(e)) n++
  if (strip(doc.settings?.grade?.from)) n++
  for (const m of doc.assets?.models ?? []) for (const g of m.materials?.groups ?? []) if (strip(g.graph)) n++

  if (n > 0) edits.push({ row, doc, n })
}

console.log(`\n${WRITE ? "APPLYING" : "DRY RUN"} — ${rows.length} published scene(s)\n`)
console.log(`scenes carrying a version on a pin: ${edits.length}`)
for (const e of edits) console.log(`  "${e.row.name}" by ${e.row.author} — ${e.n} pin(s)`)
console.log(`\ntotal pins to clean: ${edits.reduce((a, e) => a + e.n, 0)}`)

if (!WRITE) {
  console.log("\nNothing written. Re-run with --write to apply.")
  await pool.end()
  process.exit(0)
}

// jsonb_set on {doc} rather than replacing the payload: a scene's payload is
// only ever { doc }, but writing the whole column would make this script the
// authority on a shape it has no business knowing.
for (const e of edits) {
  await pool.query(`update library_items set payload = jsonb_set(payload, '{doc}', $1::jsonb) where id = $2`, [
    JSON.stringify(e.doc),
    e.row.id,
  ])
}
console.log(`\nwrote: ${edits.length} scene(s)`)
await pool.end()
