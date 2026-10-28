// Tests for what a scene document says about identity: each model's id and each
// group's id and pass, through every round trip, and the format-1 upgrade.
//
//   npx esbuild lib/scene-ids.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs
//
// The report behind it: after a stage came in, a refresh gave the character the
// stage's groups. The ids were minted again from filenames in document order,
// and two models of one filename came back each wearing the other's name.

import "@/lib/test-stock.mts"
import assert from "node:assert/strict"
import type { ShaderGraph, StyleGroup } from "reze-engine"
import { assetsDocOf, parseAssetsDoc, parseSceneDoc, serializeSceneDoc, type SceneDoc, type SceneModel } from "@/lib/scene"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { stockEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { upgradeSceneDoc, type V1SceneDoc } from "@/lib/scene-upgrade"

const model = (id: string, path: string, extra: Partial<SceneModel> = {}): SceneModel => ({
  model: { id, file: path.split("/").pop()!, source: { kind: "bundle", path } },
  animation: null,
  morph: null,
  ...extra,
})
const assets = (models: SceneModel[]) => ({
  models,
  cameraAnimation: null,
  audio: null,
  midi: null,
  lyrics: null,
  background: null,
  hdri: null,
  planes: [],
  bundle: null,
})
const graph = (name: string, extra: Partial<ShaderGraph> & { opacity?: unknown } = {}) =>
  ({ version: 1, name, nodes: [], links: [], output: { node: "x", socket: "y" }, ...extra }) as ShaderGraph

// ── Two models of one filename, listed out of the order they were named in ──
// The character was deleted and uploaded again, so she is "model" and stands
// after the stage, which took "model-2" while she was first in the scene.
const live = [
  model("model-2", "stages/model-2/model.pmx", { stage: true }),
  model("model", "models/model/model.pmx", { prop: false }),
  model("ring", "models/ring/ring.pmx", { prop: true, attach: { model: "model", bone: "右手首" } }),
]
{
  const back = parseAssetsDoc(assetsDocOf(assets(live) as never))
  assert.deepEqual(back.models.map((m) => m.model.id), ["model-2", "model", "ring"], "the local record keeps every id")
  assert.equal(back.models[2].attach?.model, "model", "and what names one still names it")
}

// ── The published document: ids, and every pass field a group has ──
const base = parseSceneDoc(EMPTY_SCENE_DOC, stockEffect, libraryGraph)
const groups: Record<string, StyleGroup[]> = {
  model: [
    { id: "hair", label: "Hair", materials: ["髪"], graph: graph("AG Hair"), renderClass: "hair" },
    { id: "cloth_smooth", label: "Smooth Cloth", materials: ["服"], graph: graph("AG Smooth Cloth") },
    { id: "stockings", label: "Stockings", materials: ["靴下"], graph: graph("AG Stockings"), alphaMode: "hashed" },
    { id: "stage-glass", label: "Glass", materials: ["眼鏡"], graph: graph("Glass"), blend: "premultiplied" },
  ],
  "model-2": [{ id: "stage-light-sheet-x4", label: "Stage Light Sheet ×4", materials: ["光"], graph: graph("Stage Light Sheet ×4"), blend: "additive" }],
}
const published = serializeSceneDoc({
  ...assets(live),
  name: "t",
  camera: base.state.camera,
  settings: base.state.settings,
  backgroundEffects: [],
  groups,
  hidden: {},
  lights: [],
})
{
  const back = parseSceneDoc(published, stockEffect, libraryGraph)
  assert.deepEqual(back.assets.models.map((m) => m.model.id), ["model-2", "model", "ring"])
  const pass = (g: StyleGroup) => [g.id, g.renderClass ?? "auto", g.alphaMode ?? "opaque", g.blend ?? "over"]
  assert.deepEqual(back.state.groups?.model?.map(pass), groups.model.map(pass), "her groups, as she wore them")
  assert.deepEqual(back.state.groups?.["model-2"]?.map(pass), groups["model-2"].map(pass), "the stage's, as it wore them")
}

// ── A document that does not say who is who is refused ──
{
  const noId = structuredClone(published) as unknown as V1SceneDoc
  delete (noId.assets.models[0] as { id?: string }).id
  assert.throws(() => parseSceneDoc(noId as SceneDoc, stockEffect, libraryGraph), /has no id/)
  const twice = structuredClone(published)
  twice.assets.models[1].id = "model-2"
  assert.throws(() => parseSceneDoc(twice, stockEffect, libraryGraph), /two models are called "model-2"/)
}

// ── Format 1: the ids it has been opening with, and the pass its graphs state ──
{
  const v1: V1SceneDoc = {
    ...structuredClone(EMPTY_SCENE_DOC),
    version: 1,
    assets: {
      ...structuredClone(EMPTY_SCENE_DOC.assets),
      models: [
        { model: "stages/x/model.pmx", stage: true, materials: { groups: [
          { label: "Stage Light Sheet ×1 (in haze)", materials: ["a"], graph: graph("Stage Light Sheet ×1 (in haze)", { tags: ["stage", "unlit", "effect"] }) },
          { label: "Effect fx", materials: ["b"], graph: graph("Effect fx", { tags: ["stage", "unlit", "effect"] }) },
          { label: "Effect veil", materials: ["c"], graph: graph("Effect veil", { tags: ["stage", "unlit", "effect"], opacity: { node: "n", socket: "value" } }) },
          { label: "Glow ×4", materials: ["d"], graph: graph("Unlit") },
          { label: "Stage PBR (cutout)", materials: ["e"], graph: graph("Stage PBR (cutout)", { tags: ["stage", "pbr"] }), role: "stockings" },
        ] } },
        { model: "models/a/model.pmx", materials: { groups: [
          { label: "Hair", materials: ["髪"], graph: "AG Hair", role: "hair" },
          { label: "Glass", materials: ["眼鏡"], graph: { id: "0f0f" } },
          { label: "Glass", materials: ["窓"], graph: graph("My Window") },
          { materials: ["目"], graph: "AG Eye", role: "eye" },
        ] } },
      ],
    },
  }
  const doc = upgradeSceneDoc(v1)
  assert.equal(doc.version, 2)
  assert.deepEqual(doc.assets.models.map((m) => m.id), ["model", "model-2"], "document order, as format 1 opened")
  const fields = (i: number) =>
    doc.assets.models[i].materials!.groups.map((g) => [g.id, g.renderClass ?? "-", g.alphaMode ?? "-", g.blend ?? "-"].join(" "))
  assert.deepEqual(fields(0), [
    "stage-light-sheet-1-in-haze - - additive",
    "effect-fx - - additive",
    "effect-veil - - -",
    "glow-4 - - -",
    "stage-pbr-cutout - hashed -",
  ])
  assert.deepEqual(fields(1), ["hair hair - -", "glass - - premultiplied", "glass-2 - - -", "eye eye - -"])
  assert.ok(!doc.assets.models[1].materials!.groups.some((g) => "role" in g), "role is gone")
  assert.equal(upgradeSceneDoc(doc), doc, "format 2 comes back as it is")
}

console.log("scene ids: ok")
