// Tests for lib/scene-history — what becomes a step, what merges, what undo puts back.
//
//   npx esbuild lib/scene-history.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/sh.mjs && node /tmp/sh.mjs

import assert from "node:assert/strict"
import { SceneHistory, MAX_STEPS, MERGE_MS, changedParts, type SceneSnapshot } from "./scene-history"

const base = (): SceneSnapshot =>
  ({
    settings: { sun: { strength: 1 }, bloom: { intensity: 1 } },
    camera: { distance: 30, alpha: 0, beta: 1, target: [0, 10, 0] },
    effects: [],
    lights: [],
    groups: { m1: [] },
    hidden: { m1: [] },
    visibility: {},
  }) as unknown as SceneSnapshot

const withSetting = (s: SceneSnapshot, key: string, value: unknown): SceneSnapshot => ({
  ...s,
  settings: { ...s.settings, [key]: value } as SceneSnapshot["settings"],
})

let failures = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

test("the first observe is the baseline, not a step", () => {
  const h = new SceneHistory()
  assert.equal(h.observe(base(), 0), null)
  assert.equal(h.peekUndo(), null)
})

test("an edit is one step, labelled by what changed", () => {
  const h = new SceneHistory()
  const a = base()
  h.observe(a, 0)
  const b = withSetting(a, "sun", { strength: 2 })
  const step = h.observe(b, 1000)
  assert.ok(step)
  assert.equal(step.label, "Sun")
  assert.deepEqual(step.parts, ["settings.sun"])
})

test("a drag on one control merges into one step", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  for (let i = 1; i <= 10; i++) {
    s = withSetting(s, "sun", { strength: 1 + i / 10 })
    h.observe(s, 1000 + i * 50)
  }
  const restored = h.undo()
  assert.ok(restored)
  assert.equal((restored.settings as unknown as { sun: { strength: number } }).sun.strength, 1)
  assert.equal(h.peekUndo(), null, "the whole drag was one step")
})

test("edits further apart than MERGE_MS are separate steps", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  s = withSetting(s, "sun", { strength: 2 })
  h.observe(s, 1000)
  s = withSetting(s, "sun", { strength: 3 })
  h.observe(s, 1000 + MERGE_MS + 1)
  h.undo()
  assert.ok(h.peekUndo(), "one step left after undoing the second")
})

test("a different control is a different step even when quick", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  s = withSetting(s, "sun", { strength: 2 })
  h.observe(s, 1000)
  s = withSetting(s, "bloom", { intensity: 0.5 })
  h.observe(s, 1100)
  assert.equal(h.peekUndo()?.label, "Bloom")
})

test("a transaction is one step whatever it touched", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  h.begin("AI turn")
  s = withSetting(s, "sun", { strength: 2 })
  h.observe(s, 100)
  s = withSetting(s, "bloom", { intensity: 0.2 })
  h.observe(s, 5000)
  s = { ...s, camera: { ...s.camera, alpha: 1 } }
  h.observe(s, 9000)
  const step = h.end()
  assert.ok(step)
  assert.equal(step.label, "AI turn")
  assert.deepEqual(step.parts.sort(), ["camera", "settings.bloom", "settings.sun"])
  const restored = h.undo()
  assert.deepEqual(restored, base())
})

test("a transaction step never absorbs the edit after it", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  h.begin("AI turn")
  s = withSetting(s, "sun", { strength: 2 })
  h.observe(s, 100)
  h.end()
  s = withSetting(s, "sun", { strength: 3 })
  h.observe(s, 150)
  assert.equal(h.peekUndo()?.label, "Sun", "the hand edit is its own step")
  h.undo()
  assert.equal(h.peekUndo()?.label, "AI turn")
})

test("undo then redo returns to the edited state", () => {
  const h = new SceneHistory()
  const a = base()
  h.observe(a, 0)
  const b = withSetting(a, "sun", { strength: 2 })
  h.observe(b, 1000)
  assert.equal(h.undo(), a)
  assert.equal(h.redo(), b)
})

test("a new edit after undo clears redo", () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  s = withSetting(s, "sun", { strength: 2 })
  h.observe(s, 1000)
  const back = h.undo()!
  h.observe(withSetting(back, "bloom", { intensity: 0 }), 3000)
  assert.equal(h.peekRedo(), null)
})

test("restoring the step's own state records nothing", () => {
  const h = new SceneHistory()
  const a = base()
  h.observe(a, 0)
  h.observe(withSetting(a, "sun", { strength: 2 }), 1000)
  const back = h.undo()!
  assert.equal(h.observe(back, 2000), null)
  assert.ok(h.peekRedo(), "redo survives the restore landing")
})

test("rebase moves the baseline without a step", () => {
  const h = new SceneHistory()
  const a = base()
  h.observe(a, 0)
  const b = withSetting(a, "sun", { strength: 9 })
  h.rebase(b)
  assert.equal(h.peekUndo(), null)
  assert.equal(h.observe(b, 1000), null)
})

test("values rebuilt with equal contents are not changes", () => {
  const a = base()
  const b = { ...a, settings: { ...a.settings }, camera: { ...a.camera, target: [0, 10, 0] } } as SceneSnapshot
  assert.deepEqual(changedParts(a, b), [])
})

test("groups and hidden are labelled by model", () => {
  const h = new SceneHistory((id) => (id === "m1" ? "Kaguya" : id))
  const a = base()
  h.observe(a, 0)
  const step = h.observe({ ...a, groups: { m1: [{ name: "Skin" }] } } as unknown as SceneSnapshot, 1000)
  assert.equal(step?.label, "Kaguya materials")
})

test(`history keeps at most ${MAX_STEPS} steps`, () => {
  const h = new SceneHistory()
  let s = base()
  h.observe(s, 0)
  for (let i = 1; i <= MAX_STEPS + 20; i++) {
    s = withSetting(s, "sun", { strength: i })
    h.observe(s, i * 10_000)
  }
  let n = 0
  while (h.undo()) n++
  assert.equal(n, MAX_STEPS)
})

if (failures) {
  console.log(`\n${failures} failing`)
  process.exit(1)
}
