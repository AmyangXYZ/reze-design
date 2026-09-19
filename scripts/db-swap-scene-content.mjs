// Replace a published scene's CONTENT while keeping its URL and its history.
//
// A scene that gets remade — new stage, new materials, same piece — has nowhere
// to go. Publishing again mints a new short id, so the link people have stops
// being the good version, and the views, likes and pin stay on the old row.
// This moves the new row's content onto the old row instead: same id, same
// name, same counters, same made-on date, new payload and new bundle.
//
//   node --env-file=.env.local scripts/db-swap-scene-content.mjs OLD=NEW [...]
//   node --env-file=.env.local scripts/db-swap-scene-content.mjs OLD=NEW --apply
//
// Without --apply it reads and prints what it would do. The old bundle is NOT
// removed from R2 — it is the only way back if the new one turns out wrong, so
// deleting it is a separate, deliberate act. The keys are printed at the end.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws

const pairs = process.argv.slice(2).filter((a) => a.includes("=")).map((a) => a.split("="))
const apply = process.argv.includes("--apply")
if (pairs.length === 0) {
  console.error("usage: db-swap-scene-content.mjs OLD=NEW [OLD=NEW ...] [--apply]")
  process.exit(2)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
const all = async (sql, params) => (await pool.query(sql, params)).rows

const orphaned = []
for (const [oldId, newId] of pairs) {
  const o = await one(
    `select id, name, visibility, view_count, like_count, bundle_key, bundle_bytes, poster_key, created_at
       from library_items where id = $1 and kind = 'scene'`,
    [oldId],
  )
  const n = await one(
    `select id, name, payload, credits, bundle_key, bundle_bytes, poster_key
       from library_items where id = $1 and kind = 'scene'`,
    [newId],
  )
  if (!o || !n) {
    console.error(`skip ${oldId}=${newId}: ${!o ? oldId : newId} is not a scene`)
    continue
  }
  const uses = await all(`select item_id from scene_uses where scene_id = $1`, [newId])
  const oldUses = await all(`select item_id from scene_uses where scene_id = $1`, [oldId])
  console.log(
    `${o.id} "${o.name}" (${o.view_count}v ${o.like_count}L, ${(o.bundle_bytes / 1e6).toFixed(0)}MB, made ${o.created_at.toISOString().slice(0, 10)})\n` +
      `   takes the content of ${n.id} "${n.name}" (${(n.bundle_bytes / 1e6).toFixed(0)}MB)\n` +
      `   presets: ${oldUses.length} -> ${uses.length}   bundle: ${o.bundle_key} -> ${n.bundle_key}`,
  )
  if (o.bundle_key && o.bundle_key !== n.bundle_key) orphaned.push(o.bundle_key)
  if (o.poster_key && o.poster_key !== n.poster_key) orphaned.push(o.poster_key)
  if (!apply) continue

  // The items whose usage_count this can move: those either scene pinned.
  const touched = [...new Set([...uses, ...oldUses].map((r) => r.item_id))]
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(
      `update library_items
          set payload = $2, bundle_key = $3, bundle_bytes = $4, poster_key = $5,
              credits = $6, updated_at = now()
        where id = $1`,
      [o.id, n.payload, n.bundle_key, n.bundle_bytes, n.poster_key, n.credits],
    )
    // The new scene's pins become the old scene's, since they are now its content.
    await client.query(`delete from scene_uses where scene_id = $1`, [o.id])
    await client.query(
      `insert into scene_uses (scene_id, item_id)
         select $1, item_id from scene_uses where scene_id = $2
       on conflict do nothing`,
      [o.id, n.id],
    )
    // Hard delete: the row exists only because publishing had no other way to
    // say "this again, but better". scene_uses cascades off it.
    await client.query(`delete from library_items where id = $1`, [n.id])
    // usage_count is incremented at publish and never decremented, so after a
    // swap it counts the same scene twice. Recomputed from scene_uses, for the
    // touched items only — the drift elsewhere is not this script's to fix.
    if (touched.length > 0) {
      await client.query(
        `update library_items li
            set usage_count = coalesce(u.n, 0)
           from (select i.id,
                        (select count(*)::int from scene_uses su
                           join library_items s on s.id = su.scene_id
                          where su.item_id = i.id and s.visibility = 'public' and s.deleted_at is null) as n
                   from library_items i where i.id = any($1)) u
          where li.id = u.id`,
        [touched],
      )
    }
    await client.query("commit")
    console.log(`   applied · ${touched.length} preset counter(s) recomputed`)
  } catch (e) {
    await client.query("rollback")
    throw e
  } finally {
    client.release()
  }
}

if (orphaned.length > 0) {
  console.log(`\nR2 objects no scene points at any more (delete when you are happy with the result):`)
  for (const k of orphaned) console.log(`  ${k}`)
}
if (!apply) console.log(`\n(dry run — pass --apply to write)`)
await pool.end()
