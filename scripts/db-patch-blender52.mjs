// One-time patch: move every stored graph to Blender 5.2 node semantics, so the
// app can stop carrying a 3.6 compatibility shim.
//
//   node --env-file=.env.local scripts/db-patch-blender52.mjs          # dry run
//   node --env-file=.env.local scripts/db-patch-blender52.mjs --write  # apply
//
// Three things, all idempotent:
//
//   1. Principled sockets 3.6 -> 5.2 (base/specular/sheen), in published graphs
//      and in the groups inlined inside published scenes. These rows RENDER today
//      only because lib/scene.ts rewrites them on read; once that shim goes they
//      are the actual data.
//   2. A scene group that inlines a built-in's look is repointed to a PIN of that
//      built-in. A pin tracks the preset, costs a few bytes instead of kilobytes,
//      and stops the scene carrying a frozen copy of something it does not own.
//   3. Rows that ARE built-ins are deleted. These share the built-in's uuid
//      exactly — they were published so the library had them, not forked from
//      them — and they carry the pre-rename names, which is why the shipped
//      "AG Body" and a community "Body" both appear. Scenes pinning them keep
//      working: lib/resolve-refs.ts resolves a built-in id from the APP BUNDLE
//      and only queries the database for pins the bundle does not carry. Checked
//      per row against the bundled version rather than assumed.
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { readFileSync } from "node:fs"

neonConfig.webSocketConstructor = ws
const WRITE = process.argv.includes("--write")
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const builtins = JSON.parse(readFileSync(new URL("../content/graphs.json", import.meta.url), "utf8"))

// The rename this patch bakes in. lib/scene.ts used to do it on every read;
// that shim is gone now, so these names are simply what the data says.
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

// The editor's own comparison: f32, socket order folded, name and layout ignored.
const f32 = (_k, v) => (typeof v === "number" ? Math.fround(v) : v)
const canon = (g) =>
  JSON.stringify(
    {
      nodes: [...(g?.nodes ?? [])]
        .map((n) => ({
          id: n.id,
          type: n.type,
          inputs: Object.fromEntries(Object.entries(n.inputs ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      links: [...(g?.links ?? [])]
        .map((l) => `${l.from.node}.${l.from.socket}>${l.to.node}.${l.to.socket}`)
        .sort(),
      output: g?.output,
    },
    f32,
  )

const builtinByLook = new Map(builtins.map((b) => [canon(migrate(b.payload.graph).graph), b]))

const { rows } = await pool.query(`select id, kind, name, author, version, payload from library_items`)
const graphs = rows.filter((r) => r.kind === "graph")
const scenes = rows.filter((r) => r.kind === "scene")

// ── 1 + 3: published graphs ──
const pinnedIds = new Set()
for (const s of scenes)
  for (const m of s.payload?.doc?.assets?.models ?? [])
    for (const g of m.materials?.groups ?? [])
      if (g.graph && typeof g.graph === "object" && "id" in g.graph && !("nodes" in g.graph))
        pinnedIds.add(g.graph.id)

// A row IS a built-in when it carries the built-in's own uuid. (A same-look row
// with a different id would be a genuine fork and is left alone.)
const builtinById = new Map(builtins.map((b) => [b.id, b]))
const copyOf = new Map()
for (const row of graphs) {
  const b = builtinById.get(row.id)
  if (b) copyOf.set(row.id, b)
}

const toMigrate = []
const toDelete = []
for (const row of graphs) {
  const { graph, changed } = migrate(row.payload?.graph)
  const hit = copyOf.get(row.id)
  if (hit) {
    toDelete.push({ row, builtin: hit })
  } else if (changed) {
    toMigrate.push({ row, graph })
  }
}

// ── 2: scenes ──
const unservable = []
const sceneEdits = []
for (const s of scenes) {
  const doc = structuredClone(s.payload.doc)
  let changed = false
  const notes = []
  for (const m of doc.assets?.models ?? []) {
    for (const g of m.materials?.groups ?? []) {
      // A pin already carries the built-in's id, so there is nothing to repoint —
      // it resolves from the bundle. Flag only a version the bundle cannot serve.
      if (g.graph && typeof g.graph === "object" && "id" in g.graph && !("nodes" in g.graph)) {
        const hit = builtinById.get(g.graph.id)
        if (hit && hit.version !== g.graph.version) {
          unservable.push(`scene "${s.name}" pins "${hit.name}" v${g.graph.version}, bundle ships v${hit.version}`)
        }
        continue
      }
      if (!g.graph || typeof g.graph !== "object" || !("nodes" in g.graph)) continue
      const { graph, changed: mig } = migrate(g.graph)
      const hit = builtinByLook.get(canon(graph))
      if (hit) {
        g.graph = { id: hit.id, version: hit.version }
        changed = true
        notes.push(`${g.label ?? "?"} -> pin "${hit.name}"`)
      } else if (mig) {
        g.graph = graph
        changed = true
        notes.push(`${g.label ?? "?"} -> 5.2 sockets`)
      }
    }
  }
  if (changed) sceneEdits.push({ row: s, doc, notes })
}

console.log(`\n${WRITE ? "APPLYING" : "DRY RUN"} — library_items: ${rows.length} rows\n`)
console.log(`graphs to migrate to 5.2 sockets: ${toMigrate.length}`)
for (const t of toMigrate) console.log(`  "${t.row.name}" by ${t.row.author}`)
console.log(`\ngraphs that are copies of a built-in: ${toDelete.length}`)
for (const t of toDelete) console.log(`  "${t.row.name}" by ${t.row.author} == built-in "${t.builtin.name}"`)
console.log(`\nscenes to update: ${sceneEdits.length}`)
for (const e of sceneEdits) console.log(`  "${e.row.name}": ${e.notes.join(", ")}`)

if (unservable.length) {
  console.log(`\nREFUSING to delete — a pinned version the bundle cannot serve:`)
  for (const u of unservable) console.log("  " + u)
}
const deletable = unservable.length ? [] : toDelete

if (!WRITE) {
  console.log("\nNothing written. Re-run with --write to apply.")
  await pool.end()
  process.exit(0)
}

for (const t of toMigrate) {
  await pool.query(`update library_items set payload = jsonb_set(payload, '{graph}', $1::jsonb) where id = $2`, [
    JSON.stringify(t.graph),
    t.row.id,
  ])
}
for (const e of sceneEdits) {
  await pool.query(`update library_items set payload = jsonb_set(payload, '{doc}', $1::jsonb) where id = $2`, [
    JSON.stringify(e.doc),
    e.row.id,
  ])
}
for (const t of deletable) {
  await pool.query(`delete from library_items where id = $1`, [t.row.id])
}
console.log(
  `\nwrote: ${toMigrate.length} graphs migrated, ${sceneEdits.length} scenes updated, ${deletable.length} copies removed`,
)
await pool.end()
