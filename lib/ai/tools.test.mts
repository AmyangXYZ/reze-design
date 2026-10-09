// Tests for the agent's tools, run against fake editor handles.
//
//   npx esbuild lib/ai/tools.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/tt.mjs && node /tmp/tt.mjs
//
// Everything a tool decides is checked here: validation, clamping, unit
// conversion (degrees, seconds → 30fps frames), which editor setter it calls
// and with what. What needs a GPU — capture, and framing against a posed model
// — is checked in the browser through window.rezeTools.

import assert from "node:assert/strict"
import { runSceneTool, type SceneToolHandles } from "./scene-tools"
import { checkSettingsPatch, describeSettings } from "./settings-schema"
import { frameShot, type Figure } from "./framing"
import { EFFECTS } from "@/lib/effects"
import { sameGradeLook } from "@/lib/grade"
import type { SceneLight } from "@/lib/scene"
import type { AppliedEffect } from "@/lib/effects"
import type { VisibilityWindow } from "@/lib/timeline"
import { installCrashLog } from "@/lib/crash-log"
import { guardLoops } from "./wgsl-guard"
import GRAPHS from "@/content/graphs.json"

/** A real built-in graph, so the compile in write_shader is the real check. */
const REAL_GRAPH = (GRAPHS as { name: string; payload: { graph: Record<string, unknown> } }[])[0].payload.graph

/** A graph with one wired input and two literal ones — enough to tell a
 *  tunable value from a socket another node feeds. */
const BODY_GRAPH = {
  version: 1,
  name: "AG Body",
  nodes: [
    { id: "lam", type: "lambert" },
    { id: "toon", type: "ramp_cardinal", inputs: { pos0: 0.25, pos1: 0.35 } },
  ],
  links: [{ from: { node: "lam", socket: "fac" }, to: { node: "toon", socket: "fac" } }],
  output: { node: "toon", socket: "color" },
}

let failures = 0
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

/** Handles over plain state, recording every call a tool makes. */
function fake(over: Partial<SceneToolHandles> = {}) {
  const calls: { fn: string; args: unknown[] }[] = []
  const state = {
    lamps: [] as SceneLight[],
    effects: [] as AppliedEffect[],
    visibility: {} as Record<string, VisibilityWindow[]>,
  }
  const rec = (fn: string) => (...args: unknown[]) => void calls.push({ fn, args })
  const h: SceneToolHandles = {
    engine: () => null,
    canvas: () => null,
    settings: {
      sun: { color: "#ffffff", strength: 1, azimuth: 0, elevation: 30 },
      world: { color: "#ffffff", strength: 1 },
      bloom: { enabled: true, threshold: 0.7, scatter: 0.8, intensity: 1, color: "#ffffff" },
      grade: { preset: "Neutral", intensity: 1 },
    } as unknown as SceneToolHandles["settings"],
    patchSettings: rec("patchSettings"),
    camera: { distance: 30, alpha: Math.PI, beta: Math.PI / 2.5, fov: Math.PI / 4, target: [0, 11, 0] },
    setCamera: rec("setCamera"),
    cast: [{ id: "m1", name: "Reze" }],
    stageCount: 0,
    groups: {
      m1: [
        { id: "hair", label: "Hair", materials: ["h"], graph: { name: "AG Hair" } },
        { id: "body", label: "Body", materials: ["b"], graph: BODY_GRAPH },
      ],
    } as unknown as SceneToolHandles["groups"],
    hidden: {},
    get effects() {
      return state.effects
    },
    effectLibrary: EFFECTS.map((e) => ({ id: e.id, name: e.name, description: e.description ?? "", wgsl: e.payload.wgsl })),
    addEffect: (e) => {
      const uid = `u${state.effects.length + 1}`
      state.effects = [...state.effects, { ...e, uid }]
      calls.push({ fn: "addEffect", args: [e] })
      return uid
    },
    patchEffect: (uid, part) => {
      state.effects = state.effects.map((e) => (e.uid === uid ? { ...e, ...part } : e))
      calls.push({ fn: "patchEffect", args: [uid, part] })
    },
    removeEffect: (uid) => {
      state.effects = state.effects.filter((e) => e.uid !== uid)
      calls.push({ fn: "removeEffect", args: [uid] })
    },
    get lamps() {
      return state.lamps
    },
    setLamps: (update) => {
      state.lamps = update(state.lamps)
    },
    newLampId: () => `lamp${state.lamps.length + 1}`,
    cameraTarget: [0, 11, 0],
    get lanes() {
      return [{ id: "m1", name: "Reze", kind: "character" as const, visibility: state.visibility.m1 ?? [] }]
    },
    setVisibility: (id, w) => {
      state.visibility[id] = w
    },
    shaderLibrary: [{ name: "AG Hair", about: "" }, { name: "WuWa Hair", about: "" }],
    assignShader: (m, g, s) => (calls.push({ fn: "assignShader", args: [m, g, s] }), s === "Nope" ? "no shader" : null),
    setGroupGraph: async (m, g, graph) => (calls.push({ fn: "setGroupGraph", args: [m, g, graph] }), null),
    applyLookPack: rec("applyLookPack"),
    musicUrl: null,
    time: () => 0,
    duration: 30,
    seek: rec("seek"),
    backdrop: null,
    backgroundColor: "#000000",
    aspect: 16 / 9,
    defaults: {
      settings: { sun: { strength: 1.5 }, bloom: { intensity: 0.2 } } as unknown as SceneToolHandles["settings"],
      camera: { distance: 40, alpha: Math.PI, beta: 1.2, fov: 0.8, target: [0, 10, 0] },
      effects: [],
      lamps: [],
    },
    replaceEffects: (list) => {
      state.effects = list
      calls.push({ fn: "replaceEffects", args: [list] })
    },
    authorEffect: async (name, wgsl, replace) => {
      calls.push({ fn: "authorEffect", args: [name, wgsl, replace] })
      return wgsl.includes("BROKEN")
        ? { ok: false, diagnostics: ["3:5 error: unresolved identifier 'BROKEN'"] }
        : { ok: true, diagnostics: [], name, uid: "u9", params: [{ name: "SPEED", kind: "float", value: 1 }] }
    },
    graphSource: (name) => (name.toLowerCase() === "real" ? (REAL_GRAPH as never) : null),
    saveGraphDraft: (name, graph) => (calls.push({ fn: "saveGraphDraft", args: [name, graph] }), name),
    saveGradeDraft: (spec, name) => (calls.push({ fn: "saveGradeDraft", args: [spec, name] }), name ?? "AI Grade"),
    ...over,
  }
  return { h, calls, state }
}

const call = (calls: { fn: string; args: unknown[] }[], fn: string) => calls.filter((c) => c.fn === fn)

// ── settings ───────────────────────────────────────────────────────────────

await test("a settings patch is clamped to the slider's range and reported", () => {
  const c = checkSettingsPatch({ sun: { strength: 5, elevation: -10 } })
  assert.deepEqual(c.apply, { sun: { strength: 2, elevation: 0 } })
  assert.equal(c.clamped.length, 2)
  assert.equal(c.errors.length, 0)
})

await test("unknown sections and fields are refused with what exists", () => {
  const c = checkSettingsPatch({ sky: { blue: 1 }, sun: { brightness: 1 } })
  assert.equal(Object.keys(c.apply).length, 0)
  assert.match(c.errors[0], /unknown section "sky"/)
  assert.match(c.errors[1], /sun has color, strength/)
})

await test("colours must be #rrggbb and are lowercased; enums must be listed", () => {
  const c = checkSettingsPatch({ bloom: { color: "#FFAA00" }, world: { color: "red" }, view: { transform: "filmic" } })
  assert.deepEqual(c.apply, { bloom: { color: "#ffaa00" } })
  assert.equal(c.errors.length, 2)
})

await test("stage-owned and unlisted blocks cannot be patched", () => {
  const c = checkSettingsPatch({ stageFog: { amount: 1 }, physics: { gravity: 0 } })
  assert.equal(Object.keys(c.apply).length, 0)
})

await test("the settings reference lists every section with ranges", () => {
  const text = describeSettings()
  assert.match(text, /sun — /)
  assert.match(text, /strength \(0–2\)/)
  assert.match(text, /transform \(soft\|neutral\|aces\|none\)/)
})

await test("set_settings calls the editor's patcher once per section", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("set_settings", { patch: { sun: { strength: 1.2 }, bloom: { intensity: 0.5 } } }, h)
  assert.deepEqual(
    call(calls, "patchSettings").map((c) => c.args),
    [
      ["sun", { strength: 1.2 }],
      ["bloom", { intensity: 0.5 }],
    ],
  )
  assert.deepEqual((r.data as { errors: string[] }).errors, [])
})

await test("picking a grade preset clears a custom grade left from before", async () => {
  const { h, calls } = fake()
  await runSceneTool("set_settings", { patch: { grade: { preset: "Moonlit" } } }, h)
  const [section, part] = call(calls, "patchSettings")[0].args as [string, Record<string, unknown>]
  assert.equal(section, "grade")
  assert.equal(part.preset, "Moonlit")
  assert.ok("spec" in part && part.spec === undefined)
  assert.ok("from" in part && part.from === undefined)
})

await test("set_grade builds a custom spec over the current grade, clamped", async () => {
  const { h, calls } = fake()
  await runSceneTool("set_grade", { shadows: { hue: 570, amount: 3 }, contrast: 9 }, h)
  const [, part] = call(calls, "patchSettings")[0].args as [string, { preset: string; spec: { shadows: number[]; contrast: number } }]
  assert.equal(part.preset, "AI Grade", "worn under the draft it was saved as")
  assert.deepEqual(call(calls, "saveGradeDraft")[0].args[0], part.spec, "the draft holds what is worn")
  assert.equal(part.spec.shadows[0], 210, "hue wraps into 0–360")
  assert.equal(part.spec.shadows[1], 1, "amount clamps to 1")
  assert.equal(part.spec.contrast, 1.6)
})

await test("a grade matches its published copy whatever order jsonb gives its keys", async () => {
  const ai = { shadows: [210, 0.18, 0.5] as const, midtones: [0, 0] as const, highlights: [35, 0.18] as const, contrast: 1.05, saturation: 1.05 }
  const fromDb = JSON.parse('{"shadows":[210,0.18],"contrast":1.05,"midtones":[0,0,0.5],"highlights":[35,0.18],"saturation":1.05}')
  assert.ok(sameGradeLook(ai, fromDb), "reordered keys and a defaulted lightness are the same grade")
  assert.ok(!sameGradeLook(ai, { ...fromDb, contrast: 1.1 }), "a real difference still differs")
})

// ── camera ─────────────────────────────────────────────────────────────────

await test("set_camera takes degrees and clamps pitch, distance and fov", async () => {
  const { h, calls } = fake()
  await runSceneTool("set_camera", { yaw: 90, pitch: 200, distance: 1, fov: 200 }, h)
  const cam = call(calls, "setCamera")[0].args[0] as { alpha: number; beta: number; distance: number; fov: number }
  assert.ok(Math.abs(cam.alpha - Math.PI / 2) < 1e-9)
  assert.ok(cam.beta < Math.PI, "pitch kept off the pole")
  assert.equal(cam.distance, 2)
  assert.ok(Math.abs(cam.fov - Math.PI / 2) < 1e-9)
})

await test("get_scene reads the camera back in degrees", async () => {
  const { h } = fake()
  const r = await runSceneTool("get_scene", {}, h)
  const cam = (r.data as { camera: { yaw: number; pitch: number; fov: number } }).camera
  assert.equal(cam.yaw, 180)
  assert.equal(cam.pitch, 72)
  assert.equal(cam.fov, 45)
})

const FIGURE: Figure = { head: [0, 16, 0], chest: [0, 13, 0], hips: [0, 10, 0], feet: [0, 0, 0] }

await test("a wider shot stands further back, all aimed inside the figure", () => {
  const fov = Math.PI / 4
  const d = (["closeup", "medium", "full", "wide"] as const).map((s) => frameShot(FIGURE, s, "front", fov).distance)
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], JSON.stringify(d))
  const close = frameShot(FIGURE, "closeup", "front", fov)
  assert.ok(close.target[1] > 12 && close.target[1] < 18, `closeup aims at the head, got ${close.target[1]}`)
})

await test("a full shot fits head to feet in the field of view", () => {
  const fov = Math.PI / 4
  const v = frameShot(FIGURE, "full", "front", fov)
  const visible = 2 * v.distance * Math.tan(fov / 2)
  assert.ok(visible >= 17.4 && visible < 17.4 * 1.3, `visible ${visible}`)
})

await test("angles: front faces her, back is opposite, low looks up", () => {
  const f = frameShot(FIGURE, "full", "front", 1)
  const b = frameShot(FIGURE, "full", "back", 1)
  const low = frameShot(FIGURE, "full", "low", 1)
  assert.ok(Math.abs(f.alpha - Math.PI) < 1e-9)
  assert.ok(Math.abs(b.alpha) < 1e-9)
  assert.ok(low.beta > Math.PI / 2)
})

await test("a portrait frame stands further back to fit the width", () => {
  const wide = frameShot(FIGURE, "full", "front", 1, 16 / 9)
  const tall = frameShot(FIGURE, "full", "front", 1, 9 / 16)
  assert.ok(tall.distance > wide.distance)
})

await test("frame_shot without a model reports it rather than throwing", async () => {
  const { h } = fake()
  const r = await runSceneTool("frame_shot", { shot: "full", angle: "front" }, h)
  assert.match((r.data as { error: string }).error, /no character/)
})

// ── look ───────────────────────────────────────────────────────────────────

await test("assign_shader finds the group by name and calls the editor", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("assign_shader", { character: "reze", group: "Hair", shader: "WuWa Hair" }, h)
  assert.deepEqual(call(calls, "assignShader")[0].args, ["m1", "hair", "WuWa Hair"])
  assert.equal((r.data as { shader: string }).shader, "WuWa Hair")
})

await test("assign_shader names the groups when one does not exist", async () => {
  const { h } = fake()
  const r = await runSceneTool("assign_shader", { group: "skirt", shader: "AG Hair" }, h)
  assert.match((r.data as { error: string }).error, /groups are hair, body/)
})

await test("apply_look_pack refuses an unknown pack", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("apply_look_pack", { pack: "genshin" }, h)
  assert.match((r.data as { error: string }).error, /ag, wuwa, zzz, hsr/)
  assert.equal(call(calls, "applyLookPack").length, 0)
})

// ── effects ────────────────────────────────────────────────────────────────

await test("list_effects reads every built-in's dials and lengths", async () => {
  const { h } = fake()
  const r = await runSceneTool("list_effects", {}, h)
  const list = r.data as { name: string; dials: unknown[] }[]
  assert.equal(list.length, EFFECTS.length)
  assert.ok(list.some((e) => e.dials.length > 0), "some built-in declares a dial")
})

await test("add_effect turns seconds into 30fps clips with fades", async () => {
  const { h, state } = fake()
  const r = await runSceneTool("add_effect", { name: "sakura drift", clips: [{ start: 8, end: 20, fadeIn: 1, fadeOut: 2 }] }, h)
  assert.equal((r.data as { id: string }).id, "u1")
  assert.deepEqual(state.effects[0].window, [{ start: 240, end: 600, blendIn: 30, blendOut: 60 }])
  assert.equal(state.effects[0].name, "Sakura Drift")
})

await test("add_effect clamps a dial to its author's range and names a wrong one", async () => {
  const { h, state } = fake()
  // `#param float NAME default min max`
  const ranged = /#param\s+float\s+(\w+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/
  const withDial = EFFECTS.find((e) => ranged.test(e.payload.wgsl))
  assert.ok(withDial, "a built-in with a ranged float dial")
  const m = withDial!.payload.wgsl.match(ranged)!
  const [, dial, , , max] = m
  const r = await runSceneTool("add_effect", { name: withDial!.name, dials: { [dial]: 1e9, nonsense: 1 } }, h)
  assert.equal(state.effects[0].params?.[dial], Number(max))
  assert.match((r.data as { errors: string[] }).errors[0], /no dial "nonsense"/)
})

await test("update_effect replaces clips; [] means always", async () => {
  const { h, state } = fake()
  await runSceneTool("add_effect", { name: "Snow", clips: [{ start: 1, end: 2 }] }, h)
  await runSceneTool("update_effect", { effect: "snow", clips: [] }, h)
  assert.deepEqual(state.effects[0].window, [])
  const r = await runSceneTool("get_effects", {}, h)
  assert.equal((r.data as { clips: unknown }[])[0].clips, "always")
})

await test("remove_effect by name, and a missing one is an error", async () => {
  const { h, state } = fake()
  await runSceneTool("add_effect", { name: "Snow" }, h)
  await runSceneTool("remove_effect", { effect: "Snow" }, h)
  assert.equal(state.effects.length, 0)
  const r = await runSceneTool("remove_effect", { effect: "Snow" }, h)
  assert.match((r.data as { error: string }).error, /no effect/)
})

await test("effects target characters by name", async () => {
  const { h, state } = fake()
  await runSceneTool("add_effect", { name: "Snow", characters: ["Reze", "Nobody"] }, h)
  assert.deepEqual(state.effects[0].models, ["m1"])
})

// ── lamps ──────────────────────────────────────────────────────────────────

await test("add_lamp: defaults, clamps, spot from an aim, keys in frames", async () => {
  const { h, state } = fake()
  await runSceneTool(
    "add_lamp",
    { name: "Rim", position: [0, 500, 0], intensity: 5000, aim: [0, 10, 0], keys: { intensity: [[4, 60], [0, 0]], color: [[1, "#ff0000"], [2, "blue"]] } },
    h,
  )
  const l = state.lamps[0]
  assert.equal(l.name, "Rim")
  assert.deepEqual(l.position, [0, 100, 0])
  assert.equal(l.intensity, 1000)
  assert.equal(l.angle, 40, "a spot gets a default cone")
  assert.deepEqual(l.track?.intensity, [[0, 0], [120, 60]], "keys sorted, seconds to frames")
  assert.deepEqual(l.track?.color, [[30, "#ff0000"]], "a bad colour key is dropped")
})

await test("add_lamp with no position goes where the camera looks", async () => {
  const { h, state } = fake()
  await runSceneTool("add_lamp", {}, h)
  assert.deepEqual(state.lamps[0].position, [0, 11, 0])
  assert.equal(state.lamps[0].color, "#ffd9a0")
})

await test("update_lamp by name; keys: {} makes it static; a stage lamp becomes the scene's", async () => {
  const { h, state } = fake()
  state.lamps = [{ id: "s1", name: "Bar Light", position: [0, 0, 0], color: "#ffffff", intensity: 1, radius: 5, stage: "st", track: { intensity: [[0, 1]] } }]
  await runSceneTool("update_lamp", { lamp: "bar light", color: "#00ff00", keys: {} }, h)
  assert.equal(state.lamps[0].color, "#00ff00")
  assert.equal(state.lamps[0].track, undefined)
  assert.equal(state.lamps[0].stage, undefined)
})

await test("remove_lamp", async () => {
  const { h, state } = fake()
  await runSceneTool("add_lamp", { name: "A" }, h)
  await runSceneTool("remove_lamp", { lamp: "A" }, h)
  assert.equal(state.lamps.length, 0)
})

// ── visibility, music, errors ──────────────────────────────────────────────

await test("set_visibility in seconds, with dissolves; [] is always on", async () => {
  const { h, state } = fake()
  await runSceneTool("set_visibility", { model: "Reze", clips: [{ start: 2, end: 10, fadeIn: 0.5, fadeOut: 0.5 }] }, h)
  assert.deepEqual(state.visibility.m1, [{ start: 60, end: 300, blendIn: 15, blendOut: 15 }])
  await runSceneTool("set_visibility", { model: "m1", clips: [] }, h)
  const r = await runSceneTool("get_visibility", {}, h)
  assert.equal((r.data as { clips: unknown }[])[0].clips, "always")
})

await test("a fade-out needs an end to measure from", async () => {
  const { h, state } = fake()
  await runSceneTool("set_visibility", { model: "Reze", clips: [{ start: 2, fadeOut: 1 }] }, h)
  assert.deepEqual(state.visibility.m1, [{ start: 60 }])
})

await test("get_music without music says so", async () => {
  const { h } = fake()
  const r = await runSceneTool("get_music", {}, h)
  assert.match((r.data as { error: string }).error, /no music/)
})

await test("seek clamps to the scene and calls the transport", async () => {
  ;(globalThis as { requestAnimationFrame?: (f: () => void) => void }).requestAnimationFrame = (f) => setTimeout(f, 0)
  const { h, calls } = fake()
  const r = await runSceneTool("seek", { seconds: 99 }, h)
  assert.deepEqual(call(calls, "seek")[0].args, [30])
  assert.equal((r.data as { time: number }).time, 30)
})

await test("capture with no engine is an error, not a throw", async () => {
  const { h } = fake()
  const r = await runSceneTool("capture", {}, h)
  assert.match((r.data as { error: string }).error, /not ready/)
})

await test("a group's shader lists its literal inputs and not its wired ones", async () => {
  const { h } = fake()
  const r = await runSceneTool("get_shader_inputs", { group: "body" }, h)
  const toon = (r.data as { nodes: { node: string; inputs: Record<string, unknown> }[] }).nodes.find((n) => n.node === "toon")
  assert.ok(toon, "the ramp is tunable")
  assert.equal(toon.inputs.pos0, 0.25)
  assert.ok(!("fac" in toon.inputs), "fac is wired from the lambert, not a value to turn")
})

await test("tuning a shader writes the node input and nothing else", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("set_shader_inputs", { group: "Body", changes: [{ node: "toon", socket: "pos0", value: 0.4 }] }, h)
  assert.ok(!("error" in (r.data as object)), JSON.stringify(r.data))
  const [, group, graph] = call(calls, "setGroupGraph")[0].args as [string, string, typeof BODY_GRAPH]
  assert.equal(group, "body")
  assert.equal(graph.nodes.find((n) => n.id === "toon")!.inputs!.pos0, 0.4)
  assert.equal(graph.nodes.find((n) => n.id === "toon")!.inputs!.pos1, 0.35)
  assert.equal(BODY_GRAPH.nodes[1].inputs!.pos0, 0.25, "the original graph is not mutated")
})

await test("a tuned shader is saved as a draft and worn under its name", async () => {
  const drafts: { fn: string; args: unknown[] }[] = []
  // A built-in's name is taken, so the draft comes back suffixed.
  const { h, calls } = fake({ saveGraphDraft: (name, graph) => (drafts.push({ fn: "saveGraphDraft", args: [name, graph] }), `${name} 2`) })
  const r = await runSceneTool("set_shader_inputs", { group: "Body", changes: [{ node: "toon", socket: "pos0", value: 0.4 }] }, h)
  assert.equal((r.data as { saved?: string }).saved, "AG Body 2")
  const [wanted, saved] = call(drafts, "saveGraphDraft")[0].args as [string, typeof BODY_GRAPH]
  assert.equal(wanted, "AG Body", "asks for the name it wore, so a draft of that name updates in place")
  assert.equal(saved.nodes.find((n) => n.id === "toon")!.inputs!.pos0, 0.4)
  const [, , worn] = call(calls, "setGroupGraph")[0].args as [string, string, typeof BODY_GRAPH]
  assert.equal(worn.name, "AG Body 2", "the group and the library agree on the name")
})

await test("a shader tune that changes nothing saves no draft", async () => {
  const { h, calls } = fake()
  await runSceneTool("set_shader_inputs", { group: "Body", changes: [{ node: "toon", socket: "pos0", value: 0.25 }] }, h)
  assert.equal(call(calls, "saveGraphDraft").length, 0)
  assert.equal(call(calls, "setGroupGraph").length, 1)
})

await test("a shader change of the wrong shape or to a wired socket is refused", async () => {
  const { h, calls } = fake()
  const shape = await runSceneTool("set_shader_inputs", { group: "body", changes: [{ node: "toon", socket: "pos0", value: [1, 1, 1] }] }, h)
  assert.match((shape.data as { error: string }).error, /takes a number/)
  const wired = await runSceneTool("set_shader_inputs", { group: "body", changes: [{ node: "toon", socket: "fac", value: 1 }] }, h)
  assert.match((wired.data as { error: string }).error, /not a value that can be changed/)
  assert.equal(call(calls, "setGroupGraph").length, 0)
})

await test("errors logged while a tool runs come back with its result", async () => {
  // The log hooks console.error, and only in a page: a stub window for it.
  const g = globalThis as { window?: unknown }
  g.window = { addEventListener: () => {} }
  installCrashLog()
  delete g.window
  const { h } = fake({ setCamera: () => console.error("GPU validation: bad bind group (expected in this test)") })
  const r = await runSceneTool("set_camera", { yaw: 10 }, h)
  assert.deepEqual((r.data as { console?: string[] }).console, ["error: GPU validation: bad bind group (expected in this test)"])
})

await test("reset_to_default puts the look, camera, effects and lamps back", async () => {
  const { h, calls, state } = fake()
  state.effects = [{ uid: "x", name: "Red Rain" } as AppliedEffect]
  const r = await runSceneTool("reset_to_default", {}, h)
  assert.ok(!("error" in (r.data as object)), JSON.stringify(r.data))
  const sections = call(calls, "patchSettings").map((c) => c.args[0])
  assert.deepEqual(sections, ["sun", "bloom"], "only sections the default has")
  assert.equal((call(calls, "setCamera")[0].args[0] as { distance: number }).distance, 40)
  assert.deepEqual(state.effects, [])
})

await test("reset_to_default can take one part, and refuses parts it does not know", async () => {
  const { h, calls } = fake()
  await runSceneTool("reset_to_default", { parts: ["camera"] }, h)
  assert.equal(call(calls, "patchSettings").length, 0)
  assert.equal(call(calls, "setCamera").length, 1)
  const bad = await runSceneTool("reset_to_default", { parts: ["cast"] }, h)
  assert.match((bad.data as { error: string }).error, /unknown part cast/)
})

// ── writing effects and shaders ─────────────────────────────────────────────

await test("the loop guard refuses what can run away and allows what cannot", () => {
  assert.equal(guardLoops("fn f() { while (true) { } }").length, 1)
  assert.equal(guardLoops("fn f() { loop { break; } }").length, 1)
  assert.equal(guardLoops("fn f() { for (var i = 0; i < 100000; i++) {} }").length, 1)
  assert.equal(guardLoops("fn f() { for (var i = 0u; i < n; i++) {} }").length, 1, "an unknown bound is refused")
  assert.deepEqual(guardLoops("fn f() { for (var i = 0; i < 64; i++) {} }"), [])
  assert.deepEqual(guardLoops("fn f() { for (var i = 0u; i < rzLightCount(); i++) {} }"), [])
  assert.deepEqual(guardLoops("fn f() { for (var i = 0; i < i32(params.STEPS); i++) {} }"), [])
  assert.deepEqual(guardLoops(["// while (true) in a comment", "/* loop { */ fn f() {}"].join("\n")), [], "comments are not code")
})

await test("write_effect refuses a runaway loop before it reaches the GPU", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("write_effect", { name: "Spin", wgsl: "fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f { loop { } }" }, h)
  assert.match((r.data as { error: string }).error, /refused before compiling/)
  assert.equal(call(calls, "authorEffect").length, 0)
})

await test("write_effect hands compiler errors back, and a good one is saved", async () => {
  const { h } = fake()
  const bad = await runSceneTool("write_effect", { name: "Glow", wgsl: "fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f { return BROKEN; }" }, h)
  assert.match(JSON.stringify(bad.data), /unresolved identifier/)
  const good = await runSceneTool("write_effect", { name: "Glow", wgsl: ["#param float SPEED 1 0 4", "fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f { return vec4f(0.0); }"].join("\n") }, h)
  assert.equal((good.data as { saved: string }).saved, "Glow")
})

await test("write_effect catches an unknown directive without compiling", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("write_effect", { name: "X", wgsl: ["#sparkle 3", "fn foreground(ray: vec3f, uv: vec2f, time: f32, depth: f32) -> vec4f { return vec4f(0.0); }"].join("\n") }, h)
  assert.match((r.data as { error: string }).error, /directive/)
  assert.equal(call(calls, "authorEffect").length, 0)
})

await test("write_shader compiles a real graph, saves it and puts it on the group", async () => {
  const { h, calls } = fake()
  const r = await runSceneTool("write_shader", { name: "My Body", graph: REAL_GRAPH, group: "body" }, h)
  assert.equal((r.data as { saved: string }).saved, "My Body", JSON.stringify(r.data))
  assert.equal(call(calls, "saveGraphDraft").length, 1)
  const [, group, graph] = call(calls, "setGroupGraph")[0].args as [string, string, { name: string }]
  assert.equal(group, "body")
  assert.equal(graph.name, "My Body")
})

await test("write_shader refuses a graph the compiler rejects, and saves nothing", async () => {
  const { h, calls } = fake()
  const broken = { nodes: [{ id: "x", type: "no_such_node" }], links: [], output: { node: "x", socket: "color" } }
  const r = await runSceneTool("write_shader", { name: "Bad", graph: broken, group: "body" }, h)
  assert.match((r.data as { error: string }).error, /did not compile/)
  assert.ok((r.data as { diagnostics: string[] }).diagnostics.length > 0)
  assert.equal(call(calls, "saveGraphDraft").length, 0)
})

await test("the guides are the manual's own sections", async () => {
  const { h } = fake()
  const fx = (await runSceneTool("read_authoring_guide", { topic: "effects" }, h)).data as { guide: string }
  const gr = (await runSceneTool("read_authoring_guide", { topic: "graphs" }, h)).data as { guide: string }
  assert.match(fx.guide, /#param/)
  assert.match(gr.guide, /Appendix D/)
})

await test("an unknown tool and a throwing tool both come back as errors", async () => {
  const { h } = fake({ setCamera: () => { throw new Error("boom") } })
  assert.match(((await runSceneTool("fly", {}, h)).data as { error: string }).error, /no tool named fly/)
  assert.match(((await runSceneTool("set_camera", { yaw: 1 }, h)).data as { error: string }).error, /boom/)
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
