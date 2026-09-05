// Expose parameters on published effects that are not the repo's own.
//
//   node --env-file=.env.local scripts/db-patch-effect-params.mjs
//   node --env-file=.env.local scripts/db-patch-effect-params.mjs --write
//
// DRY RUN by default. These are OTHER PEOPLE'S public effects: a patch is live
// the moment it runs, with no browser check in between, and WGSL cannot be
// compiled here to prove the result even builds. Read the report first.
//
// Built-ins are not touched. Their content lives in content/effects.json and
// reaches the database only through db-seed.mjs, so editing the mirror here
// would be a second source of truth that the next reseed silently reverts.
//
// The transformation is scripts/lib/expose-params.mjs — the same code that
// converted the built-ins, so a published fork of one gets the identical
// treatment its original got.
//
// SAFE BY CONSTRUCTION, in three ways:
//   1. Every param's default is the constant it replaces, so an effect renders
//      exactly as it did until somebody moves a dial.
//   2. A const that another const is built from, or that sizes an array, is
//      refused — those are the two places a uniform read cannot go.
//   3. A row that already declares a param is skipped, so a re-run is a no-op
//      rather than a second set of directives.

import { Pool, neonConfig } from "@neondatabase/serverless"
import ws from "ws"
import { readFileSync } from "node:fs"
import { exposeParams } from "./lib/expose-params.mjs"

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const WRITE = process.argv.includes("--write")

const builtinIds = new Set(
  JSON.parse(readFileSync(new URL("../content/effects.json", import.meta.url), "utf8")).map((e) => e.id),
)

// Chosen per effect by reading its source: the dials someone would actually
// reach for, skipping counts, loop bounds and the paw geometry of a stencil
// nobody retunes by hand. Ranges bracket the author's own value.
const PLAN = {
  中心射灯: ["RADIUS:0.05:0.9", "EDGE:0.01:0.6", "DARK_STRENGTH:0:1", "DARK_COLOR"],
  人物墙影: ["SHADOW_COLOR", "SPREAD:0:8", "FEATHER:0:6", "OPACITY:0:1", "SHIFT_UP:-200:200", "SHIFT_RIGHT:-200:200"],
  墙影加中心射灯: [
    "SHADOW_COLOR", "SPREAD:0:8", "FEATHER:0:6", "OPACITY:0:1", "SHIFT_UP:-200:200", "SHIFT_RIGHT:-200:200",
    "RADIUS:0.05:0.9", "EDGE:0.01:0.6", "DARK_STRENGTH:0:1", "DARK_COLOR",
  ],
  彩虹屏背景: [
    "SPEED:0:30", "BAND_COUNT:1:16", "SATURATION:0:1", "BRIGHTNESS:0:2",
    "DIAGONAL:-1:1", "SCANLINE:0:0.5", "GRAIN:0:0.2",
  ],
  "细一点点的Sticker Outline": ["COLOR", "WIDTH:1:60", "FEATHER:0:6", "OPACITY:0:1"],
  聚光灯: ["COLOR_T", "DENSITY:0:3", "EDGE:0.01:0.5", "POOL:0:0.5", "LIGHT_VIVID:0:3", "LANDING_BOOST:0:2"],
  "Footprints Cat 猫爪脚印": ["HOT_COLOR", "GLOW_COLOR", "RIM_COLOR", "RADIUS:0.1:3", "FADE:0.3:6", "PULSE:0:2"],
}

const { rows } = await pool.query(
  `select i.id, i.name, i.payload, u.name as author
     from library_items i join "user" u on u.id = i.owner_id
    where i.kind = 'effect' order by u.name, i.name`,
)

let patched = 0
const skipped = []
for (const r of rows) {
  if (builtinIds.has(r.id)) continue
  const specs = PLAN[r.name]
  if (!specs) {
    skipped.push([r.name, r.author, "no plan — nothing worth exposing without restructuring it"])
    continue
  }
  const src = r.payload?.wgsl
  if (typeof src !== "string") {
    skipped.push([r.name, r.author, "no wgsl stage"])
    continue
  }
  if (src.includes("#param")) {
    skipped.push([r.name, r.author, "already declares params"])
    continue
  }

  let out
  try {
    out = exposeParams(src, specs, r.name)
  } catch (e) {
    skipped.push([r.name, r.author, `REFUSED — ${e.message}`])
    continue
  }

  // Nothing may still refer to the bare constant: a missed rename compiles as
  // an unresolved identifier at best, and reads a stale value at worst.
  const bare = specs
    .map((s) => s.split(":")[0])
    .filter((k) => new RegExp(`(?<!params\\.)\\b${k}\\b`).test(out.wgsl.replace(/^\s*#param[^\n]*$/gm, "")))
  if (bare.length) {
    skipped.push([r.name, r.author, `REFUSED — bare reference left: ${bare.join(", ")}`])
    continue
  }

  console.log(`\n### ${r.author} / ${r.name}`)
  for (const d of out.directives) console.log("   ", d)
  patched++

  if (WRITE) {
    await pool.query(`update library_items set payload = $1, updated_at = now() where id = $2`, [
      { ...r.payload, wgsl: out.wgsl },
      r.id,
    ])
  }
}

if (skipped.length) {
  console.log("\n--- left alone ---")
  for (const [n, a, why] of skipped) console.log(`   ${a} / ${n}: ${why}`)
}
console.log(`\n${WRITE ? "PATCHED" : "would patch"}: ${patched}`)
if (!WRITE) console.log("(dry run; pass --write)")
await pool.end()
