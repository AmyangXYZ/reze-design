// Tests for lib/timeline — the reading of a scene's timed parts, and the two
// crossings to the engine.
//
//   npx esbuild lib/timeline.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/tl.mjs && node /tmp/tl.mjs
//
// The visibility ramps and the effect ramps have their own tests where they are
// evaluated. What can go wrong HERE is the plumbing: a model with no lane that
// the frame loop touches anyway, a prop whose track loses its start hold, an
// effect strip written onto the wrong instance when one before it failed to
// install. Each of those is a scene that plays differently from how it was
// composed, with nothing on screen to say why.

import { applyTimelineFrame, laneChanged, pushTimeline, timelineOf, type SceneTimeline } from "@/lib/timeline"

let failures = 0
const eq = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failures++; console.error(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}

// ── Reading the state ─────────────────────────────────────────────────────
const tl = timelineOf({
  models: [
    { id: "miku" },
    { id: "miku-costume", visibility: [{ start: 100, end: 200 }] },
    { id: "sword", visibility: [{ start: 30 }] },
    { id: "empty", visibility: [] },
  ],
  props: [
    {
      id: "sword",
      attach: { model: "miku", bone: "右手首" },
      transform: { position: [0, 1, 0], rotation: [0, 90, 0] },
      parentKeys: [
        { frame: 0, model: null, position: [9, 9, 9], rotation: [0, 0, 0] },
        { frame: 60, model: null, position: [1, 2, 3], rotation: [0, 0, 0], tween: true },
      ],
    },
  ],
  effects: [{}, { influence: 0.5, window: [{ start: 30, end: 60 }], models: ["miku"] }],
})
eq(Object.keys(tl.visibility), ["miku-costume", "sword"], "only scheduled models have lanes — props included")
eq(tl.parents.sword.map((k) => k.frame), [0, 60], "the start hold leads, and a stray frame-0 key is not a second one")
eq(tl.parents.sword[0], { frame: 0, model: "miku", bone: "右手首", position: [0, 1, 0], rotation: [0, 90, 0] },
   "the start hold is the row's attach and transform")
eq(tl.effects, [
  { influence: 1, window: null, models: null },
  { influence: 0.5, window: [{ start: 30, end: 60 }], models: ["miku"] },
], "effects default to fully on, throughout, on everyone")
eq(timelineOf({}), { visibility: {}, effects: [], parents: {} }, "an empty source is an empty timeline")

// ── The declarative push ──────────────────────────────────────────────────
const writes: string[] = []
const engine = {
  setEffectInfluence: (k: number, v: number) => void writes.push(`influence ${k} ${v}`),
  setEffectSchedule: (k: number, w: unknown) => void writes.push(`schedule ${k} ${JSON.stringify(w)}`),
  setEffectSubjects: (k: number, m: unknown) => void writes.push(`subjects ${k} ${JSON.stringify(m)}`),
  setModelParentKeys: (id: string, keys: readonly { time: number; tween?: boolean }[] | null) => {
    writes.push(`parents ${id} ${JSON.stringify(keys?.map((k) => [k.time, k.tween ?? false]))}`)
    return true
  },
}
// Entry 0 failed to install, so entry 1 is engine instance 0.
pushTimeline(engine, tl, [null, 0])
eq(writes, [
  "influence 0 0.5",
  `schedule 0 ${JSON.stringify([{ start: 1, end: 2 }])}`,
  'subjects 0 ["miku"]',
  "parents sword [[0,false],[2,true]]",
], "strips land on the instance the entry became, frames cross as seconds")
writes.length = 0
pushTimeline(engine, timelineOf({ effects: [{}] }))
eq(writes, ["influence 0 1", "schedule 0 null", "subjects 0 null"], "a partial timeline pushes only what it holds")

// ── The frame ─────────────────────────────────────────────────────────────
type Fake = { visible: boolean; setVisible(on: boolean): void }
const fake = (visible = true): Fake => ({ visible, setVisible(on) { this.visible = on } })
const models: Record<string, Fake> = { miku: fake(), "miku-costume": fake(), sword: fake() }
const dissolve: Record<string, number> = {}
const frameEngine = {
  getModel: (id: string) => models[id],
  setModelDissolve: (id: string, v: number) => ((dissolve[id] = v), true),
  setModelPhysicsWhileHidden: () => true,
}
const at = (t: SceneTimeline, f: number) => {
  applyTimelineFrame(frameEngine, t, f)
  return Object.fromEntries(Object.entries(models).map(([id, m]) => [id, m.visible]))
}
eq(at(tl, 0), { miku: true, "miku-costume": false, sword: false }, "frame 0: only the unscheduled model is on")
eq(at(tl, 150), { miku: true, "miku-costume": true, sword: true }, "frame 150: both lanes are on")
eq(at(tl, 200), { miku: true, "miku-costume": false, sword: true }, "a lane's end is exclusive; an open one runs on")
eq("miku" in dissolve, false, "an unscheduled model is never touched")

// Emptying a lane puts the model back on stage: the frame loop stops visiting
// it, so nothing else would.
laneChanged(frameEngine, "miku-costume", [])
eq([models["miku-costume"].visible, dissolve["miku-costume"]], [true, 1], "an emptied lane shows the model, whole")

if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("timeline: ok")
