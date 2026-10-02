// Wake the database and drop every cached scene page.
//
//   npm run db:refresh                      the live site (SITE_URL, else https://reze.design)
//   npm run db:refresh -- http://localhost:3000
//
// The step after any change made to library_items behind the app's back — a
// content migration, a hand fix in the console. The pages cache their rows until
// an app-side write says otherwise (see app/api/admin/refresh), so without this
// they keep serving what they had. Neon sleeps when idle; the first query wakes
// it, so the pages that refill right after the refresh find it up.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws

const site = (process.argv[2] ?? process.env.SITE_URL ?? "https://reze.design").replace(/\/$/, "")
const token = process.env.CACHE_REFRESH_TOKEN
if (!token) {
  console.error("CACHE_REFRESH_TOKEN is not set (.env.local) — the refresh route would refuse.")
  process.exit(1)
}

const started = Date.now()
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query("select count(*)::int as n from library_items")
await pool.end()
console.log(`database awake (${Date.now() - started} ms): ${rows[0].n} library items`)

const res = await fetch(`${site}/api/admin/refresh`, { method: "POST", headers: { authorization: `Bearer ${token}` } })
const body = await res.text()
if (!res.ok) {
  console.error(`${site}: ${res.status} ${body}`)
  process.exit(1)
}
console.log(`${site}: ${body}`)
