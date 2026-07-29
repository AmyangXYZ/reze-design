import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const t0 = Date.now()
const { rows } = await pool.query(
  `select column_name, data_type from information_schema.columns
   where table_name = 'library_items' order by ordinal_position`,
)
const [{ now }] = (await pool.query("select now()")).rows
console.log(`connected in ${Date.now() - t0}ms · server time ${now.toISOString()}`)
console.log(`library_items: ${rows.length} columns`)
console.log(rows.map((r) => `  ${r.column_name} ${r.data_type}`).join("\n"))
const idx = await pool.query(`select indexname from pg_indexes where tablename='library_items'`)
console.log("indexes:", idx.rows.map((r) => r.indexname).join(", "))
await pool.end()
