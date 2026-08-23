// Which published effects is nothing using?
//
//   node --env-file=.env.local scripts/db-audit-unused-effects.mjs
//   node --env-file=.env.local scripts/db-audit-unused-effects.mjs --delete
//
// DRY RUN by default. Deleting published work is irreversible and the work is
// other people's, so the report has to be read before the delete is run.
//
// "Unused" needs TWO independent signals, because the two ways a scene can
// carry an effect are recorded differently:
//
//   1. scene_uses — the join written at publish time for a PINNED reference.
//   2. the scene payload itself — an effect applied from a draft travels BY
//      VALUE, so nothing joins and the only trace is the id or the WGSL sitting
//      inside the document.
//
// An item has to be missing from both to count as unused. Trusting the join
// alone would delete effects that published scenes are visibly running.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const DELETE = process.argv.includes("--delete")
// Only OTHER PEOPLE'S effects are candidates. The app's own published effects
// are the library copies of what it ships, so "no scene applies it" says
// nothing about whether it should exist — deleting those would pull the
// built-ins out of the public library.
const OWN = "amyang-xyz"

const { rows: effects } = await pool.query(
  `select id, name, author, visibility, like_count, created_at
     from library_items
    where kind = 'effect'
    order by created_at`,
)

const { rows: used } = await pool.query(
  `select distinct item_id from scene_uses`,
)
const pinned = new Set(used.map((r) => r.item_id))

// Every published scene's document, as text — one scan, then a substring test
// per effect. A scene is any library item of kind 'scene'.
const { rows: scenes } = await pool.query(
  `select id, name, payload::text as doc from library_items where kind = 'scene'`,
)

const report = effects.map((e) => {
  const inDocs = scenes.filter((s) => s.doc.includes(e.id)).map((s) => s.name)
  return { ...e, pinned: pinned.has(e.id), inDocs }
})

const unused = report.filter((e) => !e.pinned && e.inDocs.length === 0 && e.author !== OWN)
const keep = report.filter((e) => !unused.includes(e))

console.log(`published effects: ${effects.length}   scenes scanned: ${scenes.length}\n`)
console.log(`IN USE (${keep.length}) — kept:`)
for (const e of keep) {
  const why = [e.pinned ? "pinned" : null, e.inDocs.length ? `in ${e.inDocs.length} scene doc(s)` : null]
    .filter(Boolean)
    .join(" + ")
  console.log(`  ${e.name}  ·  ${e.author}  ·  ${why}`)
}

console.log(`\nUNUSED (${unused.length}) — ${DELETE ? "DELETING" : "would delete"}:`)
for (const e of unused) {
  console.log(
    `  ${e.name}  ·  ${e.author}  ·  ${e.visibility}  ·  ${e.like_count} like(s)  ·  ${e.id}`,
  )
}

if (!DELETE) {
  console.log("\nDry run. Re-run with --delete to remove the unused list above.")
} else if (unused.length === 0) {
  console.log("\nNothing to delete.")
} else {
  const ids = unused.map((e) => e.id)
  // Versions cascade from library_items; scene_uses rows cannot exist for these
  // by definition, since that is what made them unused.
  const res = await pool.query(`delete from library_items where id = any($1::text[])`, [ids])
  console.log(`\ndeleted ${res.rowCount} item(s)`)
}

await pool.end()
