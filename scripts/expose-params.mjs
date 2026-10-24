// Expose a built-in effect's tunables as parameters, on its row.
//
//   node --env-file=.env.local scripts/expose-params.mjs "Rain" FALL:0:60 SLANT:-0.5:0.5 COLOR --write
//
// A bare name keeps whatever the const holds and infers the kind: vec3f( … )
// becomes a colour when its components are all 0..1, a vec3 otherwise.
// DRY RUN by default. After a write, `npm run db:refresh`.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { exposeParams } from "./lib/expose-params.mjs"
import { stockRows } from "./lib/stock-db.mjs"

const args = process.argv.slice(2)
const write = args.includes("--write")
const [name, ...specs] = args.filter((a) => a !== "--write")

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const item = (await stockRows(pool, "effect")).find((e) => e.name === name)
if (!item) throw new Error(`no built-in effect named ${name}`)

const { wgsl, directives } = exposeParams(item.payload.wgsl, specs, name)
console.log(directives.join("\n"))

if (write) {
  await pool.query(`update library_items set payload = $2, updated_at = now() where id = $1`, [
    item.id,
    { ...item.payload, wgsl },
  ])
  console.log(`\nwrote ${name} (${item.id})`)
} else {
  console.log("\n(dry run; pass --write)")
}
await pool.end()
