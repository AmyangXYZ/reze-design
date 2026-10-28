// Bring published scene documents to format 2: every model and every style
// group carries its id, and a group its pass fields (lib/scene-upgrade.ts).
//
//   npx esbuild scripts/db-patch-scene-ids.ts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --external:@neondatabase/serverless --external:ws --outfile=node_modules/.cache/db-patch-scene-ids.mjs --log-level=warning
//   node --env-file=.env.local node_modules/.cache/db-patch-scene-ids.mjs            # dry run
//   node --env-file=.env.local node_modules/.cache/db-patch-scene-ids.mjs --write    # format 2, role kept
//   node --env-file=.env.local node_modules/.cache/db-patch-scene-ids.mjs --finish   # role dropped
//   npm run db:refresh                                                                # after either
//
// TWO STEPS, so no published link breaks on the way. Format 1's reader takes a
// group's pass from `role` and ignores the ids; format 2's reads the ids and
// ignores `role`. `--write` writes format 2 and leaves each group's `role`
// beside it, which both read. `--finish`, once the format-2 reader is live,
// takes `role` out. `--write` again before it catches anything a format-1 tab
// published in between.
//
// The ids written are the ones each scene has been opening with, so every link
// renders as it did, except where a group's own graph states the blend format 1
// dropped (Glass, a glTF stage's light sheets, fresnel glows and additive effect
// sheets), which now draw as they did in the editor that published them.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { upgradeSceneDoc, type V1SceneDoc } from "@/lib/scene-upgrade"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")
const FINISH = process.argv.includes("--finish")

type Groups = { role?: string }[]
const groupsOf = (doc: V1SceneDoc) => doc.assets.models.map((m) => (m.materials?.groups ?? []) as Groups)

const { rows } = await pool.query(`select id, name, author, payload from library_items where kind = 'scene' order by created_at`)

const patched: { id: string; name: string; author: string; payload: { doc: unknown } }[] = []
let blends = 0
for (const row of rows) {
  const before = row.payload?.doc as V1SceneDoc | undefined
  if (!before?.assets?.models) {
    console.log(`  ${row.name}: unrecognised payload shape, skipped`)
    continue
  }
  if (FINISH) {
    if (before.version < 2) {
      console.log(`  ${row.name} · ${row.author}: still format 1, run --write first`)
      continue
    }
    const doc = structuredClone(before)
    const roles = groupsOf(doc).flat().filter((g) => "role" in g)
    if (!roles.length) continue
    for (const g of roles) delete g.role
    console.log(`  ${row.name} · ${row.author}: ${roles.length} role(s) dropped`)
    patched.push({ ...row, payload: { ...row.payload, doc } })
    continue
  }
  if (before.version >= 2) continue
  const doc = upgradeSceneDoc(before)
  // The deployed format-1 reader's field, kept until --finish.
  const kept = groupsOf(before)
  groupsOf(doc as unknown as V1SceneDoc).forEach((gs, m) => gs.forEach((g, i) => kept[m][i].role && (g.role = kept[m][i].role)))
  const notes = doc.assets.models.flatMap((m) =>
    (m.materials?.groups ?? []).filter((g) => g.blend).map((g) => `${m.id} · ${g.label ?? g.id}: blend ${g.blend}`),
  )
  blends += notes.length
  console.log(`  ${row.name} · ${row.author}  [${doc.assets.models.map((m) => m.id).join(", ")}]`)
  for (const n of notes) console.log(`      ${n}`)
  patched.push({ ...row, payload: { ...row.payload, doc } })
}

console.log(`\nscenes: ${rows.length}   to patch: ${patched.length}${FINISH ? "" : `   blends restored: ${blends}`}`)

if (!WRITE && !FINISH) {
  console.log("\nDry run. --write applies format 2 (role kept); --finish drops role once the new reader is live. Then npm run db:refresh.")
} else if (patched.length === 0) {
  console.log("\nNothing to patch.")
} else {
  for (const p of patched) await pool.query(`update library_items set payload = $1::jsonb where id = $2`, [JSON.stringify(p.payload), p.id])
  console.log(`\npatched ${patched.length} scene(s). Now npm run db:refresh.`)
}

await pool.end()
