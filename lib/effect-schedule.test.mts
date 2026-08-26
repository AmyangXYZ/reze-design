// Tests for lib/effect-schedule — the CROSSING, not the ramps.
//
//   npx esbuild lib/effect-schedule.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/es.mjs && node /tmp/es.mjs
//
// The ramp maths live in the engine, where they are evaluated, and are tested
// exhaustively there. What can go wrong HERE is the 30fps boundary: a strip
// stored in frames and handed to a clock in seconds. Getting that wrong moves
// every effect in the scene by a factor of thirty, which is obvious — or by the
// render rate, which is not, and is the bug worth a test.

import { windowToEngine, scheduleAt, windowLength, isScheduled, stripFor } from "@/lib/effect-schedule"
import { FPS } from "@/lib/clip"

let failures = 0
const eq = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { failures++; console.error(`FAIL ${what}\n  got  ${g}\n  want ${w}`) }
}
const close = (got: number, want: number, what: string) => {
  if (Math.abs(got - want) > 1e-9) { failures++; console.error(`FAIL ${what}\n  got ${got} want ${want}`) }
}

// ── Frames to the engine's seconds ────────────────────────────────────────
eq(windowToEngine(undefined), null, "no window converts to the engine's null")
eq(windowToEngine([{ start: 30 }]), [{ start: 1 }], "30 frames is one second")
eq(windowToEngine([{ start: 0, end: 300 }]), [{ start: 0, end: 10 }], "both edges cross")
eq(windowToEngine([{ start: 30, end: 60, blendIn: 15, blendOut: 3 }]),
   [{ start: 1, end: 2, blendIn: 0.5, blendOut: 0.1 }], "blends cross too")

// Omitted stays omitted. An `end: 0` invented by a spread would mean "ends at
// the first frame" — an effect that never plays — where absent means "runs on".
eq("end" in (windowToEngine([{ start: 5 }])?.[0] ?? {}), false, "an open window has no end")
eq("blendIn" in (windowToEngine([{ start: 5 }])?.[0] ?? {}), false, "no blend in")
eq("blendIn" in (windowToEngine([{ start: 5, blendIn: 0 }])?.[0] ?? {}), false, "a zero blend is no blend")

// ── End to end, through the engine's own evaluator ────────────────────────
// Frames in, frames out, and the render rate appears nowhere: this is what
// makes a 60Hz preview and a 30 or 60fps export agree about the beat.
eq(scheduleAt(undefined, 900), { influence: 1, localFrame: 900 }, "unscheduled runs with the scene")
eq(scheduleAt({ window: [{ start: 100, end: 200 }] }, 99), { influence: 0, localFrame: 0 }, "before the strip")
eq(scheduleAt({ window: [{ start: 100, end: 200 }] }, 150), { influence: 1, localFrame: 50 }, "inside, local frames")
eq(scheduleAt({ window: [{ start: 100, end: 200 }] }, 201), { influence: 0, localFrame: 0 }, "after the strip")
close(scheduleAt({ window: [{ start: 0, end: 300, blendIn: 30 }] }, 15).influence, 0.5, "a blend, in frames")
close(scheduleAt({ influence: 0.4 }, 10).influence, 0.4, "a permanent level needs no window")

// A strip four seconds in, at MMD's rate, is frame 120 — the number a person
// reads off the timeline.
eq(scheduleAt({ window: [{ start: FPS * 4 }] }, FPS * 4), { influence: 1, localFrame: 0 }, "its own clock starts at entry")

// ── What the lane draws with ──────────────────────────────────────────────
eq(windowLength({ start: 100, end: 220 }), 120, "a strip's length")
eq(windowLength({ start: 100 }), null, "an open strip has no length to draw")
eq(windowLength({ start: 200, end: 100 }), 0, "an inverted strip draws as empty")
eq(isScheduled(undefined), false, "no schedule")
eq(isScheduled({ influence: 0.5 }), false, "a level alone is not a schedule")
eq(isScheduled({ window: [{ start: 0 }] }), true, "a window is")
eq(isScheduled({ window: [] }), false, "an emptied lane is not")

// ── A lane fires more than once ───────────────────────────────────────────
// The whole reason this is a list. Frames in, frames out, and each strip
// restarts the effect's own clock so a hit plays its opening every time.
const twice = { window: [{ start: 60, end: 90 }, { start: 300, end: 330 }] }
eq(scheduleAt(twice, 60), { influence: 1, localFrame: 0 }, "first firing at its own zero")
eq(scheduleAt(twice, 75), { influence: 1, localFrame: 15 }, "part way through it")
eq(scheduleAt(twice, 200), { influence: 0, localFrame: 0 }, "the gap between is silent")
eq(scheduleAt(twice, 300), { influence: 1, localFrame: 0 }, "SECOND firing starts at zero again")
eq(scheduleAt(twice, 315), { influence: 1, localFrame: 15 }, "and runs on its own clock")

// ── A dropped effect arrives at its own length ────────────────────────────
// What makes adding an effect the same act as placing it. 4.5s at 30fps is
// 135 frames, so a hit dropped at frame 200 lands as 200 -> 335.
eq(stripFor(4.5, 200), { start: 200, end: 335 }, "a hit arrives sized by its #duration")
eq(stripFor(4.5, 0), { start: 0, end: 135 }, "dropped at the top")
// AMBIENT declares nothing and gets no strip: stars are a condition the scene
// is in, not something that happens at a moment.
eq(stripFor(0, 200), null, "an undeclared effect is not placed")
// A rounded playhead, because a scrub sits between frames.
eq(stripFor(1, 99.6), { start: 100, end: 130 }, "the drop point lands on a frame")

console.log(failures === 0 ? "effect-schedule: all pass" : `effect-schedule: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
