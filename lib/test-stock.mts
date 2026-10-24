// The stock for a test: the shelf the editor would get, read from the
// database named in .env.local, installed before the test runs. Import it
// first; its top-level await holds the importing test until the rows are in.

import { readFileSync } from "node:fs"
import { neon } from "@neondatabase/serverless"
import { installStock } from "@/lib/stock"
import type { LibraryItem } from "@/lib/library"

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(([, k, v]) => [k, v.replace(/^"(.*)"$/, "$1")]),
)
const rows = (await neon(env.DATABASE_URL).query(
  `select i.id, i.kind, i.name, i.author, i.description, i.name_zh as "nameZh", i.description_zh as "descriptionZh",
          i.tags, i.payload, i.created_at as "createdAt"
     from library_items i join "user" u on u.id = i.owner_id
    where lower(u.email) = $1 and i.kind <> 'scene' and i.visibility = 'public' and i.deleted_at is null
    order by i.created_at`,
  [(env.ADMIN_EMAILS ?? "").split(",")[0].trim().toLowerCase()],
)) as LibraryItem[]
installStock(rows)
