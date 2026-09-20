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
import { parseSceneDoc, serializeSceneDoc, type SceneLight, type SceneDoc } from "@/lib/scene"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"

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

console.log("scene-lights: ok")
