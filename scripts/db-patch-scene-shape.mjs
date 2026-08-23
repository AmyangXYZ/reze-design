// Bring published scene documents up to the current shape.
//
//   node --env-file=.env.local scripts/db-patch-scene-shape.mjs
//   node --env-file=.env.local scripts/db-patch-scene-shape.mjs --write
//
// DRY RUN by default. These are other people's published scenes, and a link
// that stops rendering what it rendered yesterday is worse than an old field.
//
// Two changes, both making implicit things explicit:
//
//   1. background.effect  ->  background.effects[]
//      The reader now takes the LIST only; the single-field fallback is gone.
//      A document still carrying `effect` therefore opens with no effect at
//      all — silently, because an absent effect looks exactly like a scene that
//      never had one.
//
//   2. assets.midi / assets.lyrics written as null where absent.
//      These used to be found by pairing filenames with the track. They are
//      named by the document now, and a document that names them — even as
//      null — is one nobody has to guess about.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

const { rows } = await pool.query(
  `select id, name, author, payload from library_items where kind = 'scene' order by created_at`,
)

const patched = []
for (const row of rows) {
  const doc = row.payload
  // A scene payload is the LibraryPayload wrapper: { doc: SceneDoc }.
  const scene = doc?.doc ?? doc
  const bg = scene?.settings?.background
  const assets = scene?.assets
  if (!bg || !assets) {
    console.log(`  ${row.name} — unrecognised payload shape, skipped`)
    continue
  }
  const changes = []
  if (bg.effect && !Array.isArray(bg.effects)) {
    changes.push(`effect -> effects[1] (${bg.effect?.name ?? "unnamed"})`)
    bg.effects = [bg.effect]
    delete bg.effect
  }
  if (!("midi" in assets)) {
    assets.midi = null
    changes.push("midi: null")
  }
  if (!("lyrics" in assets)) {
    assets.lyrics = null
    changes.push("lyrics: null")
  }
  if (changes.length) patched.push({ row, doc, changes })
}

console.log(`scenes: ${rows.length}   needing a patch: ${patched.length}\n`)
for (const p of patched) {
  console.log(`  ${p.row.name}  ·  ${p.row.author}`)
  for (const c of p.changes) console.log(`      ${c}`)
}

if (!WRITE) {
  console.log("\nDry run. Re-run with --write to apply.")
} else if (patched.length === 0) {
  console.log("\nNothing to patch.")
} else {
  for (const p of patched) {
    await pool.query(`update library_items set payload = $1::jsonb where id = $2`, [JSON.stringify(p.doc), p.row.id])
  }
  console.log(`\npatched ${patched.length} scene(s)`)
}

await pool.end()
