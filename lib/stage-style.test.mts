// Stage looks: the keyword and shader tables point at looks that exist, and a
// converted stage keeps its own values. Run:
//   npx esbuild lib/stage-style.test.mts --bundle --platform=node --format=esm --outfile=$TEMP/x.mjs && node $TEMP/x.mjs
import assert from "node:assert/strict"
import { compileGraph } from "reze-engine"
import { LOOK_STATE, SHADER_LOOKS, STAGE_MATERIAL_RULES, STAGE_SURFACE, lookFor, stageStyleGroups } from "./stage-style"
import { libraryGraph } from "./materials"

// Every look the tables name is a library entry, and it compiles.
const named = new Set([...STAGE_MATERIAL_RULES.map((r) => r.graph), ...Object.values(SHADER_LOOKS), STAGE_SURFACE])
for (const look of named) {
  const graph = libraryGraph(look)
  assert.ok(graph, `"${look}" is named by a table but is not in the library`)
  const r = compileGraph(graph, { blend: LOOK_STATE[look]?.blend, alphaMode: LOOK_STATE[look]?.alphaMode })
  assert.ok(r.ok, `"${look}" does not compile: ${r.diagnostics.map((d) => d.message).join("; ")}`)
}

// Names a hand-made stage uses.
assert.equal(lookFor("金属フレーム", ""), "Metal")
assert.equal(lookFor("brass_rail", ""), "Metal")
assert.equal(lookFor("水泥地面", ""), "Stone")
assert.equal(lookFor("花岗岩", ""), "Stone")
assert.equal(lookFor("pool_shui", ""), "Water")
assert.equal(lookFor("漆喰の壁", ""), "Plaster")
assert.equal(lookFor("漆塗り", ""), "Lacquer")
assert.equal(lookFor("leather_sofa", ""), "Fabric")
assert.equal(lookFor("neon_sign", ""), "Neon")
assert.equal(lookFor("ceiling_light", ""), null)

// A converted stage: its shader outranks its name, and a standard material keeps
// its own values unless its name says glass, water or a plant.
assert.equal(lookFor("Tile_brick_034", "SimPipeline/PBR/Standard"), null)
assert.equal(lookFor("Tile_glass_029", "SimPipeline/PBR/Standard"), "Glass")
assert.equal(lookFor("Terrain_X340_001a", "SimPipeline/Scene/Transparent"), "Glass Shell")
assert.equal(lookFor("X309_terrain", "SimPipeline/PBR/Standard_PBR_2"), "Terrain")
assert.equal(lookFor("X309_water", "SimPipeline/Scene/Ripplet"), "Water")

const groups = stageStyleGroups(
  ["Tile_brick_034", "Tile_glass_029", "Terrain_X340_001a", "wood_floor"],
  [],
  { Tile_brick_034: "SimPipeline/PBR/Standard", Tile_glass_029: "SimPipeline/PBR/Standard", Terrain_X340_001a: "SimPipeline/Scene/Transparent" },
)!
const byLabel = Object.fromEntries(groups.map((g) => [g.label, g]))
assert.deepEqual(byLabel[STAGE_SURFACE].materials, ["Tile_brick_034"])
assert.equal(byLabel.Glass.blend, "premultiplied")
assert.equal(byLabel["Glass Shell"].id, "stage-glass-shell")
assert.deepEqual(byLabel.Wood.materials, ["wood_floor"])
for (const g of groups) assert.match(g.id, /^[a-z0-9_-]+$/)

console.log("stage-style: ok")
