import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
// Resetting accounts is a DATABASE operation. Revoking tokens at the provider
// only forces re-consent; it leaves these rows untouched.
//
// Guarded because this deletes whatever DATABASE_URL happens to point at, and
// `vercel env pull` can put a production connection string in .env.local without
// anything on screen looking different.
if (process.argv[2] === "--purge") {
  const host = new URL(process.env.DATABASE_URL).hostname
  if (process.argv[3] !== host) {
    console.error(`refusing to purge.\n\n  target: ${host}\n`)
    console.error(`  re-run with the host as confirmation:\n    npm run db:users -- --purge ${host}\n`)
    process.exit(1)
  }
  // Sessions and accounts cascade from user; published items survive but are
  // orphaned (owner_id ON DELETE set null), so nothing referencing them breaks.
  const r = await pool.query(`delete from "user"`)
  console.log(`deleted ${r.rowCount} users from ${host} — sessions and provider links cascade`)
}
const u = await pool.query(`select email, name, email_verified, created_at from "user" order by created_at`)
console.log("users:", u.rowCount)
for (const r of u.rows) console.log("  ", r.email, "·", r.name, "· verified:", r.email_verified)
const i = await pool.query(`select id, kind, name, author, visibility from library_items order by created_at`)
console.log("library_items:", i.rowCount)
for (const r of i.rows) console.log("  ", r.kind, r.name, "by", r.author, "·", r.visibility)
await pool.end()
