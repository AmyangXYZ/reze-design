// One-time patch: stamp the engine's stock orbit angles (alpha = π, beta = π/2.5)
// into every published scene doc written before SceneCamera required them.
// Idempotent — only touches docs where the field is absent. Run with:
//   DATABASE_URL=... node scripts/db-patch-camera-angles.mjs
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const ALPHA = Math.PI
const BETA = Math.PI / 2.5

const patch = async (table, whereKind) => {
  for (const [field, value] of [
    ["alpha", ALPHA],
    ["beta", BETA],
  ]) {
    const { rowCount } = await pool.query(
      `update ${table}
       set payload = jsonb_set(payload, '{doc,settings,camera,${field}}', to_jsonb($1::float8), true)
       where ${whereKind}
         and payload->'doc'->'settings'->'camera' is not null
         and payload->'doc'->'settings'->'camera'->'${field}' is null`,
      [value],
    )
    console.log(`${table}: ${field} stamped on ${rowCount} rows`)
  }
}

await patch("library_items", `kind = 'scene'`)
// Versions carry full doc payloads too; scenes are the rows whose payload has a doc.camera.
await patch("library_item_versions", `payload->'doc'->'settings' ? 'camera'`)

// RAN ONCE 2026-08-03 and deliberately disabled: camera-VMD scenes written
// before the follow-toggle fix carried stranded offset numbers as their orbit
// target; this reset them to defaults. It is UNCONDITIONAL — running it again
// would wipe orbit framing authors have since set on purpose. Keep for the
// record, never re-enable.
// const { rowCount: vmdFixed } = await pool.query(
//   `update library_items
//    set payload = jsonb_set(jsonb_set(payload,
//      '{doc,settings,camera,target}', '[0, 11.4, 0]'::jsonb, true),
//      '{doc,settings,camera,distance}', to_jsonb(26.2::float8), true)
//    where kind = 'scene'
//      and payload->'doc'->'assets'->>'cameraAnimation' is not null`,
// )
// console.log(`camera-vmd scenes reset to default orbit: ${vmdFixed}`)

const { rows } = await pool.query(
  `select count(*)::int as missing from library_items
   where kind = 'scene' and payload->'doc'->'settings'->'camera'->'alpha' is null`,
)
console.log(`remaining scene items without alpha: ${rows[0].missing}`)
await pool.end()
