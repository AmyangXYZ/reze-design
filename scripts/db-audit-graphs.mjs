// READ-ONLY audit: does everything published still compile against the current
// node registry, and does every scene still resolve what it points at?
//
//   node --env-file=.env.local scripts/db-audit-graphs.mjs
//
// The engine drops a group whose graph will not compile rather than render it
// wrongly, so a stale published look does not error — it silently renders
// unstyled, in someone else's scene, with no way for them to know why. This is
// the check that finds that before a user does.
//
// Reports, never writes. Anything it flags is fixed by a deliberate patch script.
import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { readFileSync } from "node:fs"
// reze-engine's dist uses extensionless relative imports, so it resolves under a
// bundler and NOT under plain node — the app never noticed because Next resolves
// them. A resolve hook puts the extension back, which keeps this script a
// self-contained `node scripts/...` rather than borrowing the engine's test
// loader from a sibling checkout.
import { registerHooks } from "node:module"
registerHooks({
  resolve(spec, ctx, next) {
    if (!spec.startsWith(".") || /\.[a-z]+$/.test(spec)) return next(spec, ctx)
    // A bare relative specifier is either a file or a directory's index.
    try {
      return next(spec + ".js", ctx)
    } catch {
      return next(spec + "/index.js", ctx)
    }
  },
})
const { compileGraph } = await import("reze-engine")

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const builtins = [
  ...JSON.parse(readFileSync(new URL("../content/graphs.json", import.meta.url), "utf8")),
  ...JSON.parse(readFileSync(new URL("../content/stage-graphs.json", import.meta.url), "utf8")),
]
const builtinById = new Map(builtins.map((b) => [b.id, b]))
const builtinNames = new Set(builtins.map((b) => b.name))

const bad = []
const errs = (g) => {
  try {
    return compileGraph(g).diagnostics.filter((x) => x.severity !== "warning")
  } catch (e) {
    return [{ message: `threw — ${e.message}` }]
  }
}
// Nothing rewrites a graph on read any more, so a graph that does not compile
// here is a graph that will not render — there is no shim behind it.
const check = (label, graph) => {
  if (!graph || !Array.isArray(graph.nodes)) return
  for (const d of errs(graph)) bad.push(`${label}: ${d.nodeId ?? ""} ${d.message}`)
}

const { rows } = await pool.query(
  `select id, kind, name, author, version, payload from library_items order by kind, name`,
)
const byKind = {}
for (const r of rows) (byKind[r.kind] ??= []).push(r)
console.log(
  "library_items:",
  Object.entries(byKind).map(([k, v]) => `${k}=${v.length}`).join("  ") || "(empty)",
)

for (const row of byKind.graph ?? []) {
  check(`graph "${row.name}" by ${row.author}`, row.payload?.graph)
}

// A scene carries its groups by value, so its looks are checked here too — and a
// scene can also PIN a built-in by id, which only resolves while that id exists.
const danglingPins = []
for (const row of byKind.scene ?? []) {
  const doc = row.payload?.doc
  for (const m of doc?.assets?.models ?? []) {
    for (const g of m.materials?.groups ?? []) {
      const ref = g.graph
      if (ref && typeof ref === "object" && "id" in ref && !("nodes" in ref)) {
        if (!builtinById.has(ref.id) && !rows.some((x) => x.id === ref.id)) {
          danglingPins.push(`scene "${row.name}": group "${g.label ?? "?"}" pins missing item ${ref.id}`)
        }
      } else if (typeof ref === "string") {
        if (!builtinNames.has(ref)) {
          danglingPins.push(`scene "${row.name}": group "${g.label ?? "?"}" names missing built-in "${ref}"`)
        }
      } else {
        check(`scene "${row.name}" group "${g.label ?? "?"}"`, ref)
      }
    }
  }
}

// A published row that IS a built-in shows the same look twice in the library,
// under two names, with the built-in winning the quick switch — so the copy is
// unreachable clutter carrying its own likes.
const canon = (g) =>
  JSON.stringify({
    nodes: [...(g.nodes ?? [])].map((n) => ({ id: n.id, type: n.type, inputs: n.inputs ?? {} }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    links: [...(g.links ?? [])].map((l) => `${l.from.node}.${l.from.socket}>${l.to.node}.${l.to.socket}`).sort(),
    output: g.output,
  })
const builtinLooks = new Map(builtins.map((b) => [canon(b.payload.graph), b.name]))
const dupes = []
for (const row of byKind.graph ?? []) {
  const hit = builtinLooks.get(canon(row.payload?.graph ?? {}))
  if (hit) dupes.push(`"${row.name}" by ${row.author} — same look as built-in "${hit}"`)
}
console.log(`\n=== published copies of a built-in: ${dupes.length} ===`)
for (const d of dupes) console.log("  " + d)

console.log(`\n=== graphs that do not compile: ${bad.length} ===`)
for (const b of bad) console.log("  " + b)
// The name is the human key: the quick switch matches a group to a row by name,
// so two rows sharing one leaves the second unreachable. Built-ins are listed
// first, so a collision always hides the published row.
// Scoped per KIND: the quick switch for graphs only lists graphs, so an effect
// and a scene sharing a name collide with nothing.
const byName = new Map()
const add = (kind, name, label) => {
  const k = kind + "\u0000" + name.trim().toLowerCase()
  byName.set(k, [...(byName.get(k) ?? []), label])
}
// db-seed mirrors every built-in into library_items under its AUTHORED uuid, so
// the same entity appears in both lists. That is the design (likes and usage
// stats need a row to reference), not a clash — matched by id, not by name.
const builtinIds = new Set(builtins.map((b) => b.id))
for (const b of builtins) add("graph", b.name, `built-in graph "${b.name}"`)
for (const row of rows) {
  if (builtinIds.has(row.id)) continue
  add(row.kind, row.name, `${row.kind} "${row.name}" by ${row.author}`)
}
const clashes = [...byName.values()].filter((v) => v.length > 1)
console.log(`\n=== names that collide (second one unreachable): ${clashes.length} ===`)
for (const c of clashes) console.log("  " + c.join("  vs  "))

console.log(`\n=== scene references that no longer resolve: ${danglingPins.length} ===`)
for (const d of danglingPins) console.log("  " + d)

await pool.end()
