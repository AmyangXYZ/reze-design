// Tests for a scene's several stages: which stage a part belongs to, through the
// document and out of scenes written when a scene held one stage.
//
//   npx esbuild lib/stage-parts.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/sp.mjs && node /tmp/sp.mjs

import "@/lib/test-stock.mts"
import assert from "node:assert/strict"
import { parseSceneDoc, type SceneDoc } from "@/lib/scene"
import { withStageParts, type StageInfo } from "@/lib/scene-host"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { stockEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"

let failed = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`)
  }
}

const at = (x: number) => ({ position: [x, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: 1 })
const stage = (id: string, x = 0, partOf?: string): StageInfo => ({ id, file: `${id}.pmx`, transform: at(x), morphs: {}, ...(partOf ? { partOf } : {}) })

test("a document carries which stage a part belongs to", () => {
  const doc: SceneDoc = {
    ...EMPTY_SCENE_DOC,
    assets: {
      ...EMPTY_SCENE_DOC.assets,
      models: [
        { id: "room", model: "stages/room/room.pmx", stage: true, transform: at(0) },
        { id: "sky", model: "stages/sky/sky.pmx", stage: true, partOf: "room", transform: at(0) },
        { id: "plaza", model: "stages/plaza/plaza.pmx", stage: true, transform: at(40) },
        // A cast member naming a parent is not a part: only a stage can be one.
        { id: "a", model: "models/a/a.pmx", partOf: "room" },
      ],
    },
  }
  const models = parseSceneDoc(doc, stockEffect, libraryGraph).assets.models
  assert.deepEqual(
    models.map((m) => m.partOf ?? null),
    [null, "room", null, null],
  )
})

test("an old scene's extra stages at the first one's place are its parts", () => {
  const read = withStageParts([stage("room"), stage("sky"), stage("fx")])
  assert.deepEqual(
    read.map((s) => s.partOf ?? null),
    [null, "room", "room"],
  )
})

test("stages standing apart, or any that names a parent, are read as written", () => {
  const apart = [stage("room"), stage("plaza", 40)]
  assert.equal(withStageParts(apart), apart)
  const named = [stage("room"), stage("sky", 0, "room"), stage("plaza")]
  assert.equal(withStageParts(named), named)
  const one = [stage("room")]
  assert.equal(withStageParts(one), one)
})

console.log(failed ? `\n${failed} failed` : "\nall passed")
process.exit(failed ? 1 : 0)
