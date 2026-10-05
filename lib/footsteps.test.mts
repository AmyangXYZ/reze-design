// Tests for lib/footsteps — which movements of a sole are a landing, when, and
// how hard.
//
//   npx esbuild lib/footsteps.test.mts --bundle --platform=node --format=esm \
//     --tsconfig=tsconfig.json --outfile=/tmp/st.mjs && node /tmp/st.mjs
//
// The detector reads sole heights and nothing else, so every case here is a
// drawn height curve: the shapes that were got wrong on the way to the current
// rules, each of which was once a footstep nobody saw or a silence under a stomp.
// What it cannot cover is the tracing itself — that needs a model and a clip,
// and analysis/footsteps/NOTES.md says how it was checked against real ones.

import { detectFootsteps, footstepSoundOf, footstepVoice, type SoleTrace, type Footstep } from "@/lib/footsteps"
import { audioFrom } from "@/lib/scene-settings"

let failures = 0
const ok = (cond: boolean, what: string, detail?: unknown) => {
  if (!cond) { failures++; console.error(`FAIL ${what}${detail === undefined ? "" : `\n  ${JSON.stringify(detail)}`}`) }
}
const near = (got: number, want: number, tol: number, what: string) =>
  ok(Math.abs(got - want) <= tol, what, { got, want, tol })

const FPS = 60
const UP = 5 // a foot that is simply elsewhere
/** A height curve through [seconds, height] points, straight between them. */
function curve(seconds: number, points: [number, number][]): Float32Array {
  const y = new Float32Array(Math.round(seconds * FPS) + 1)
  for (let i = 0; i < y.length; i++) {
    const t = i / FPS
    let k = 0
    while (k < points.length - 2 && points[k + 1][0] <= t) k++
    const [t0, y0] = points[k]
    const [t1, y1] = points[k + 1]
    y[i] = y0 + (y1 - y0) * Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  }
  return y
}
const flat = (seconds: number, h: number) => curve(seconds, [[0, h], [seconds, h]])
/** Left heel, left toe, right heel, right toe; anything left out is in the air. */
function trace(seconds: number, parts: { lh?: Float32Array; lt?: Float32Array; rh?: Float32Array; rt?: Float32Array }): SoleTrace {
  const air = flat(seconds, UP)
  return { fps: FPS, parts: [parts.lh ?? air, parts.lt ?? air, parts.rh ?? air, parts.rt ?? air] }
}
const times = (s: Footstep[]) => s.map((x) => +x.time.toFixed(3))

// ── A stomp through the floor ─────────────────────────────────────────────
// MMD feet sink: the sole comes down from 2 and ends 0.2 UNDER the floor. One
// landing, where it met the floor — not where it stopped.
{
  const foot = curve(2, [[0, 2], [0.5, 2], [0.7, -0.2], [2, -0.2]])
  const s = detectFootsteps(trace(2, { lh: foot, lt: foot }))
  ok(s.length === 1, "a stomp through the floor is one footstep", times(s))
  // 2 → -0.2 in 0.2s is 11 units/s; it passes 0.04 at 0.5 + 1.96/11.
  near(s[0]?.time ?? -1, 0.5 + 1.96 / 11, 0.004, "…placed where the sole meets the floor, between frames")
  ok((s[0]?.level ?? 0) > 0.7, "…and it is loud", s[0])
  ok(s[0]?.foot === 0, "…from the left foot", s[0])
}

// ── Stops short, then creeps ──────────────────────────────────────────────
// Down fast to 0.2, then a quarter of a second easing onto the floor. The step
// the eye sees is the stop, not the moment the creep finally crosses a line.
{
  const foot = curve(2, [[0, 3], [0.4, 3], [0.6, 0.2], [0.9, 0.02], [2, 0.02]])
  const s = detectFootsteps(trace(2, { lh: foot, lt: foot }))
  ok(s.length === 1, "a foot that stops short and creeps down is one footstep", times(s))
  near(s[0]?.time ?? -1, 0.6, 0.04, "…placed at the stop")
}

// ── Never left the floor ──────────────────────────────────────────────────
{
  const wobble = curve(3, [[0, 0], [0.5, 0.03], [1, -0.02], [1.5, 0.04], [2, 0], [3, 0.02]])
  ok(detectFootsteps(trace(3, { lh: wobble, lt: wobble })).length === 0, "a planted foot that wobbles makes no sound")
  // Sunk in the floor and bobbing there: it rose, but never above the ground.
  const sunk = curve(3, [[0, -0.3], [1, -0.3], [1.2, -0.08], [1.4, -0.3], [3, -0.3]])
  ok(detectFootsteps(trace(3, { lh: sunk, lt: sunk })).length === 0, "a foot bobbing under the floor makes no sound")
}

// ── Heel, then the forefoot ───────────────────────────────────────────────
// One foot landing heel first is one step, however clearly the toe follows.
{
  const heel = curve(2, [[0, 2], [0.5, 2], [0.6, 0], [2, 0]])
  const toe = curve(2, [[0, 2.5], [0.5, 2.5], [0.6, 0.8], [0.7, 0], [2, 0]])
  const s = detectFootsteps(trace(2, { lh: heel, lt: toe }))
  ok(s.length === 1, "heel then toe of one foot is one footstep", times(s))
  near(s[0]?.time ?? -1, 0.6, 0.01, "…at the heel")
}

// ── A tap, and a foot settling ────────────────────────────────────────────
{
  const planted = flat(3, 0)
  // The toe lifts half a unit and slaps down in 50ms while the heel stays put.
  const tap = curve(3, [[0, 0], [1, 0], [1.3, 0.5], [1.35, 0], [3, 0]])
  const s = detectFootsteps(trace(3, { lh: planted, lt: tap }))
  ok(s.length === 1, "a toe tap with the heel planted is a footstep", times(s))
  // The same toe coming down over half a second is a foot settling.
  const settle = curve(3, [[0, 0], [1, 0], [1.3, 0.5], [1.8, 0], [3, 0]])
  ok(detectFootsteps(trace(3, { lh: planted, lt: settle })).length === 0, "a heel or toe lowered slowly is not")
  // And the tap is quieter than the whole foot arriving at that speed.
  const whole = detectFootsteps(trace(3, { lh: tap, lt: tap }))
  ok((s[0]?.level ?? 1) < (whole[0]?.level ?? 0), "a tap is quieter than the whole foot at the same speed", [s, whole])
}

// ── A low swing is not a step ─────────────────────────────────────────────
{
  const swing = curve(2, [[0, 2], [0.5, 2], [0.8, 0.2], [1.1, 2], [2, 2]])
  ok(detectFootsteps(trace(2, { lh: swing, lt: swing })).length === 0, "a foot that swings low and goes on is not a landing")
  // The same low point, held: that foot is standing on something.
  const held = curve(2, [[0, 2], [0.5, 2], [0.8, 0.2], [2, 0.2]])
  ok(detectFootsteps(trace(2, { lh: held, lt: held })).length === 1, "…but one that stops there is")
  // Too high to be the floor at all, held or not.
  const high = curve(2, [[0, 2], [0.5, 2], [0.8, 0.6], [2, 0.6]])
  ok(detectFootsteps(trace(2, { lh: high, lt: high })).length === 0, "a foot held well above the floor is not")
}

// ── Both feet ─────────────────────────────────────────────────────────────
{
  const jump = curve(2, [[0, 1.5], [0.5, 1.5], [0.6, 0], [2, 0]])
  const s = detectFootsteps(trace(2, { lh: jump, lt: jump, rh: jump, rt: jump }))
  ok(s.length === 1 && s[0].foot === 2, "both feet landing together is one footstep, from both", s)
  // A step apart, they are two.
  const later = curve(2, [[0, 1.5], [0.9, 1.5], [1, 0], [2, 0]])
  const two = detectFootsteps(trace(2, { lh: jump, lt: jump, rh: later, rt: later }))
  ok(two.length === 2 && two[0].foot === 0 && two[1].foot === 1, "feet landing apart are two, in order", two)
}

// ── How hard ──────────────────────────────────────────────────────────────
{
  const land = (fall: number) => {
    const foot = curve(3, [[0, 1], [1, 1], [1 + fall, 0], [3, 0]])
    return detectFootsteps(trace(3, { lh: foot, lt: foot }))[0]?.level ?? -1
  }
  const fast = land(0.06)
  const medium = land(0.2)
  const slow = land(0.6)
  ok(fast > medium && medium > slow, "the faster it arrives the harder the footstep", { fast, medium, slow })
  // A clearly visible step is heard however gently it was eased down.
  ok(slow > 0.2, "a visible step is never silent", slow)
  // A hop of two centimetres at that same speed is not a stomp.
  const hop = curve(3, [[0, 0], [1, 0], [1.1, 0.2], [1.112, 0], [3, 0]])
  const small = detectFootsteps(trace(3, { lh: hop, lt: hop }))[0]?.level ?? 0
  ok(small < 0.5 * fast, "a barely lifted foot is quiet even when quick", { small, fast })
}

// ── Part of a trace ───────────────────────────────────────────────────────
// The streaming analysis detects each traced run on its own: times must come
// back in clip time, not counted from the start of the run.
{
  const foot = curve(4, [[0, 2], [2.5, 2], [2.6, 0], [4, 0]])
  const whole = detectFootsteps(trace(4, { lh: foot, lt: foot }))
  const part = detectFootsteps(trace(4, { lh: foot, lt: foot }), 2 * FPS, 4 * FPS)
  ok(part.length === 1, "a footstep inside a partial range is found", times(part))
  near(part[0]?.time ?? -1, whole[0]?.time ?? -2, 1e-6, "…at the same clip time as in the whole trace")
  // A run that begins with the foot already down has no descent to read.
  ok(detectFootsteps(trace(4, { lh: foot, lt: foot }), 3 * FPS, 4 * FPS).length === 0, "a run starting on a planted foot invents nothing")
}

// ── Playing one ───────────────────────────────────────────────────────────
{
  const at = (level: number, time = 1): Footstep => ({ time, foot: 0, level })
  const sprite = 3.6 // eight 0.45s takes
  ok(footstepVoice(at(1), sprite).gain > footstepVoice(at(0.5), sprite).gain, "a harder footstep is louder")
  near(footstepVoice(at(1), sprite).gain, 1, 1e-9, "the hardest plays at full level")
  ok(footstepVoice(at(0.1), sprite).gain < 0.15, "a soft one is far under it", footstepVoice(at(0.1), sprite).gain)
  for (const level of [0, 0.3, 0.7, 1]) {
    for (const time of [0, 0.5011, 1.0002, 7.3333]) {
      const v = footstepVoice(at(level, time), sprite)
      ok(v.offset >= 0 && v.offset + v.length <= sprite + 1e-9, "the take is inside the sprite", { level, time, v })
    }
  }
  ok(footstepVoice(at(1), sprite).offset > footstepVoice(at(0), sprite).offset, "a hard footstep uses a harder take")
  ok(footstepVoice({ time: 1, foot: 0, level: 1 }, sprite).pan < 0, "the left foot sits left")
  ok(footstepVoice({ time: 1, foot: 2, level: 1 }, sprite).pan === 0, "both feet sit in the middle")
  // An uploaded step is one sound, played whole, whatever its length.
  for (const level of [0, 0.5, 1]) {
    const v = footstepVoice(at(level), 1.3, false)
    ok(v.offset === 0 && v.length === 1.3, "an uploaded step plays from its start to its end", v)
  }
  ok(footstepVoice(at(1), 1.3, false).gain > footstepVoice(at(0.2), 1.3, false).gain, "…louder the harder it lands")
}

// ── What a document says ──────────────────────────────────────────────────
{
  // Shipped for a day as stamps/stampsVolume: those scenes keep their footsteps.
  const old = audioFrom({ volume: 0.8, stamps: true, stampsVolume: 0.4 })
  ok(old.footsteps === true && old.footstepsVolume === 0.4 && old.volume === 0.8, "a scene saved as stamps reads back on, at its level", old)
  ok(!("stamps" in old) && !("stampsVolume" in old), "…under today's names only", old)
  const now = audioFrom({ volume: 1, footsteps: false, footstepsSound: "boots" })
  ok(now.footsteps === false && now.footstepsSound === "boots", "today's names pass through", now)
  ok(footstepSoundOf(undefined) === "heel", "no sound named is the default, heels")
  ok(footstepSoundOf("tile") === "heel", "a sound that no longer exists is the default")
  ok(footstepSoundOf("boots") === "boots" && footstepSoundOf("custom") === "custom", "the others are what they say")
}

if (failures) {
  console.error(`${failures} failure(s)`)
  process.exit(1)
}
console.log("footsteps: ok")
