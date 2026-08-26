// An effect's strip, as the DOCUMENT holds it.
//
// Frames, at MMD's 30fps — the space lib/clip.ts works in, the space the
// timeline draws, and the space an MMDer counts in. Playback runs at 60Hz and
// export at 30 or 60; none of that reaches these numbers, because the only
// crossing to the scene clock is `framesToSeconds`. That is what makes an
// effect land on the same beat in a preview and in a render.
//
// THE RAMP MATHS ARE NOT HERE. The engine evaluates a strip every frame, where
// the scene clock advances, so that playback, the offline export loop and a
// warm-up pass cannot disagree about when an effect is alive — and none of them
// has to remember to tick it. This file converts, and nothing more; a second
// copy of the ramps would be a second answer waiting to drift from the one that
// renders. Unity, Unreal and Blender all put the evaluation in the engine and
// leave the editor editing data, for the same reason.

import { framesToSeconds, secondsToFrames } from "@/lib/clip"
import { effectState, type EffectWindow as EngineWindow } from "reze-engine"

/** One strip on an effect's LANE — and a lane holds as many as you place, which
 *  is what lets one effect fire more than once. FRAMES, at 30fps. */
export type EffectWindow = {
  /** First frame it is alive, and where its own clock reads zero. */
  start: number
  /** Last frame it is alive. Omitted = to the end of the scene. */
  end?: number
  /** Ramp up over this many frames from `start`. Omitted or 0 = a hard cut,
   *  which is right for a flash and wrong for a glow. */
  blendIn?: number
  /** Ramp down over this many frames back from `end`. Needs an `end` to
   *  measure from. */
  blendOut?: number
}

/** What one applied effect stores about its timing. */
export type EffectSchedule = {
  /** The level it reaches inside the window, 0..1. Blender's `influence`: the
   *  blends ramp toward this rather than toward 1, so a permanently dimmed
   *  effect and a scheduled one are the same dial. */
  influence?: number
  /** Absent or empty = on for the whole scene, which is what an AMBIENT effect
   *  does — one that declared no `#duration`, because it is a condition the
   *  scene is in rather than something that happens at a moment. */
  window?: EffectWindow[]
}

/** The whole lane in the engine's seconds. Null passes through — the engine's
 *  own word for "unscheduled". */
export function windowToEngine(lane: EffectWindow[] | undefined | null): EngineWindow[] | null {
  if (!lane || lane.length === 0) return null
  return lane.map((w) => ({
    start: framesToSeconds(w.start),
    ...(w.end === undefined ? {} : { end: framesToSeconds(w.end) }),
    ...(w.blendIn ? { blendIn: framesToSeconds(w.blendIn) } : {}),
    ...(w.blendOut ? { blendOut: framesToSeconds(w.blendOut) } : {}),
  }))
}

/**
 * What a lane should DRAW at one frame — the same numbers the engine renders
 * from, because it is the engine's own evaluator run on the converted strip.
 *
 * A lane that computed its own preview of the ramp would be the second answer
 * this file exists to avoid.
 */
export function scheduleAt(s: EffectSchedule | undefined, frame: number): { influence: number; localFrame: number } {
  const at = effectState(windowToEngine(s?.window), s?.influence ?? 1, framesToSeconds(frame))
  // ROUNDED BACK ONTO THE GRID. Frames cross to seconds as thirtieths, which
  // are not representable, so a strip from frame 100 read at frame 150 returns
  // 49.99999999999999 — and a lane drawing that is a frame short of where the
  // playhead is. Six decimals is far below a frame and far above the error, so
  // sub-frame positions during 60Hz playback survive it intact.
  return { influence: at.weight, localFrame: Math.round(secondsToFrames(at.time) * 1e6) / 1e6 }
}

/** Frames a strip is alive for, for a lane to size a bar with. Null = open. */
export function windowLength(w: EffectWindow): number | null {
  return w.end === undefined ? null : Math.max(0, w.end - w.start)
}

/** Is this effect placed anywhere, or does it simply play throughout? */
export const isScheduled = (s: EffectSchedule | undefined): boolean => (s?.window?.length ?? 0) > 0

/**
 * A strip for an effect dropped at `frame`, sized by what it declared.
 *
 * This is what makes adding an effect the same act as placing it. An effect
 * that declared a `#duration` is a HIT and arrives at its own length, the way a
 * clip dragged into any timeline arrives at the length of its media. One that
 * declared nothing is AMBIENT and gets no strip at all — it plays throughout,
 * which is the truth about stars and fog, and is exactly what applying an
 * effect has always done.
 */
export function stripFor(durationSeconds: number, frame: number): EffectWindow | null {
  if (!(durationSeconds > 0)) return null
  const start = Math.max(0, Math.round(frame))
  return { start, end: start + Math.max(1, Math.round(secondsToFrames(durationSeconds))) }
}
