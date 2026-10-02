// Tests for scene patches: a document that changes the scene instead of
// replacing it (lib/scene-patch).
//
//   npx esbuild lib/scene-patch.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/sp.mjs && node /tmp/sp.mjs
//
// The user's character and its motion are what a patch must never touch, and a
// second take of a sequence must replace the first's props and effects rather
// than stack on them. Those are the failures guarded here, with the plain merge
// rules (null clears, absent keeps, objects merge) beside them.

import assert from "node:assert/strict"
import { parseSceneDoc, type SceneDoc } from "@/lib/scene"
import { EMPTY_SCENE_DOC } from "@/lib/default-scene"
import { builtinEffect } from "@/lib/effects"
import { libraryGraph } from "@/lib/materials"
import { isScenePatch, mergePatch, mergePatchFiles, mergeScenePatch, patchRoots } from "@/lib/scene-patch"

/** A scene with a character, her motion and materials, a hand-added effect and a camera. */
const base = (): SceneDoc => ({
  ...structuredClone(EMPTY_SCENE_DOC),
  name: "mine",
  assets: {
    ...structuredClone(EMPTY_SCENE_DOC.assets),
    models: [
      {
        model: "/models/reze/reze.pmx",
        animation: "/motions/Demo.vmd",
        morph: null,
        materials: { groups: [{ label: "Body", materials: ["skin"], graph: "AG Body" }] },
      },
    ],
    cameraAnimation: "camera/mine.vmd",
    audio: "/audio/track.mp3",
  },
  settings: {
    ...structuredClone(EMPTY_SCENE_DOC.settings),
    background: { color: "#000000", effects: [{ source: "Shining Stars" }] },
  },
})

const prop = (name: string, origin?: string) => ({
  model: `props/${name}/${name}.pmx`,
  animation: `props/${name}/${name}.vmd`,
  prop: true,
  look: `props/${name}/look.json`,
  ...(origin ? { origin } : {}),
})
const fx = (name: string, stage?: string) => ({ source: { name, wgsl: `// ${name}` }, ...(stage ? { stage } : {}) })

const take = (seq: "touch1" | "touch2", props: string[], effects: string[]) => ({
  version: 1,
  patch: true,
  origin: "107402",
  assets: {
    models: props.map((p) => prop(p)),
    cameraAnimation: "camera.vmd",
    audio: "audio.wav",
    nativeStage: "stage/",
  },
  settings: {
    sun: { azimuth: seq === "touch1" ? 10 : 20, elevation: 30 },
    view: { transform: "aether-gazer" },
    background: { effects: effects.map((e) => fx(e)) },
  },
})

// ── Recognised by the flag alone ──
{
  assert.equal(isScenePatch(take("touch1", [], [])), true)
  assert.equal(isScenePatch(base()), false)
  assert.equal(isScenePatch({ patch: "yes" }), false)
  assert.equal(isScenePatch(null), false)
}

// ── RFC 7386: values overwrite, objects merge, null clears, absent keeps ──
{
  assert.deepEqual(mergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } }), { a: 1, b: { c: 9, d: 3 } })
  assert.deepEqual(mergePatch({ a: 1, b: 2 }, { a: null }), { b: 2 })
  assert.deepEqual(mergePatch({ a: [1, 2] }, { a: [3] }), { a: [3] })
  assert.deepEqual(mergePatch({ a: 1 }, { b: { c: null } }), { a: 1, b: {} })
}

// ── The first take lands on the scene: her, her clip and her materials stay ──
const one = mergeScenePatch(base(), take("touch1", ["cup", "fan"], ["sparks", "dust"]))
{
  assert.equal(one.name, "mine", "a patch without a name keeps the scene's")
  const ms = one.assets.models
  assert.deepEqual(
    ms.map((m) => m.model),
    ["/models/reze/reze.pmx", "props/cup/cup.pmx", "props/fan/fan.pmx"],
  )
  assert.equal(ms[0].animation, "/motions/Demo.vmd")
  assert.equal(ms[0].materials?.groups[0].label, "Body")
  assert.equal(ms[0].origin, undefined, "the user's own character carries no tag")
  assert.ok(ms.slice(1).every((m) => m.origin === "107402"), "the patch's tag is stamped on what it brings")
  assert.equal(one.assets.cameraAnimation, "camera.vmd")
  assert.equal(one.assets.audio, "audio.wav")
  assert.equal(one.assets.nativeStage, "stage/")
  // Settings it does not name stay; the ones it names merge field by field.
  assert.equal(one.settings.sun.azimuth, 10)
  assert.equal(one.settings.sun.color, "#ffffff", "a sibling the patch did not name stays")
  assert.equal(one.settings.sun.strength, 0.64)
  assert.equal(one.settings.ground.enabled, true)
  assert.equal(one.settings.background.color, "#000000")
  assert.deepEqual(one.settings.camera, base().settings.camera)
  // Her effect first, then the take's, tagged.
  const effs = one.settings.background.effects ?? []
  assert.equal(effs.length, 3)
  assert.equal(effs[0].source, "Shining Stars")
  assert.equal(effs[0].stage, undefined)
  assert.deepEqual(
    effs.slice(1).map((e) => e.stage),
    ["107402", "107402"],
  )
  // And it parses: the tag survives into the runtime scene.
  const scene = parseSceneDoc(one, builtinEffect, libraryGraph)
  assert.deepEqual(
    scene.assets.models.map((m) => [m.model.id, m.origin ?? null]),
    [
      ["reze", null],
      ["cup", "107402"],
      ["fan", "107402"],
    ],
  )
  assert.equal(scene.assets.models[0].animation?.url, "/motions/Demo.vmd")
  assert.equal(scene.state.backgroundEffects.filter((e) => e.stage === "107402").length, 2)
}

// ── The second take replaces the first's props and effects, never stacks ──
{
  const two = mergeScenePatch(one, take("touch2", ["fan", "book"], ["rain"]))
  assert.deepEqual(
    two.assets.models.map((m) => m.model),
    ["/models/reze/reze.pmx", "props/fan/fan.pmx", "props/book/book.pmx"],
    "cup was the first take's and is gone; fan is replaced in place; book is new",
  )
  assert.equal(two.assets.models[0].animation, "/motions/Demo.vmd")
  const effs = two.settings.background.effects ?? []
  assert.deepEqual(
    effs.map((e) => (typeof e.source === "string" ? e.source : "name" in e.source ? e.source.name : e.source.id)),
    ["Shining Stars", "rain"],
  )
  assert.equal(two.settings.sun.azimuth, 20)
  // Applying the same take twice is the same scene.
  assert.deepEqual(mergeScenePatch(two, take("touch2", ["fan", "book"], ["rain"])), two)
}

// ── Keyed by id: replace in place, remove, and leave the unlisted alone ──
{
  const doc = base()
  doc.assets.models.push(prop("cup"), { ...prop("cup"), model: "other/cup.pmx" })
  const out = mergeScenePatch(doc, {
    patch: true,
    assets: { models: [{ id: "cup-2", remove: true }, { ...prop("cup"), animation: "new.vmd" }] },
  })
  assert.deepEqual(
    out.assets.models.map((m) => [m.model, m.animation]),
    [
      ["/models/reze/reze.pmx", "/motions/Demo.vmd"],
      ["props/cup/cup.pmx", "new.vmd"],
    ],
  )
  // Untagged models are never swept by a tag: a patch with none leaves them be.
  const kept = mergeScenePatch(doc, { patch: true, origin: "x", assets: { models: [] } })
  assert.equal(kept.assets.models.length, 3)
}

// ── Null clears; `cast: null` clears the cast and only the cast ──
{
  const doc = base()
  doc.assets.models.push({ ...prop("cup"), origin: "a" }, { model: "stages/room/room.pmx", stage: true })
  const out = mergeScenePatch(doc, {
    patch: true,
    assets: { cast: null, cameraAnimation: null },
    settings: { background: { effects: null } },
  })
  assert.deepEqual(
    out.assets.models.map((m) => m.model),
    ["props/cup/cup.pmx", "stages/room/room.pmx"],
  )
  assert.equal(out.assets.cameraAnimation, undefined)
  assert.equal(parseSceneDoc(out, builtinEffect, libraryGraph).assets.cameraAnimation, null)
  assert.deepEqual(out.settings.background.effects, [])
  assert.equal("cast" in out.assets, false, "the patch's own vocabulary never lands in the scene")
}

// ── Absent keeps: a patch that only moves the sun leaves everything else ──
{
  const doc = mergeScenePatch(base(), take("touch1", ["cup"], ["sparks"]))
  const out = mergeScenePatch(doc, { patch: true, origin: "107402", settings: { sun: { elevation: 45 } } })
  assert.equal(out.assets.models.length, 2, "no models listed: the tagged ones stay")
  assert.equal(out.settings.background.effects?.length, 2, "no effects listed: the tagged ones stay")
  assert.equal(out.settings.sun.elevation, 45)
  assert.equal(out.settings.sun.azimuth, 10)
  assert.equal(out.version, 1)
  assert.equal("patch" in out, false)
  assert.equal("origin" in out, false)
}

// ── Files: two sources, one bundle ──
{
  const t = take("touch2", ["fan"], [])
  assert.deepEqual(patchRoots(t), ["stage/", "props/fan/"])
  const f = (path: string, from: string) => ({ path, from })
  const merged = mergePatchFiles(
    [
      f("models/reze/reze.pmx", "mine"),
      f("motions/reze/dance.vmd", "mine"),
      f("stage/stage.json", "old"),
      f("stage/meshes/gone.bin", "old"),
      f("props/fan/tex/a.png", "old"),
      f("camera.vmd", "old"),
    ],
    [f("stage/stage.json", "new"), f("props/fan/fan.pmx", "new"), f("camera.vmd", "new")],
    patchRoots(t),
  )
  assert.deepEqual(
    merged.map((e) => `${e.path}:${e.from}`),
    [
      "models/reze/reze.pmx:mine",
      "motions/reze/dance.vmd:mine",
      "stage/stage.json:new",
      "props/fan/fan.pmx:new",
      "camera.vmd:new",
    ],
  )
}

// ── castMotion: the patch's motion lands on her, and only her motion slot ──
{
  const doc = base()
  doc.assets.models[0].morph = "/motions/Demo-face.vmd"
  // A stage and a prop ahead of her: the lead is the first that is neither.
  doc.assets.models.unshift({ model: "stages/room/room.pmx", stage: true }, { ...prop("cup"), origin: "107402" })
  const t = { ...take("touch1", ["fan"], []), assets: { ...take("touch1", ["fan"], []).assets, castMotion: { animation: "character.vmd" } } }
  const out = mergeScenePatch(doc, t)
  const her = out.assets.models.find((m) => m.model === "/models/reze/reze.pmx")!
  assert.equal(her.animation, "character.vmd")
  assert.equal(her.morph, null, "the slot is replaced whole: the old overlay does not ride the new motion")
  assert.equal(her.materials?.groups[0].label, "Body", "her materials stay")
  assert.equal(out.assets.models.some((m) => m.model === "stages/room/room.pmx"), false, "the take's game stage replaced the room")
  assert.equal(out.assets.models.find((m) => m.model === "props/fan/fan.pmx")?.animation, "props/fan/fan.vmd")
  assert.equal(out.assets.cameraAnimation, "camera.vmd")
  assert.equal("castMotion" in out.assets, false, "the patch's own vocabulary never lands in the scene")
  // The AssetRef form is read for its url, and a morph it names lands too.
  const ref = mergeScenePatch(doc, { patch: true, assets: { castMotion: { animation: { name: "c", url: "character.vmd" }, morph: "face.vmd" } } })
  const her2 = ref.assets.models.find((m) => m.model === "/models/reze/reze.pmx")!
  assert.deepEqual([her2.animation, her2.morph], ["character.vmd", "face.vmd"])
  // It parses into the runtime slot.
  const scene = parseSceneDoc(out, builtinEffect, libraryGraph)
  const lead = scene.assets.models.find((m) => m.model.id === "reze")!
  assert.equal(lead.animation?.url, "character.vmd")
  assert.equal(lead.animation?.name, "character.vmd")
  // Only the first cast member moves.
  const two = base()
  two.assets.models.push({ model: "/models/miku/miku.pmx", animation: "/motions/m.vmd" })
  const o2 = mergeScenePatch(two, { patch: true, assets: { castMotion: { animation: "character.vmd" } } })
  assert.deepEqual(o2.assets.models.map((m) => m.animation), ["character.vmd", "/motions/m.vmd"])
}

// ── castMotion: null clears her motion; no cast member is a no-op ──
{
  const out = mergeScenePatch(base(), { patch: true, assets: { castMotion: null } })
  assert.equal(out.assets.models[0].animation, null)
  assert.equal(out.assets.models[0].morph, null)
  assert.equal(out.assets.models[0].model, "/models/reze/reze.pmx", "she stays")
  assert.equal(out.assets.models[0].materials?.groups[0].label, "Body")
  assert.equal(parseSceneDoc(out, builtinEffect, libraryGraph).assets.models[0].animation, null)

  const empty = base()
  empty.assets.models = [{ model: "stages/room/room.pmx", stage: true }, prop("cup")]
  const before = structuredClone(empty)
  const none = mergeScenePatch(empty, { patch: true, assets: { castMotion: { animation: "character.vmd" } } })
  assert.deepEqual(none.assets.models, before.assets.models, "no cast member: nothing moves")
  assert.equal("castMotion" in none.assets, false)
  // `cast: null` in the same patch leaves no one to move either.
  const gone = mergeScenePatch(base(), { patch: true, assets: { cast: null, castMotion: { animation: "character.vmd" } } })
  assert.equal(gone.assets.models.length, 0)
}

// ── Files: the patch's character.vmd survives the merge and replaces a stale one ──
{
  const t = { ...take("touch1", [], []), assets: { ...take("touch1", [], []).assets, castMotion: { animation: "character.vmd" } } }
  const f = (path: string, from: string) => ({ path, from })
  const merged = mergePatchFiles(
    [f("motions/reze/Demo.vmd", "mine"), f("character.vmd", "old")],
    [f("camera.vmd", "new"), f("character.vmd", "new")],
    patchRoots(t),
  )
  assert.deepEqual(
    merged.map((e) => `${e.path}:${e.from}`),
    ["motions/reze/Demo.vmd:mine", "camera.vmd:new", "character.vmd:new"],
  )
}

// ── Lights, by tag: the scene's own lamps stay, a take's replace the last take's ──
{
  const lamp = (id: string, stage?: string) => ({ id, kind: "point", color: "#ffffff", strength: 1, position: [0, 0, 0], ...(stage ? { stage } : {}) })
  const doc = base()
  doc.settings.lights = [lamp("mine")] as unknown as typeof doc.settings.lights
  const t1 = mergeScenePatch(doc, { patch: true, origin: "dlc", settings: { lights: [lamp("a"), lamp("b")] } })
  assert.deepEqual((t1.settings.lights ?? []).map((l) => `${l.id}:${l.stage ?? ""}`), ["mine:", "a:dlc", "b:dlc"])
  const t2 = mergeScenePatch(t1, { patch: true, origin: "dlc", settings: { lights: [lamp("c")] } })
  assert.deepEqual((t2.settings.lights ?? []).map((l) => `${l.id}:${l.stage ?? ""}`), ["mine:", "c:dlc"], "a take replaces the last take's lamps only")
  const quiet = mergeScenePatch(t1, { patch: true, origin: "dlc", settings: { sun: { elevation: 30 } } })
  assert.equal((quiet.settings.lights ?? []).length, 3, "a patch without lights leaves them alone")
}

// ── A game stage replaces the scene's stage, and what that stage brought ──
{
  const doc = base()
  doc.assets.models = [{ model: "stages/x340/x340.pmx", stage: true }, ...doc.assets.models] as typeof doc.assets.models
  const lamp = (id: string, stage?: string) => ({ id, kind: "point", color: "#ffffff", strength: 1, position: [0, 0, 0], ...(stage ? { stage } : {}) })
  doc.settings.lights = [lamp("mine"), lamp("glb", "x340")] as unknown as typeof doc.settings.lights
  const out = mergeScenePatch(doc, { patch: true, origin: "dlc", assets: { nativeStage: "stage/" }, settings: { lights: [lamp("game")] } })
  assert.equal(out.assets.models.some((m) => m.stage), false, "the old stage is gone")
  assert.ok(out.assets.models.length > 0, "the cast stays")
  assert.deepEqual((out.settings.lights ?? []).map((l) => l.id), ["mine", "game"], "its lamps went with it")
}

console.log("scene-patch: ok")
