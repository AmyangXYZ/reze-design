// Every graph the stage importer builds in code compiles against the engine —
// the PBR look, the sheets, the game's effect sheets (each layer combination),
// fresnel, ripplet water and the sea. The importer's own test needs a stage
// on disk; this one needs nothing, so a vocabulary change in the engine that
// one of these builders still speaks the old words of fails here.
//
//   npx esbuild lib/stage-graphs-compile.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/sgc.mjs && node /tmp/sgc.mjs

import assert from "node:assert/strict"
import { compileGraph, type ShaderGraph } from "reze-engine"
import {
  effectSheetGraph,
  fresnelGraph,
  rippletGraph,
  seaGraph,
  stageLightSheetGraph,
  stagePbrGraph,
  stageSheetGraph,
  type EffectSpec,
} from "@/lib/gltf-stage"

const ok = (name: string, g: ShaderGraph, opts: Parameters<typeof compileGraph>[1] = {}) => {
  const r = compileGraph(g, opts)
  assert.ok(r.ok, `${name}: ${JSON.stringify(r.diagnostics)}`)
}

for (const s of [0, 1, 4]) {
  ok(`stagePbr(${s})`, stagePbrGraph(s))
  ok(`stagePbr(${s}) hashed`, stagePbrGraph(s), { alphaMode: "hashed" })
  ok(`stageSheet(${s})`, stageSheetGraph(s))
  ok(`stageLightSheet(${s})`, stageLightSheetGraph(s))
}

const layer: NonNullable<EffectSpec["layers"]["main"]> = { scale: [1, 1], offset: [0, 0], rotation: 0, tiling: true, speed: [0.1, 0] }
const effect = (layers: EffectSpec["layers"], noise = false): EffectSpec => ({
  layers,
  ...(noise ? { noise: { scale: [1, 1], offset: [0, 0], speed: [0.1, 0.1], strength: [0.1, 0.1], main: true, plus: true, mask: true } } : {}),
  mainPow: [1, 1, 1, 1],
  color: [1, 1, 1, 1],
  redAlphaMain: false,
  plusPow: [1, 1, 1, 1],
  plusColor: [1, 1, 1, 1],
  redAlphaPlus: true,
  plusStrength: 1,
  plusColorOn: 1,
  plusAlphaOn: 1,
  plusMode: 0,
  redAlphaMask: true,
  maskStrength: 1,
  dstBlend: 1,
})
for (const [name, layers] of Object.entries({
  main: { main: layer },
  "main+plus": { main: layer, plus: layer },
  "main+mask": { main: layer, mask: layer },
  all: { main: layer, plus: layer, mask: layer },
})) {
  ok(`effectSheet ${name}`, effectSheetGraph(name, effect(layers)))
  ok(`effectSheet ${name} noise`, effectSheetGraph(name, effect(layers, true)))
}

for (const oneMinus of [false, true]) ok(`fresnel ${oneMinus}`, fresnelGraph("f", { color: [2, 1, 1], power: 2, oneMinus }))

const ripple = {
  layers: [
    { scale: [0.1, 0.1] as [number, number], drift: [0.01, 0] as [number, number], strength: 1 },
    { scale: [0.2, 0.2] as [number, number], drift: [0, 0.01] as [number, number], strength: 0.5 },
  ],
  strength: 0.5,
  color: [0.1, 0.2, 0.3, 0.8],
  reflection: [1, 1, 1, 0.5],
  intensity: 1,
  cube: 1,
}
ok("ripplet", rippletGraph("r", ripple))
ok("ripplet tinted, own env", rippletGraph("r", { ...ripple, tint: 0.8, env: { range: 4 } }))

const sea = {
  depth: { origin: [0, 0] as [number, number], size: [100, 100] as [number, number], range: 10 },
  caustics: { tiling: 1, speed: 1, brightness: 1 },
  foam: { tiling: 1, speed: 1, clipping: 0.5, length: 1, falloff: 1, color: [1, 1, 1] },
  rim: [1, 1] as [number, number],
  color: [0, 0.2, 0.3],
  normal: 1,
}
ok("sea", seaGraph("s", sea))
ok("sea rippled", seaGraph("s", { ...sea, ripple: [1, 1, 0.1] }))

console.log("stage-graphs-compile: ok")
