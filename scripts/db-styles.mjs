// The rendering styles (render_styles; lib/materials lookPacks): the style
// menu, in order. There is no UI for them; this is how they change.
//
//   npm run db:styles                       list them
//   npm run db:styles -- set <file.json>    add or replace, by id
//   npm run db:styles -- remove <id>
//
// The file holds one style or an array of them:
//
//   { "id": "endfield", "owner": "aileen_71", "tag": "arknights-endfield",
//     "name": "Arknights: Endfield", "nameZh": "明日方舟：终末地",
//     "keywords": ["arknights", "终末地"], "position": 4,
//     "staging": { "transform": "neutral", "exposure": 0,
//                  "world": { "color": "#cfd6e2", "strength": 0.73 },
//                  "light": { "sun": {…}, "bloom": {…} } } }
//
// `owner` is the maker's username, stored as their user id so a rename does
// not lose the style. The style's graphs are the public graphs that owner
// publishes carrying its tag. Follow a change with `npm run db:refresh`.

import { readFileSync } from "node:fs"
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const [cmd, arg] = process.argv.slice(2)

if (cmd === "set") {
  const raw = JSON.parse(readFileSync(arg, "utf8"))
  for (const s of Array.isArray(raw) ? raw : [raw]) {
    for (const k of ["id", "owner", "tag", "name", "staging"]) if (!s[k]) throw new Error(`${s.id ?? "style"}: ${k} is required`)
    const { rows } = await pool.query(`select id from "user" where username = $1`, [s.owner])
    if (!rows[0]) throw new Error(`${s.id}: no user named ${s.owner}`)
    await pool.query(
      `insert into render_styles (id, owner_id, tag, name, name_zh, keywords, staging, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set owner_id = $2, tag = $3, name = $4, name_zh = $5, keywords = $6, staging = $7, position = $8`,
      [s.id, rows[0].id, s.tag, s.name, s.nameZh ?? "", s.keywords ?? [], s.staging, s.position ?? 0],
    )
    console.log(`set ${s.id}`)
  }
} else if (cmd === "remove") {
  const r = await pool.query(`delete from render_styles where id = $1`, [arg])
  console.log(r.rowCount ? `removed ${arg}` : `no style ${arg}`)
} else if (cmd) {
  console.error(`unknown command ${cmd}: set <file.json> | remove <id>`)
  process.exitCode = 1
}

const { rows } = await pool.query(
  `select s.id, s.tag, s.name, s.name_zh, u.username owner,
          (select count(*)::int from library_items i
            where i.owner_id = s.owner_id and s.tag = any(i.tags) and i.kind = 'graph'
              and i.visibility = 'public' and i.deleted_at is null) graphs
     from render_styles s left join "user" u on u.id = s.owner_id
    order by s.position, s.created_at`,
)
for (const r of rows) console.log(`  ${r.id.padEnd(10)} ${r.name} · ${r.name_zh} · ${r.tag} · by ${r.owner ?? "(nobody)"} · ${r.graphs} graphs`)
if (cmd === "set" || cmd === "remove") console.log("\nnow: npm run db:refresh")
await pool.end()
