// Tests for lib/ray-mmd — reading an .emd and its presets into looks.
//
//   npx esbuild lib/ray-mmd.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/rm.mjs && node /tmp/rm.mjs
//
// The map conversion needs a browser; everything that decides WHAT a material
// becomes does not, and every graph here goes through the engine's compiler.

import { compileGraph } from "reze-engine"
import { emdFit, parseEmd, parsePreset, planRayMmd, rayGraph, readRayMaterial } from "@/lib/ray-mmd"

let failures = 0
const eq = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failures++; console.error(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}

const EMD = `[Info]
Version = 3

[Effect]
Obj = E:\\ray-mmd\\Materials\\material_2.0.fx
Obj.show = true
Obj[0] = wall.fx
Obj[1] = E:\\ray-mmd\\Materials\\Transparent\\material_glass.fx
Obj[2].show = false
Obj[3] = wall.fx
Obj[4] = floor.fx
Obj[5] = none
`

// The shape ray-mmd's generator writes: a map per channel, then the include.
const WALL = `//auto-generated
#define ALBEDO_MAP_FROM 1
#define ALBEDO_MAP_APPLY_SCALE 1
#define ALBEDO_MAP_FILE "./tu/wall_D.tga"
const float3 albedo = 1.0;
const float2 albedoMapLoopNum = 1.0;
#define NORMAL_MAP_FROM 1
#define NORMAL_MAP_TYPE 0
#define NORMAL_MAP_FILE "./tu/wall_N.tga"
const float normalMapScale = 0.5;
#define SMOOTHNESS_MAP_FROM 1
#define SMOOTHNESS_MAP_TYPE 2
#define SMOOTHNESS_MAP_SWIZZLE 1
#define SMOOTHNESS_MAP_FILE "./tu/wall_M.tga"
const float smoothness = 0.5;
#define METALNESS_MAP_FROM 1
#define METALNESS_MAP_SWIZZLE 0 // 0=r
#define METALNESS_MAP_FILE "./tu/wall_M.tga"
const float metalness = 0;
const float3 specular = 0.50;
#define EMISSIVE_ENABLE 1
#define EMISSIVE_MAP_FROM 1
#define EMISSIVE_MAP_SWIZZLE 0 // 0=r  1=g  2=b  3=a
#define EMISSIVE_MAP_FILE "./tu/wall_M_L.tga"
const float emissiveIntensity = 2.0;
const float3 customB = float3(0.1, 0.1, 0.1);
#include "./Material/common.fxsub"
`

// No maps at all: constant smoothness and metalness, albedo from the PMX.
const FLOOR = `#define ALBEDO_MAP_FROM 3
#define NORMAL_MAP_FROM 0
#define SMOOTHNESS_MAP_FROM 0
const float smoothness = 0.8;
#define METALNESS_MAP_FROM 0
const float metalness = 0.25;
#define EMISSIVE_ENABLE 0
`

const emd = parseEmd(EMD)
eq(emd.fallback, "E:\\ray-mmd\\Materials\\material_2.0.fx", "the model's default preset")
eq([...emd.objects.keys()], [0, 1, 2, 3, 4, 5], "one entry per object line")
eq(emd.objects.get(2), { fx: null, show: false }, "a hidden object inherits its preset")
eq(emd.objects.get(5)?.fx, "", "none is an explicit no-preset")

const names = ["wall", "玻璃", "cloud", "wall", "floor", "rope"]
eq(emdFit(emd, names), 3, "fit counts presets named after their material")
eq(emdFit(emd, ["wall", "floor"]), -1, "an index past the model rules the .emd out")

const preset = parsePreset(WALL)!
eq(preset.consts.get("customB"), [0.1, 0.1, 0.1], "a constructor's type name is not a number")
eq(parsePreset("float4 main() : COLOR { return 1; }"), null, "a shader that is not a preset")

const warnings: string[] = []
const wall = readRayMaterial(preset, "set/Toon/wall.fx", warnings)
eq(wall.albedo.source, { kind: "file", path: "set/Toon/tu/wall_D.tga" }, "map paths resolve against the .fx")
eq(wall.normal?.strength, 0.5, "normal strength from normalMapScale")
eq(wall.smoothness, { source: { kind: "file", path: "set/Toon/tu/wall_M.tga" }, channel: 1, type: 2, scale: 0.5, scaleMode: 0, fallback: 0.5 }, "smoothness channel and type")
eq(wall.emissive, { source: { kind: "file", path: "set/Toon/tu/wall_M_L.tga" }, channel: 0, intensity: 2 }, "emissive mask and intensity")
eq(warnings, [], "nothing unsupported")

const presets = new Map([
  ["set/Toon/wall.fx", WALL],
  ["set/Toon/floor.fx", FLOOR],
])
const plan = planRayMmd(names, emd, "set/Toon/1.emd", presets)
eq(
  plan.groups.map((g) => [g.label, g.materials, g.look.kind]),
  [
    ["wall", ["wall"], "ray"],
    ["Glass", ["玻璃"], "library"],
    ["floor", ["floor"], "ray"],
  ],
  "one group per preset, built-ins as library looks, a repeated name once",
)
eq(plan.hidden, ["cloud"], "hidden materials")
eq(plan.warnings, [], "no conflicts: both 'wall' entries wear the same preset")

const clash = planRayMmd(["a", "a"], parseEmd("[Effect]\nObj[0] = wall.fx\nObj[1] = floor.fx\n"), "set/Toon/1.emd", presets)
eq(clash.groups.map((g) => g.materials), [["a"]], "a name claimed twice keeps its first preset")
eq(clash.warnings.length, 1, "and says so")

// Every graph compiles, whichever sources end up in slots.
const compiles = (label: string, graph: ReturnType<typeof rayGraph>) => {
  const r = compileGraph(graph, { renderClass: "auto", alphaMode: "opaque" })
  eq(r.ok, true, `${label} compiles ${JSON.stringify(r.diagnostics)}`)
  return r.fsBody
}
const slots: string[] = []
const body = compiles(
  "wall",
  rayGraph(wall, (s) => {
    if (s.kind === "pmx" || s === wall.albedo.source) return "pmx"
    if (!slots.includes(s.path)) slots.push(s.path)
    return slots.indexOf(s.path)
  }),
)
eq(slots.map((p) => p.split("/").pop()), ["wall_N.tga", "wall_M.tga", "wall_M_L.tga"], "one slot per map file")
eq(body.includes("n_map1_rgb.g, 10.0"), true, "roughness is the green channel as stored")
eq(/n_(\w+) = math_multiply\(n_map2_rgb\.r, 2\.0\)[\s\S]*\+ tex_color \* n_\1;/.test(body), true, "emission is albedo times the scaled mask")

const floor = readRayMaterial(parsePreset(FLOOR)!, "set/Toon/floor.fx", [])
const flat = compiles("floor", rayGraph(floor, () => "pmx"))
eq(/PrincipledIn\(tex_color, 0\.25, 0\.5, 0\.2\d*,/.test(flat), true, "constants become roughness 1 - smoothness and metallic")

// A map that never made it falls away rather than breaking the graph.
compiles("wall without maps", rayGraph(wall, (s) => (s.kind === "pmx" || s === wall.albedo.source ? "pmx" : null)))

if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("ray-mmd: all passed")
