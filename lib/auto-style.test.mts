// One classifier for every model: a figure's parts only where there is a head,
// a material's look wherever its name or shader says what it is. Run:
//   npx esbuild lib/auto-style.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs
import assert from "node:assert/strict"
import { autoStyle, classify, isFigure, roleFor } from "./auto-style"
import { STAGE_SURFACE } from "./stage-style"

const byLabel = <T extends { label?: string; id: string }>(groups: T[]): Record<string, T> => Object.fromEntries(groups.map((g) => [g.label ?? g.id, g]))

// A head is the test, in the names PMX and its converters use.
assert.equal(isFigure(["センター", "上半身", "首", "頭", "両目"]), true)
assert.equal(isFigure(["root", "Head"]), true)
assert.equal(isFigure(["センター", "blade", "grip"]), false)

// The figure roles never reach a model without a head: no hair pass, no eye
// stencil, no skin on a wall.
assert.equal(roleFor("eye_light", true), "eye")
assert.equal(roleFor("eye_light", false), null)
assert.equal(roleFor("髪飾り", true), "hair")
assert.equal(roleFor("髪飾り", false), "cloth_smooth", "without a head, 飾 still says it is an ornament")
assert.equal(roleFor("hand", true), "body")
assert.equal(roleFor("hand", false), null)
// The material roles reach anything.
assert.equal(roleFor("socks", false), "cloth_rough")
assert.equal(roleFor("ribbon", false), "cloth_smooth")

// A figure: its parts first, then what its materials are made of.
assert.deepEqual(classify("前髪", "", true), { role: "hair" })
assert.deepEqual(classify("glasses_lens", "", true), { look: "Glass" })
assert.deepEqual(classify("wood_fan", "", true), { look: "Wood" })
assert.deepEqual(classify("材質1", "", true), null, "an unnamed material stays neutral")

// Anything else: the material table first, then a converted material's own
// values, then the material roles.
assert.deepEqual(classify("金属フレーム", "", false), { look: "Metal" })
assert.deepEqual(classify("Tile_brick_034", "SimPipeline/PBR/Standard", false), { look: STAGE_SURFACE })
assert.deepEqual(classify("hat", "", false), { role: "cloth_smooth" })
assert.deepEqual(classify("Material3", "", false), null)

// A figure holding things: hair and eyes get their render classes, the lens its
// glass, and the role groups are labelled the way the seeds are.
{
  const groups = autoStyle(["前髪", "目", "glasses_lens", "スカート", "材質9"], [], { figure: true, pack: "ag" })!
  const g = byLabel(groups)
  assert.equal(g.Hair.renderClass, "hair")
  assert.equal(g.Eye.renderClass, "eye")
  assert.deepEqual(g.Glass.materials, ["glasses_lens"])
  assert.deepEqual(g["Smooth Cloth"].materials, ["スカート"])
  assert.ok(!groups.some((x) => x.materials.includes("材質9")), "unclaimed stays ungrouped")
  for (const x of groups) assert.match(x.id, /^[a-z0-9_-]+$/)
}

// A stage: a converted standard material keeps its own values, glass is glass,
// and nothing lands in a figure's pass whatever its name.
{
  const groups = autoStyle(
    ["Tile_brick_034", "Tile_glass_029", "Terrain_X340_001a", "wood_floor", "eye_light"],
    [],
    {
      figure: false,
      pack: "ag",
      memos: { Tile_brick_034: "SimPipeline/PBR/Standard", Tile_glass_029: "SimPipeline/PBR/Standard", Terrain_X340_001a: "SimPipeline/Scene/Transparent" },
    },
  )!
  const g = byLabel(groups)
  assert.deepEqual(g[STAGE_SURFACE].materials, ["Tile_brick_034"])
  assert.equal(g.Glass.blend, "premultiplied")
  assert.equal(g["Glass Shell"].id, "stage-glass-shell")
  assert.deepEqual(g.Wood.materials, ["wood_floor"])
  assert.ok(groups.every((x) => x.renderClass === "auto"), "no render class on a model without a head")
  assert.ok(!groups.some((x) => x.materials.includes("eye_light")))
}

// Hand work is never undone, and a second run changes nothing.
{
  const mine = { id: "mine", label: "Mine", materials: ["前髪"], graph: { version: 1, nodes: [], links: [], output: { node: "x", socket: "y" } }, renderClass: "auto" as const }
  const first = autoStyle(["前髪", "目"], [mine as never], { figure: true, pack: "ag" })!
  assert.deepEqual(byLabel(first).Mine.materials, ["前髪"], "a hand-grouped material stays where it was put")
  assert.equal(autoStyle(["前髪", "目"], first, { figure: true, pack: "ag" }), null)
}

console.log("auto-style: ok")
