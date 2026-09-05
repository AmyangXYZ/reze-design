// Expose a built-in's tunables as parameters, in content/effects.json.
//
//   node scripts/expose-params.mjs "Rain" FALL:0:60 SLANT:-0.5:0.5 COLOR --write
//
// A bare name keeps whatever the const holds and infers the kind: vec3f( … )
// becomes a colour when its components are all 0..1, a vec3 otherwise.
// DRY RUN by default.

import fs from "node:fs"
import { exposeParams } from "./lib/expose-params.mjs"

const FILE = "content/effects.json"
const args = process.argv.slice(2)
const write = args.includes("--write")
const [name, ...specs] = args.filter((a) => a !== "--write")

const items = JSON.parse(fs.readFileSync(FILE, "utf8"))
const item = items.find((e) => e.name === name)
if (!item) throw new Error(`no effect named ${name}`)

const { wgsl, directives } = exposeParams(item.payload.wgsl, specs, name)
console.log(directives.join("\n"))

if (write) {
  item.payload.wgsl = wgsl
  fs.writeFileSync(FILE, JSON.stringify(items, null, 1) + "\n")
  console.log(`\nwrote ${FILE}`)
} else {
  console.log("\n(dry run; pass --write)")
}
