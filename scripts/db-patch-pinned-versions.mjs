// Bake the Blender 5.2 socket rename into PINNED versions.
//
//   node --env-file=.env.local scripts/db-patch-pinned-versions.mjs        # dry run
//   node --env-file=.env.local scripts/db-patch-pinned-versions.mjs --write
//
// db-patch-blender52.mjs rewrote library_items.payload — the LATEST version,
// denormalised. It never touched library_item_versions, which is what a scene's
// {id, version} pin actually resolves through, and db-audit-graphs.mjs compiles
// the same denormalised copy, so it reported clean while every pinned version
// still carried Principled's old socket names. The engine drops a graph it cannot
// compile rather than render it wrongly, so those scenes render unstyled in
// someone else's browser with one console line per group and no way to know why.
//
// This edits published versions, which are otherwise immutable. That is the whole
// point of them, and it is a deliberate exception: the alternative is that every
// scene pinning a pre-5.2 graph is permanently broken. The rename is lossless —
// same nodes, same links, same values, three socket keys spelled the way the
// current registry spells them — so a pin resolves to the look it always meant.
//
// The same map as db-patch-blender52.mjs, on purpose: two spellings of one
// migration is how the data drifts again.
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"

neonConfig.webSocketConstructor = ws
const WRITE = process.argv.includes("--write")
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const V2 = { base: "base_color", specular: "specular_ior_level", sheen: "sheen_weight" }

function migrate(g) {
  if (!g?.nodes) return { graph: g, changed: false }
  const ids = new Set(g.nodes.filter((n) => n.type === "principled").map((n) => n.id))
  if (!ids.size) return { graph: g, changed: false }
  let changed = false
  const nodes = g.nodes.map((n) => {
    if (!ids.has(n.id) || !n.inputs) return n
    const inputs = {}
    for (const [k, v] of Object.entries(n.inputs)) {
      if (V2[k]) changed = true
      inputs[V2[k] ?? k] = v
    }
    return { ...n, inputs }
  })
  const links = (g.links ?? []).map((l) => {
    if (!ids.has(l.to.node) || !V2[l.to.socket]) return l
    changed = true
    return { ...l, to: { ...l.to, socket: V2[l.to.socket] } }
  })
  return { graph: changed ? { ...g, nodes, links } : g, changed }
}

/** A version payload is a graph item's {graph}, or a scene's {doc} full of groups. */
function migratePayload(payload) {
  if (payload?.graph) {
    const { graph, changed } = migrate(payload.graph)
    return { payload: changed ? { ...payload, graph } : payload, changed }
  }
  const groups = payload?.doc?.state?.groups
  if (!groups) return { payload, changed: false }
  let changed = false
  const next = {}
  for (const [modelId, list] of Object.entries(groups)) {
    next[modelId] = (list ?? []).map((g) => {
      // A group's graph may be a pin or a built-in's name rather than a graph.
      if (!g?.graph?.nodes) return g
      const r = migrate(g.graph)
      if (r.changed) changed = true
      return r.changed ? { ...g, graph: r.graph } : g
    })
  }
  return { payload: changed ? { ...payload, doc: { ...payload.doc, state: { ...payload.doc.state, groups: next } } } : payload, changed }
}

const { rows: items } = await pool.query(`select id, kind, name, author, version from library_items`)
const byId = new Map(items.map((r) => [r.id, r]))
const { rows: versions } = await pool.query(`select item_id, version, payload from library_item_versions`)

const edits = []
for (const v of versions) {
  const { payload, changed } = migratePayload(v.payload)
  if (changed) edits.push({ ...v, next: payload })
}

console.log(`library_item_versions: ${versions.length} rows`)
console.log(`\n${WRITE ? "APPLYING" : "DRY RUN"} — versions needing the rename: ${edits.length}\n`)
for (const e of edits) {
  const it = byId.get(e.item_id)
  console.log(`  ${e.item_id} v${e.version}  ${it ? `${it.kind} "${it.name}" by ${it.author}` : "(item deleted — versions outlive it)"}`)
}

// Which published scenes were actually rendering wrong, so the fix can be verified
// by opening them rather than by trusting this script.
const key = new Set(edits.map((e) => `${e.item_id}@${e.version}`))
const { rows: uses } = await pool.query(`select scene_id, item_id, item_version from scene_uses`)
const affected = [...new Set(uses.filter((u) => key.has(`${u.item_id}@${u.item_version}`)).map((u) => u.scene_id))]
console.log(`\nscenes that pin one of these: ${affected.length}`)
for (const id of affected) console.log(`  ${id}  "${byId.get(id)?.name ?? "?"}"`)

if (!WRITE) {
  console.log(`\nnothing written — re-run with --write`)
  await pool.end()
  process.exit(0)
}

for (const e of edits) {
  await pool.query(`update library_item_versions set payload = $1::jsonb where item_id = $2 and version = $3`, [
    JSON.stringify(e.next),
    e.item_id,
    e.version,
  ])
}
console.log(`\nwrote: ${edits.length} pinned version(s) migrated`)
await pool.end()
