// Mirror the repo's built-in content into library_items.
//
// The repo stays the source of truth for CONTENT — a clone with no database still
// renders the library from content/*.json. These rows exist so built-ins can
// participate relationally: likes reference an item id, and usage stats join
// against one.
//
// Identity is the uuid AUTHORED in content/*.json — stable across reseeds, so
// likes, usage counts and the refs inside published scenes all survive one. A
// scene pins { id }, so mirroring the current payload here is the whole of what
// a built-in needs to be pinnable; there is nothing else to keep in step.
//
// This is also the ONLY publisher of built-ins now. db-seed-builtins.mjs existed
// to cut a new version row when the repo's WGSL had moved on, and versions are
// gone — running this after editing content/*.json is the entire operation. It
// is idempotent, so running it when nothing changed writes nothing that matters.
import { readFileSync } from "node:fs"
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const load = (f) => JSON.parse(readFileSync(new URL(`../content/${f}`, import.meta.url), "utf8"))
const items = [...load("grades.json"), ...load("effects.json"), ...load("graphs.json")]

// Built-ins are owned by the admin account when one exists, so per-author stats
// include them instead of showing an ownerless block.
const adminEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase()
let ownerId = null
let ownerHandle = null
if (adminEmail) {
  const { rows } = await pool.query(`select id, username from "user" where lower(email) = $1 limit 1`, [adminEmail])
  ownerId = rows[0]?.id ?? null
  ownerHandle = rows[0]?.username ?? null
  console.log(ownerId ? `owner: ${adminEmail} (${ownerHandle ?? "no handle"})` : `no account yet — seeding unowned`)
}

const UPSERT = `
  insert into library_items
    (id, kind, name, author, description, tags, payload, owner_id, visibility)
  values ($1, $2, $3, $4, $5, $6, $7, $8, 'public')
  on conflict (id) do update set
    name = excluded.name,
    author = excluded.author,
    description = excluded.description,
    tags = excluded.tags,
    payload = excluded.payload,
    -- Keep an existing owner if this run has no admin account to attribute to.
    owner_id = coalesce(excluded.owner_id, library_items.owner_id),
    updated_at = now()
`

for (const i of items) {
  // The owner's HANDLE, not the name in the JSON: otherwise every re-seed undoes a
  // rename and built-ins go back to displaying a stale author.
  await pool.query(UPSERT, [i.id, i.kind, i.name, ownerHandle ?? i.author, i.description, i.tags, i.payload, ownerId])
}

const { rows: counts } = await pool.query(
  `select kind, count(*)::int as n from library_items group by kind order by kind`,
)
console.log(`seeded ${items.length} built-ins`)
for (const c of counts) console.log(`  ${c.kind}: ${c.n}`)
await pool.end()
