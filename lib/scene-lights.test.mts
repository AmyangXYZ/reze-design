// Tests for a scene's lamps — the ROUND TRIP, not the lighting.
//
//   npx esbuild lib/scene-lights.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/sl.mjs && node /tmp/sl.mjs
//
// A lamp has to survive four separate writers: the document parser, the
// document writer, the localStorage blob and the viewer that reads the result.
// The shape of the bug this guards is written into scene.ts already — "a field
// added to only two of them silently stops round-tripping on the third" — and a
// lamp is exactly the kind of field that gets added to two. The failure is also
// invisible in the editor, where the value never left React state: it shows up
// as a published scene that opens unlit.

import assert from "node:assert/strict"
import { parseSceneDoc, serializeSceneDoc, stageLightsFromFile, type SceneLight, type SceneDoc } from "@/lib/scene"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { sceneOwned } from "@/lib/scene-settings"
import { applyLampFrame, lampAt, setLampRig } from "@/lib/timeline/lights"

const LAMPS: SceneLight[] = [
  { id: "a", name: "Candle", position: [1.5, 20, -3], color: "#ffd9a0", intensity: 1.4, radius: 18 },
  // A spot, which nothing in the UI can make yet — the document and the sync
  // have carried `aim`/`angle` from the start so an importer can write one, and
  // a round trip that quietly dropped them would only be found by the importer.
  {
    id: "b",
    name: "Lantern",
    position: [0, 8, 0],
    color: "#88ccff",
    intensity: 0.6,
    radius: 40,
    aim: [0, -1, 0],
    angle: 45,
    innerAngle: 20,
    on: false,
    // Brought by a stage: the owner has to survive the trip, or deleting the
    // stage after a reload leaves its lamps standing in an empty scene.
    stage: "X340",
  },
]

const empty = () => ({
  models: [],
  cameraAnimation: null,
  audio: null,
  midi: null,
  lyrics: null,
  background: null,
  hdri: null,
  planes: [],
  bundle: null,
})

const base = parseSceneDoc(EMPTY_SCENE_DOC, builtinEffect, libraryGraph)

function docWith(lights: SceneLight[]): SceneDoc {
  return serializeSceneDoc({
    ...empty(),
    name: "t",
    camera: base.state.camera,
    settings: base.state.settings,
    backgroundEffects: [],
    groups: {},
    hidden: {},
    lights,
  })
}

const read = (doc: SceneDoc) => parseSceneDoc(doc, builtinEffect, libraryGraph).state.lights

// ── The trip itself ──
{
  const back = read(docWith(LAMPS))
  assert.deepEqual(back, LAMPS, "a lamp must come back exactly as it went in")
}

// ── No lamps writes no field ──
// A scene lit by world and sun alone has to produce the document it produced
// before lamps existed, or every such scene churns on its next save.
{
  const doc = docWith([])
  assert.ok(!("lights" in doc.settings), "an unlit scene writes no lights key")
  assert.deepEqual(read(doc), [], "and reads back as none")
}

// ── A malformed lamp is refused at the door ──
// Not defensiveness: the shader's cull is `dist >= radius`, and `NaN >= r` is
// false — so one NaN lamp is evaluated for every pixel on screen, for ever.
{
  const bad = [
    { id: "x", name: "n", position: [0, NaN, 0], color: "#fff", intensity: 1, radius: 5 },
    { id: "y", name: "n", position: [0, 0, 0], color: "#fff", intensity: 1, radius: 0 },
    { id: "z", name: "n", position: [0, 0], color: "#fff", intensity: 1, radius: 5 },
    { name: "no id", position: [0, 0, 0], color: "#fff", intensity: 1, radius: 5 },
  ] as unknown as SceneLight[]
  const doc = docWith(bad)
  assert.deepEqual(read(doc), [], "every malformed lamp is dropped")
}

// ── A good lamp survives beside a bad one ──
{
  const mixed = [LAMPS[0], { ...LAMPS[1], radius: -1 }] as SceneLight[]
  assert.deepEqual(read(docWith(mixed)), [LAMPS[0]], "one bad lamp does not take the others with it")
}

// ── A stage's rig file ──
// The converter's shape, as tools/unity-stage/unity_lights.py writes it: no
// ids (the app mints them), owned by the stage it arrived with, and through
// the same door a document's lamps pass.
{
  const file = JSON.stringify({
    lamps: [
      { name: "X340 01", position: [0.5, 2.8, -6.1], color: "#ff9d61", intensity: 1.374, radius: 9.5 },
      {
        name: "X340 15",
        position: [8.8, 22.3, -1.6],
        color: "#ff9a5a",
        intensity: 183.078,
        radius: 24.2,
        aim: [-0.1429, -0.9849, -0.0974],
        angle: 44.23,
        innerAngle: 1,
      },
      { name: "broken", position: [0, 0, 0], color: "#fff", intensity: 1, radius: 0 },
    ],
    sun: { color: "#b2d0ff", strength: 1.724, azimuth: 358.9, elevation: 77, shadow: true },
  })
  const { lamps, sun } = stageLightsFromFile(file, "stage-id")
  assert.equal(lamps.length, 2, "the zero-radius lamp is refused like a document's would be")
  assert.ok(lamps.every((l) => l.stage === "stage-id"), "every lamp belongs to the stage it came with")
  assert.equal(new Set(lamps.map((l) => l.id)).size, 2, "every lamp is minted its own id")
  assert.deepEqual(lamps[1].aim, [-0.1429, -0.9849, -0.0974], "a spot keeps its aim")
  assert.deepEqual(sun, { color: "#b2d0ff", strength: 1.724, azimuth: 358.9, elevation: 77, shadow: true })
  assert.deepEqual(read(docWith(lamps)), lamps, "and they round-trip like any other lamp")
}

// ── A sun keeps only its sound fields ──
{
  const { sun } = stageLightsFromFile(JSON.stringify({ sun: { color: "blue", strength: NaN, elevation: 120, azimuth: 30 } }), "s")
  assert.deepEqual(sun, { azimuth: 30 }, "a bad colour, a NaN and an impossible elevation leave the scene's own")
}

// ── The sun a stage set remembers the one it replaced ──
// Deleting the stage puts `before` back, after a reload too — so the claim has
// to survive the document, and `sceneOwned` is what every edit leaves.
{
  const before = { ...base.state.settings.sun }
  const claimed = { ...before, color: "#b2d0ff", strength: 1.724, elevation: 77, stage: { id: "stage-id", before } }
  const doc = serializeSceneDoc({
    ...empty(),
    name: "t",
    camera: base.state.camera,
    settings: { ...base.state.settings, sun: claimed },
    backgroundEffects: [],
    groups: {},
    hidden: {},
    lights: [],
  })
  const back = parseSceneDoc(doc, builtinEffect, libraryGraph).state.settings.sun
  assert.deepEqual(back.stage, { id: "stage-id", before }, "the claim and the sun it replaced survive the document")
  assert.equal(back.elevation, 77)
  assert.ok(!("stage" in sceneOwned(back)), "an edited sun carries no claim")
  assert.equal(sceneOwned(back).elevation, 77, "and keeps its dials")
}

// ── The world a stage's sky set remembers its strength the same way ──
{
  const before = { ...base.state.settings.world }
  const claimed = { ...before, strength: 1, stage: { id: "stage-id", before } }
  const doc = serializeSceneDoc({
    ...empty(),
    name: "t",
    camera: base.state.camera,
    settings: { ...base.state.settings, world: claimed },
    backgroundEffects: [],
    groups: {},
    hidden: {},
    lights: [],
  })
  const back = parseSceneDoc(doc, builtinEffect, libraryGraph).state.settings.world
  assert.deepEqual(back, claimed, "the world's claim survives the document")
  assert.deepEqual(sceneOwned(back), { ...before, strength: 1 }, "and an edit leaves the strength without it")
}

// ── The effects a stage brings ──
// Named by built-in, with dials: a colour arrives as the hex a picker shows and
// is stored the way every colour dial is, each channel over 255.
{
  const { effects } = stageLightsFromFile(
    JSON.stringify({
      effects: [
        { name: "Galaxy Sky", params: { NEBULA: "#00279f", TURN: 30, BAD: "blue" } },
        { params: { TURN: 1 } },
      ],
    }),
    "stage-id",
  )
  assert.deepEqual(effects, [{ name: "Galaxy Sky", params: { NEBULA: { x: 0, y: 39 / 255, z: 159 / 255 }, TURN: 30 } }])
}

// ── The cast's fill a stage brings: whole or not at all ──
{
  const ok = stageLightsFromFile(JSON.stringify({ fill: { color: "#6d628e", strength: 1 } }), "stage-id")
  assert.deepEqual(ok.fill, { color: "#6d628e", strength: 1 })
  const bad = stageLightsFromFile(JSON.stringify({ fill: { color: "lavender", strength: 1 } }), "stage-id")
  assert.equal(bad.fill, null)
  assert.equal(stageLightsFromFile(JSON.stringify({}), "stage-id").fill, null)
}

// ── The world and the view a stage brings ──
{
  const r = stageLightsFromFile(JSON.stringify({ world: { color: "#000000", strength: 1 }, view: { transform: "agx", exposure: -0.55 } }), "s")
  assert.deepEqual(r.world, { color: "#000000", strength: 1 })
  // An old name reads as today's: AgX is Neutral.
  assert.deepEqual(r.view, { transform: "neutral", exposure: -0.55 })
  const bad = stageLightsFromFile(JSON.stringify({ world: { color: "black", strength: 1 }, view: { transform: "reinhard", exposure: 0 } }), "s")
  assert.equal(bad.world, null)
  assert.equal(bad.view, null)
  assert.deepEqual(stageLightsFromFile(JSON.stringify({ world: { strength: 0.5 } }), "s").world, { strength: 0.5 })
}

// ── An effect remembers the stage it came with ──
{
  const sky = { ...builtinEffect("Galaxy Sky"), params: { TURN: 30 }, stage: "stage-id" }
  const doc = serializeSceneDoc({
    ...empty(),
    name: "t",
    camera: base.state.camera,
    settings: base.state.settings,
    backgroundEffects: [sky],
    groups: {},
    hidden: {},
    lights: [],
  })
  const back = parseSceneDoc(doc, builtinEffect, libraryGraph).state.backgroundEffects
  assert.equal(back[0].stage, "stage-id", "the stage that brought it survives the document")
  assert.deepEqual(back[0].params, { TURN: 30 })
}

// ── A game's lamp: its bulb, its layers and its keys survive the trip ──
// The importer writes these from the recording; the parser is their only door,
// so it has to keep good keys, drop a bad one, and put them in frame order.
{
  const rig: SceneLight = {
    id: "r",
    name: "Rim",
    position: [4, 14, 8],
    color: "#4080ff",
    intensity: 321614,
    radius: 6.1,
    near: 30.04,
    layers: 0x40000001,
    stage: "113701",
    track: { position: [[1, 4, 14, 8], [30, 0, 12, 10]], radius: [[1, 6.1], [30, 9]] },
  }
  const back = read(docWith([rig]))
  assert.deepEqual(back, [rig], "bulb, layers and track come back exactly")
  const messy = read(
    docWith([
      {
        ...rig,
        near: Number.NaN,
        track: {
          position: [[30, 0, 12, 10], [1, 4, 14, 8], [2, Number.NaN, 0, 0]],
          color: [[1, "red"]],
          intensity: [],
        },
      } as SceneLight,
    ]),
  )
  assert.equal(messy[0].near, undefined, "a bulb that is not a number is dropped")
  assert.deepEqual(messy[0].track, { position: [[1, 4, 14, 8], [30, 0, 12, 10]] }, "bad keys go, good ones sort")
}

// ── A keyed lamp at a frame ──
{
  const l: SceneLight = {
    id: "k",
    name: "k",
    position: [0, 0, 0],
    color: "#000000",
    intensity: 1,
    radius: 1,
    track: { position: [[10, 0, 0, 0], [20, 10, 20, 30]], intensity: [[10, 2]], color: [[0, "#000000"], [10, "#ff0000"]] },
  }
  assert.deepEqual(lampAt(l, 15).position, [5, 10, 15], "linear between keys")
  assert.deepEqual(lampAt(l, 0).position, [0, 0, 0], "held before the first")
  assert.deepEqual(lampAt(l, 99).position, [10, 20, 30], "held after the last")
  assert.equal(lampAt(l, 3).intensity, 2, "a single key holds everywhere")
  assert.equal(lampAt(l, 5).color, "#800000", "colour keys blend as bytes")
  assert.equal(lampAt(l, 5).radius, 1, "an unkeyed channel keeps its field")
  const still = { ...l, track: undefined }
  assert.equal(lampAt(still, 5), still, "an unkeyed lamp is itself")

  // The rig: one write when set, one per MOVED frame when keyed, none when not.
  const writes: unknown[][] = []
  let captures = 0
  const engine = { setLights: (x: unknown[]) => void writes.push(x), captureReflectionProbe: () => void captures++ }
  setLampRig(engine, { fixed: ["sun"], lamps: [l], toEngine: (x) => x.position })
  assert.deepEqual(writes[0], ["sun", [0, 0, 0]])
  assert.equal(captures, 1, "setting the lamps re-captures the reflection probe")
  applyLampFrame(engine, 15)
  applyLampFrame(engine, 15)
  assert.equal(writes.length, 2, "a frame the lamps are already at writes nothing")
  assert.equal(captures, 1, "playing keyed lamps never re-captures it")
  assert.deepEqual(writes[1], ["sun", [5, 10, 15]], "the daylight rides along")
  setLampRig(engine, { fixed: [], lamps: [l], toEngine: (x) => x.position })
  assert.deepEqual(writes[2], [[5, 10, 15]], "a new list is sampled at the frame last drawn")
  const quiet = { setLights: (x: unknown[]) => void writes.push(x), captureReflectionProbe: () => {} }
  setLampRig(quiet, { fixed: [], lamps: [still], toEngine: (x) => x.id })
  applyLampFrame(quiet, 40)
  assert.equal(writes.length, 4, "an unkeyed rig is written once and never per frame")
}

console.log("scene-lights: ok")
