// One-time patch: stamp the default physics block (still air, MMD gravity) into
// every published scene doc written before the Scene panel had a Physics
// section. Idempotent — only touches docs where the block is absent. Run with:
//   DATABASE_URL=... node scripts/db-patch-physics.mjs
//
// Not strictly required: parseSceneDoc already fills these defaults for any
// document that lacks them, so old scenes render correctly either way. This is
// so the stored documents are self-describing rather than relying on the reader
// to know what a missing block means.
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Keep in step with DEFAULT_PHYSICS in lib/scene-settings.ts.
const PHYSICS = {
  gravity: 98,
  wind: 0,
  windAzimuth: 90,
  windElevation: 0,
  windFrequency: 0.2,
}

const patch = async (table, whereKind) => {
  const { rowCount } = await pool.query(
    `update ${table}
     set payload = jsonb_set(payload, '{doc,settings,physics}', $1::jsonb, true)
     where ${whereKind}
       and payload->'doc'->'settings' is not null
       and payload->'doc'->'settings'->'physics' is null`,
    [JSON.stringify(PHYSICS)],
  )
  console.log(`${table}: physics stamped on ${rowCount} rows`)
}

await patch("library_items", `kind = 'scene'`)
// Versions carry full doc payloads too; scenes are the rows whose payload has a doc.camera.
await patch("library_item_versions", `payload->'doc'->'settings' ? 'camera'`)

const { rows } = await pool.query(
  `select count(*)::int as missing from library_items
   where kind = 'scene' and payload->'doc'->'settings'->'physics' is null`,
)
console.log(`remaining scene items without physics: ${rows[0].missing}`)
await pool.end()
