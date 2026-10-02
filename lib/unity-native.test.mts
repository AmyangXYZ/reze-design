// Tests for the game's own files in a scene — where they resolve, and that
// they survive the round trip. Not the drawing: that is the engine's.
//
//   npx esbuild lib/unity-native.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/un.mjs && node /tmp/un.mjs
//
// A scene from ag-rip names a stage FOLDER and, per prop, a look.json, and
// everything else those two need comes along by path rather than by name. So
// the failures this guards are all quiet ones: a texture resolved against the
// bundle root instead of the look's folder, a document writer that drops the
// field, a repack that keeps the scene.json's word for the stage and loses the
// files it names.

import assert from "node:assert/strict"
import { parseSceneDoc, serializeSceneDoc, assetsDocOf, parseAssetsDoc, type SceneDoc } from "@/lib/scene"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { collectSceneSlots } from "@/lib/scene-collect"
import type { EngineModelInfo } from "@/lib/scene-host"
import { clearEngineScene, dress, lookFilePaths, lookUniformTracks, stageFolder, undress, type NativeLookFile } from "@/lib/unity-native"
import { applyTimelineFrame, timelineOf, uniformAt } from "@/lib/timeline"
import type { Engine, NativeLook } from "reze-engine"

// ── A look's files resolve against the look's own folder ──
{
  const look: NativeLookFile = {
    shaders: ["SimPipeline_PBR_Standard_p0_23ec593d"],
    textures: { t115: { file: "tex/t115.png", srgb: true }, t116: { file: "tex\\t116.png", srgb: false } },
    materials: [],
  }
  const p = lookFilePaths("props/X306a_beizi/look.json", look)
  assert.deepEqual(p.shaders, [
    {
      name: "SimPipeline_PBR_Standard_p0_23ec593d",
      vert: "props/X306a_beizi/shaders/SimPipeline_PBR_Standard_p0_23ec593d.vert.wgsl",
      frag: "props/X306a_beizi/shaders/SimPipeline_PBR_Standard_p0_23ec593d.frag.wgsl",
      info: "props/X306a_beizi/shaders/SimPipeline_PBR_Standard_p0_23ec593d.json",
    },
  ])
  assert.deepEqual(p.textures, [
    { key: "t115", path: "props/X306a_beizi/tex/t115.png", srgb: true },
    // A Windows-written path is the same file.
    { key: "t116", path: "props/X306a_beizi/tex/t116.png", srgb: false },
  ])
  // A look at the bundle root has no folder to prefix.
  assert.equal(lookFilePaths("look.json", look).textures[0]!.path, "tex/t115.png")
  assert.equal(stageFolder("stage"), "stage/")
  assert.equal(stageFolder("stage/"), "stage/")
}

// ── The document carries both fields, both ways ──
const prop = {
  model: "props/X306a_beizi/X306a_beizi.pmx",
  animation: "props/X306a_beizi/X306a_beizi.vmd",
  prop: true,
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
  look: "props/X306a_beizi/look.json",
} as SceneDoc["assets"]["models"][number]
const doc: SceneDoc = {
  ...EMPTY_SCENE_DOC,
  assets: { ...EMPTY_SCENE_DOC.assets, models: [prop], nativeStage: "stage/" },
}
const scene = parseSceneDoc(doc, builtinEffect, libraryGraph)
{
  assert.equal(scene.assets.nativeStage, "stage/")
  assert.equal(scene.assets.models[0]!.look, "props/X306a_beizi/look.json")
  // The local-persistence writer and its reader.
  const stored = assetsDocOf(scene.assets)
  assert.equal(stored.nativeStage, "stage/")
  assert.equal(stored.models[0]!.look, "props/X306a_beizi/look.json")
  assert.deepEqual(parseAssetsDoc(stored).models[0]!.look, "props/X306a_beizi/look.json")
  // A scene with neither writes neither — it reads as every scene before them.
  const plain = assetsDocOf(parseSceneDoc(EMPTY_SCENE_DOC, builtinEffect, libraryGraph).assets)
  assert.ok(!("nativeStage" in plain), "no stage, no key")
}

// ── The repack keeps the files the document names, and only those ──
{
  const f = (name: string) => new File(["x"], name)
  const bundleFiles = [
    f("scene.json"),
    f("stage/stage.json"),
    f("stage/meshes/m0.bin"),
    f("stage/textures/t0.webp"),
    f("stage/shaders/a.vert.wgsl"),
    f("stage2/stage.json"),
    f("props/X306a_beizi/X306a_beizi.pmx"),
    f("props/X306a_beizi/look.json"),
    f("props/X306a_beizi/tex/t115.png"),
    f("props/X306a_beizi/shaders/a.json"),
    f("camera.vmd"),
  ]
  const id = scene.assets.models[0]!.model.id
  const live = { id, file: "X306a_beizi.pmx", materials: [] } as unknown as EngineModelInfo
  const collect = (nativeStage: string | null) =>
    collectSceneSlots({
      models: [live],
      stages: [],
      props: [{ id, file: "X306a_beizi.pmx", transform: prop.transform!, morphs: {}, attach: null, parentKeys: [] }],
      booted: scene.assets.models,
      bundleFiles,
      anims: {},
      camera: { name: null, booted: null },
      audio: { name: null, url: null },
      midi: { name: null, booted: null },
      lyrics: { name: null, booted: null },
      background: null,
      hdri: null,
      planes: [],
      nativeStage,
    })
  const slots = collect("stage/")
  const paths = slots.entries.map((e) => e.path).sort()
  assert.deepEqual(paths, [
    "props/X306a_beizi/X306a_beizi.pmx",
    "props/X306a_beizi/look.json",
    "props/X306a_beizi/shaders/a.json",
    "props/X306a_beizi/tex/t115.png",
    "stage/meshes/m0.bin",
    "stage/shaders/a.vert.wgsl",
    "stage/stage.json",
    "stage/textures/t0.webp",
  ])
  assert.equal(slots.nativeStage, "stage/")
  assert.equal(slots.models[0]!.look, "props/X306a_beizi/look.json")
  // And the exported document says so.
  const out = serializeSceneDoc({
    ...slots,
    bundle: null,
    name: "t",
    camera: scene.state.camera,
    settings: scene.state.settings,
    backgroundEffects: [],
    groups: {},
    lights: [],
  })
  assert.equal(out.assets.nativeStage, "stage/")
  assert.equal(out.assets.models[0]!.look, "props/X306a_beizi/look.json")

  // Removed: the stage is not named and its files are not packed.
  const gone = collect(null)
  assert.equal(gone.nativeStage, null)
  assert.ok(!gone.entries.some((e) => e.path.startsWith("stage")), "a removed stage leaves the bundle")
}

// ── A look's keyed material values play on the timeline's clock ──
{
  // X324 touch1's pour stream, as ag-rip writes it: the dissolve rises over
  // frames 287..296 and holds; the colour's alpha fades with it. The second
  // material keys nothing and the third is not keyed at all.
  const look: NativeLookFile = {
    shaders: [],
    textures: {},
    materials: [
      {
        materials: ["water1_fx_X324_water1"],
        queue: 3000,
        passes: [],
        values: { _DissovleStrength: 0, _Color: [1, 0.857157, 0.692071, 0.045] },
        textures: {},
        uniforms: {
          _DissovleStrength: [
            [287, 0],
            [288, 0.022291],
            [292, 0.378946],
            [296, 0.65],
          ],
          _Color: [
            [287, [1, 0.857157, 0.692071, 0.045]],
            [296, [1, 0.857157, 0.692071, 0.00126]],
          ],
        },
      },
      { materials: ["water3_a", "water3_b"], queue: 3000, passes: [], values: {}, textures: {}, uniforms: { _DissovleStrength: [] } },
      { materials: ["cup"], queue: 2000, passes: [], values: {}, textures: {} },
    ],
  }
  const tracks = lookUniformTracks(look)
  assert.deepEqual(Object.keys(tracks), ["water1_fx_X324_water1"], "only keyed materials, by the model's names")
  assert.deepEqual(lookUniformTracks({ materials: [look.materials[2]!] }), {}, "a look keying nothing gives nothing to visit")

  // Sampling: held before the first key and after the last, linear between,
  // a step where two keys share a frame.
  const k = tracks.water1_fx_X324_water1!._DissovleStrength!
  assert.equal(uniformAt(k, 0), 0)
  assert.equal(uniformAt(k, 400), 0.65)
  assert.ok(Math.abs((uniformAt(k, 290) as number) - (0.022291 + (0.378946 - 0.022291) * 0.5)) < 1e-12)
  assert.equal(uniformAt([[5, 1], [5, 2], [9, 3]], 5), 2, "the later of two keys on a frame wins")
  const c = uniformAt(tracks.water1_fx_X324_water1!._Color!, 291.5) as number[]
  assert.deepEqual(c.slice(0, 3), [1, 0.857157, 0.692071], "a vector key interpolates per channel")
  assert.ok(Math.abs(c[3]! - (0.045 + (0.00126 - 0.045) * 0.5)) < 1e-12)

  // Dressed: the engine is handed the values of the frame the timeline is at,
  // once per frame the clock moves, and nothing once the look is off.
  const calls: [string, string, Record<string, unknown>][] = []
  const engine = {
    setModelNativeLook: () => true,
    setModelNativeUniforms: (m: string, mat: string, v: Record<string, unknown>) => (calls.push([m, mat, v]), true),
    getModel: () => null,
    setModelDissolve: () => true,
    getModelNames: () => [],
    removeModel: () => {},
    setNativeStage: async () => {},
  } as unknown as Engine
  const loaded = { look: { shaders: [], textures: {}, materials: [] } as NativeLook, uniforms: tracks }
  const timeline = timelineOf({})
  assert.ok(dress(engine, "pour", loaded))
  assert.deepEqual(calls, [["pour", "water1_fx_X324_water1", { _DissovleStrength: 0, _Color: [1, 0.857157, 0.692071, 0.045] }]], "set at once, at the frame last drawn")
  calls.length = 0
  applyTimelineFrame(engine as never, timeline, 296)
  assert.deepEqual(calls, [["pour", "water1_fx_X324_water1", { _DissovleStrength: 0.65, _Color: [1, 0.857157, 0.692071, 0.00126] }]])
  applyTimelineFrame(engine as never, timeline, 296)
  assert.equal(calls.length, 1, "a frame the values are already at sets nothing")
  // a scrub back: the export and the preview read the same function
  applyTimelineFrame(engine as never, timeline, 100)
  assert.equal(calls.at(-1)![2]._DissovleStrength, 0)
  calls.length = 0
  undress(engine, "pour")
  applyTimelineFrame(engine as never, timeline, 290)
  assert.equal(calls.length, 0, "an undressed model is not visited")
  // and a cleared scene forgets every one
  dress(engine, "pour", loaded)
  await clearEngineScene(engine)
  calls.length = 0
  applyTimelineFrame(engine as never, timeline, 291)
  assert.equal(calls.length, 0, "a cleared scene is not visited")
}

console.log("unity-native: ok")
