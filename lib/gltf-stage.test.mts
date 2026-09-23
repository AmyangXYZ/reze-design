// The glTF stage reader, on the real file the Unity pipeline produced.
//
//   npx esbuild lib/gltf-stage.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/gs.mjs && node /tmp/gs.mjs
//
// The pipeline is Unity → Blender → glTF → here, and every hop can turn an axis,
// flip a V or scale a unit. So the file is read as the app reads it and checked
// against the game's own numbers: every lamp to the millimetre, the sun's
// angles, the UVs where the game's mesh puts them.

import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { readPmxDocument } from "reze-engine"
import { glbToStage, glbStyleGroups } from "@/lib/gltf-stage"

const GLB = "stages/x323-glb/X323.glb"
if (!existsSync(GLB)) {
  console.log("gltf-stage: skipped (stages/x323-glb is not here)")
  process.exit(0)
}

const buffer = readFileSync(GLB)
const stage = glbToStage(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "x323/X323.glb")

// ── The folder ──
assert.equal(stage.pmxPath, "x323/X323.pmx")
const paths = stage.files.map((f) => f.path)
assert.ok(paths.includes("x323/X323.lights.json"), "the rig")
assert.ok(paths.includes("x323/X323.hdr"), "the world")
assert.ok(paths.some((p) => p.startsWith("x323/tex/")), "textures under tex/")
assert.ok(paths.some((p) => /^x323\/maps\/.*_ORM\.png$/.test(p)), "maps under maps/")

// ── The PMX ──
const pmxFile = stage.files.find((f) => f.path === stage.pmxPath)!
const doc = readPmxDocument((pmxFile.bytes as Uint8Array).buffer.slice((pmxFile.bytes as Uint8Array).byteOffset) as ArrayBuffer)
assert.equal(doc.materials.length, 44, "one PMX material per glTF material")
assert.equal(doc.materials.length, stage.materials.length)
assert.ok(doc.vertices.length > 50000, `vertices: ${doc.vertices.length}`)
assert.equal(
  doc.materials.reduce((n, m) => n + m.indexCount, 0),
  doc.indices.length,
  "materials own the whole index buffer",
)
const glowing = stage.materials.filter((m) => m.emissiveStrength > 1)
assert.ok(glowing.length >= 5, `materials brighter than white: ${glowing.map((m) => `${m.name}×${m.emissiveStrength}`).join(", ")}`)
const sky = stage.materials.filter((m) => m.sky)
assert.ok(sky.length >= 1, "the dome is marked as sky")
for (const s of sky) assert.equal(doc.materials.find((m) => m.name === s.name)!.drawFlags & 0x04, 0, "and casts nothing")

// ── The UVs land where the game's mesh puts them ──
// The stool's islands sit in the top fifth of its atlas; a V flipped one time
// too many put them in the bottom fifth, and the seat wore the ribbed strip.
{
  const stool = doc.materials.findIndex((m) => m.name === "X323_chair_001")
  assert.ok(stool >= 0)
  let at = 0
  for (let i = 0; i < stool; i++) at += doc.materials[i].indexCount
  const vs = Array.from(doc.indices.subarray(at, at + doc.materials[stool].indexCount), (v) => doc.vertices[v].uv[1])
  const vmax = Math.max(...vs)
  assert.ok(vmax < 0.3, `stool UVs reach v ${vmax.toFixed(2)}; they belong in the top of the atlas`)
}

// ── The rig, as the Unity pipeline read it out of the game ──
// These are the game's numbers through Unity → Blender → glTF → here, verified
// once against a direct read of the scene file: every lamp to the millimetre,
// same reach, intensity, colour and cone; the sun's angles, its strength as
// W/m² and the cast's fill.
const RIG_LAMPS: { position: number[]; radius: number; intensity: number; color: string; aim?: number[]; angle?: number; innerAngle?: number }[] = [{"position":[-1.104,1.664,9.576],"color":"#ffb791","intensity":3.464,"radius":3.19},{"position":[7.304,3.512,8.656],"color":"#ffbf65","intensity":17.981,"radius":3.954},{"position":[-3.616,7.64,8.376],"color":"#ffb753","intensity":12.285,"radius":3.954},{"position":[-6.128,9.936,8.424],"color":"#ffb349","intensity":62.802,"radius":4.016,"aim":[0.7051,-0.7071,-0.0537],"angle":63.83,"innerAngle":21.8},{"position":[0.76,1.464,14.56],"color":"#ffc859","intensity":6.543,"radius":2.48},{"position":[-0.034,30.96,15.456],"color":"#ffaf61","intensity":2109.095,"radius":24.0},{"position":[27.552,17.92,20.256],"color":"#ffaf61","intensity":276.067,"radius":32.0},{"position":[-21.866,17.704,29.068],"color":"#ffaf61","intensity":673.621,"radius":28.0},{"position":[12.678,20.048,34.152],"color":"#ffaf60","intensity":146.605,"radius":24.0},{"position":[-38.944,16.792,38.256],"color":"#ffc593","intensity":6130.525,"radius":83.941,"aim":[0.9115,-0.3627,0.1939],"angle":12.84,"innerAngle":9.61},{"position":[-1.433,2.736,58.924],"color":"#ff9f47","intensity":10.514,"radius":8.0},{"position":[-6.437,30.64,51.606],"color":"#ffaf61","intensity":673.621,"radius":40.0},{"position":[5.201,20.048,59.623],"color":"#ffaf60","intensity":146.605,"radius":40.0},{"position":[-6.448,35.32,53.328],"color":"#ffaf61","intensity":673.621,"radius":15.879,"aim":[0.0014,-0.9679,-0.2513],"angle":121.14,"innerAngle":21.8},{"position":[-55.192,31.624,34.76],"color":"#ffbe73","intensity":9912.143,"radius":113.292,"aim":[0.9011,-0.388,0.1934],"angle":6.76,"innerAngle":5.97},{"position":[-26.16,26.2,73.296],"color":"#ffb547","intensity":302.028,"radius":10.407,"aim":[0.7051,-0.7071,-0.0537],"angle":63.83,"innerAngle":21.8},{"position":[-42.591,30.04,84.908],"color":"#ffaf61","intensity":1268.472,"radius":28.0},{"position":[-41.92,35.32,83.92],"color":"#ffaf61","intensity":673.621,"radius":15.879,"aim":[0.0014,-0.9679,-0.2513],"angle":121.14,"innerAngle":21.8},{"position":[-46.359,30.04,106.566],"color":"#ffaf61","intensity":1268.472,"radius":28.0},{"position":[-2.384,32.288,142.192],"color":"#ffaf61","intensity":658.89,"radius":16.0,"aim":[0.0648,-0.8112,0.5811],"angle":42.26,"innerAngle":21.8},{"position":[-3.74,67.84,-235.802],"color":"#ffdd95","intensity":1013.574,"radius":157.44}]
const RIG_SUN = {"color": "#ffca99", "strength": 21.112, "azimuth": 284.2, "elevation": 11.3, "shadow": true}
const RIG_FILL = {"color": "#99795e", "strength": 1.0}
const rig = JSON.parse(new TextDecoder().decode(stage.files.find((f) => f.path === "x323/X323.lights.json")!.bytes as Uint8Array))
assert.equal(rig.lamps.length, RIG_LAMPS.length, "same lamp count")
const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.01
for (const lamp of rig.lamps) {
  const twin = RIG_LAMPS.find((l) => near(l.position, lamp.position))
  assert.ok(twin, `${lamp.name} at ${lamp.position} stands where the game put a lamp`)
  assert.ok(Math.abs(twin.radius - lamp.radius) < 0.01, `${lamp.name} reach ${lamp.radius} vs ${twin.radius}`)
  assert.ok(Math.abs(twin.intensity - lamp.intensity) / Math.max(twin.intensity, 1e-6) < 0.01, `${lamp.name} intensity ${lamp.intensity} vs ${twin.intensity}`)
  assert.equal(twin.color, lamp.color, `${lamp.name} colour`)
  if (twin.aim) {
    assert.ok(near(twin.aim, lamp.aim), `${lamp.name} aim ${lamp.aim} vs ${twin.aim}`)
    assert.ok(Math.abs(twin.angle! - lamp.angle) < 0.05, `${lamp.name} cone`)
  }
}
assert.ok(Math.abs(rig.sun.azimuth - RIG_SUN.azimuth) < 0.15, `sun azimuth ${rig.sun.azimuth} vs ${RIG_SUN.azimuth}`)
assert.ok(Math.abs(rig.sun.elevation - RIG_SUN.elevation) < 0.15, `sun elevation ${rig.sun.elevation} vs ${RIG_SUN.elevation}`)
assert.ok(Math.abs(rig.sun.strength - RIG_SUN.strength) / RIG_SUN.strength < 0.01, `sun strength ${rig.sun.strength} vs ${RIG_SUN.strength}`)
assert.equal(rig.sun.color, RIG_SUN.color)
assert.deepEqual(rig.fill, RIG_FILL)
// The view the .blend was set to, so the stage arrives looking as the .blend
// renders it: Filmic at +0.6, the same field export_stage.py writes.
assert.deepEqual(rig.view, { transform: "filmic", exposure: 0.6 }, "a Unity stage carries the view its .blend renders under")

// ── The looks ──
const groups = glbStyleGroups(stage.materials)
const covered = new Set(groups.flatMap((g) => g.materials))
assert.equal(covered.size, stage.materials.length, "every material is in a group")
assert.ok(groups.some((g) => g.id.startsWith("stage-pbr-x")), "a Stage PBR group per emissive strength")

console.log(`gltf-stage: ok — ${doc.materials.length} materials, ${doc.vertices.length} vertices, ${rig.lamps.length} lamps, ${groups.length} groups, glowing: ${glowing.map((m) => `${m.name}×${m.emissiveStrength}`).join(", ")}`)
for (const n of stage.notes) console.log("  note:", n)
