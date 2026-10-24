// The stock for a test, and the rendering styles with their graphs: the
// shelf the editor would get, read from the
// database named in .env.local, installed before the test runs. Import it
// first; its top-level await holds the importing test until the rows are in.

import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
import { installStock, installStyles } from "@/lib/stock"
import type { LibraryItem } from "@/lib/library"
import type { LookStyle } from "@/lib/materials"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(([, k, v]) => [k, v.replace(/^"(.*)"$/, "$1")]),
)
const sql = neon(env.DATABASE_URL)
const rows = (await sql.query(
  `select i.id, i.kind, i.name, i.author, i.description, i.name_zh as "nameZh", i.description_zh as "descriptionZh",
          i.tags, i.payload, i.created_at as "createdAt"
     from library_items i join "user" u on u.id = i.owner_id
    where lower(u.email) = $1 and i.kind <> 'scene' and i.visibility = 'public' and i.deleted_at is null
    order by i.created_at`,
  [(env.ADMIN_EMAILS ?? "").split(",")[0].trim().toLowerCase()],
)) as LibraryItem[]
const styles = (await sql.query(
  `select id, tag, name, name_zh as "nameZh", keywords, staging from render_styles order by position, created_at`,
)) as LookStyle[]
const styleGraphs = (await sql.query(
  `select i.id, i.kind, i.name, i.author, i.description, i.name_zh as "nameZh", i.description_zh as "descriptionZh",
          i.tags, i.payload, i.created_at as "createdAt"
     from library_items i
    where i.kind = 'graph' and i.visibility = 'public' and i.deleted_at is null
      and exists (select 1 from render_styles s where s.owner_id = i.owner_id and s.tag = any(i.tags))
    order by i.created_at`,
)) as LibraryItem[]
installStyles(styles, styleGraphs)
installStock(rows)
