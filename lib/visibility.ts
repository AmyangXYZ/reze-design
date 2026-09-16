// When a model is on stage.
//
// A scene's cast can outnumber the figures visible at any one moment: a costume
// is a second model of the same character, a double appears for one shot, a
// crowd arrives on the chorus. The document records that as the stretches each
// model is present for, and this module is the whole of what they mean.
//
// A STRETCH, not a pair of switches, because that is what it is on the timeline:
// a clip you drag and trim on the model's own lane, the same gesture as an
// effect clip on its row. The shape is deliberately `EffectWindow`'s — start,
// end, and a ramp at each edge — so the lane that draws one draws the other.
//
// The ramp is the transition. `blendIn` frames after the start she is
// assembling and `blendOut` frames before the end she is coming apart, done by
// the engine's per-model dissolve: a threshold burn on bind-pose position with a
// glowing front, honoured by the colour pass, the depth prepass, the shadow map
// and the outline alike. Zero at either edge is a hard cut, which is the
// default and the honest one.
//
// Pure, and deliberately so. The preview's rAF tick and the export's frame loop
// both answer "who is on stage at frame f" through `visibilityAt`, so a
// rendered file cannot disagree with the playback it was rendered from — the
// single commonest way a timeline feature ships broken.

/** One stretch a model is on stage for. FRAMES, at 30fps, like every lane. */
export type VisibilityWindow = {
  /** First frame she is present. */
  start: number
  /** Last frame she is present. Omitted = to the end of the scene. */
  end?: number
  /** Assemble over this many frames from `start`. Omitted or 0 = a hard cut. */
  blendIn?: number
  /** Come apart over this many frames back from `end`. Needs an `end` to
   *  measure from. */
  blendOut?: number
  /** How the ramps move. Absent = `ease`, which is what a clip ramped before
   *  there was a choice already did. */
  curve?: FadeCurve
}

/**
 * A transition's default length, in frames — half a second at 30fps.
 *
 * Taken from the teleports, which are the only tuned examples of this look in
 * the app: they come apart over 0.50–0.60s and arrive over 0.35–0.45s. Half a
 * second reads as deliberate without making the audience wait.
 */
export const FX_FRAMES = 15

/**
 * The shape of a ramp, as a function of how far through it we are.
 *
 * Worth more than it sounds. The engine's dissolve threshold is uniformly
 * distributed — the shader's own measurement over four hundred thousand samples
 * is a flat 5.0% of her per step from the first flake to the last — so this
 * number IS the fraction of her still present. A curve here is one you can see,
 * not one you only feel: at the middle of a linear ramp, half of her has gone.
 *
 *   linear — a steady burn, even the whole way through.
 *   ease   — slow at both ends. She holds together a moment, leaves quickly,
 *            and the last of her lingers. The gentlest of the three, and the
 *            nearest thing to a plain fade that costs nothing.
 *   steps  — quantised, so she goes in visible stages rather than continuously.
 *            Reads as a signal cutting out rather than as burning away.
 *
 * This is the only part of the transition that is OURS. The pattern she comes
 * apart in lives in the shader with no uniform behind it, so it is one look for
 * the whole app; the rate she comes apart at is arithmetic, so it can be
 * anything, per clip, for free.
 */
export type FadeCurve = "linear" | "ease" | "steps"

/** How many stages `steps` goes in. Few enough to count, which is what makes it
 *  read as stages rather than as a coarse fade. */
const FADE_STEPS = 6

/** A ramp position, curved. Clamped first so a caller cannot push it out of
 *  range and get a dissolve above whole or below gone. */
function shaped(t: number, curve: FadeCurve): number {
  const u = Math.max(0, Math.min(1, t))
  if (curve === "linear") return u
  if (curve === "steps") return Math.round(u * FADE_STEPS) / FADE_STEPS
  return u * u * (3 - 2 * u)
}

/** What is true of a model at one frame: whether it is drawn, and how much of
 *  it is still there (1 whole, 0 gone — the engine's own dissolve scale). */
export type VisibilityState = { visible: boolean; dissolve: number }

const ON_STAGE: VisibilityState = { visible: true, dissolve: 1 }
/** Off stage is whole: nothing of her is drawn, so there is nothing to take
 *  apart, and leaving the dial at 1 means the next arrival starts from whole
 *  rather than from wherever the last departure stopped. */
const OFF_STAGE: VisibilityState = { visible: false, dissolve: 1 }

/**
 * The model's state at this frame.
 *
 * NO WINDOWS MEANS ON STAGE THROUGHOUT, which is what makes the field optional:
 * a scene that never schedules anybody behaves exactly as every document written
 * before this existed. It is also what makes deleting the last clip safe — the
 * lane falls back to the default instead of to a model nobody can see again.
 */
export function visibilityAt(windows: readonly VisibilityWindow[] | undefined, frame: number): VisibilityState {
  if (!windows || windows.length === 0) return ON_STAGE
  // A linear walk over a handful of stretches costs less than a binary search
  // would: this runs per model per frame, and the lanes are short by nature — a
  // costume change is one or two clips, not two hundred.
  for (const w of windows) {
    // EXCLUSIVE end, which is what makes a swap seamless.
    //
    // Snapping one clip's start onto the previous one's end is the gesture this
    // lane is built for, and with an inclusive end that shared frame has BOTH
    // models on screen — one frame of the costume and the character standing
    // inside each other, precisely the glitch the feature exists to avoid. It
    // also makes the arithmetic honest: a clip drawn from 100 to 200 is a
    // hundred frames wide and covers a hundred frames.
    //
    // An effect's window reads the other way — `end` is the last frame it is
    // alive — because an effect is a HIT, with no successor to hand over to.
    const end = w.end ?? Infinity
    if (frame < w.start || frame >= end) continue
    const inLen = Math.max(0, Math.round(w.blendIn ?? 0))
    const outLen = Math.max(0, Math.round(w.blendOut ?? 0))
    const curve = w.curve ?? "ease"
    let amount = 1
    if (inLen > 0 && frame < w.start + inLen) amount = Math.min(amount, shaped((frame - w.start) / inLen, curve))
    // An open end never comes apart: there is no moment to measure back from.
    if (outLen > 0 && Number.isFinite(end) && frame > end - outLen)
      amount = Math.min(amount, shaped((end - frame) / outLen, curve))
    return { visible: true, dissolve: Math.max(0, Math.min(1, amount)) }
  }
  return OFF_STAGE
}

/** Whether the model is drawn at this frame. */
export function visibleAt(windows: readonly VisibilityWindow[] | undefined, frame: number): boolean {
  return visibilityAt(windows, frame).visible
}

/** The document's form: ascending, and nothing with no length in it. */
export function normalizeVisibility(windows: readonly VisibilityWindow[]): VisibilityWindow[] {
  return [...windows]
    .filter((w) => w.end === undefined || w.end > w.start)
    .sort((a, b) => a.start - b.start)
}

/** As much of the engine as this needs: who is loaded, and the dissolve dial. */
type VisibilityEngine = {
  getModel(id: string): { visible: boolean; setVisible(on: boolean): void } | null | undefined
  setModelDissolve(id: string, value: number): boolean
}

/**
 * Apply a whole cast's lanes to the engine at one frame.
 *
 * The one crossing between the clips and what is drawn, called from the preview
 * tick and from the export loop. Both writes are cheap and both are guarded
 * against repeating themselves: `setVisible` flips a flag the cull pass reads,
 * and `setModelDissolve` returns early when the value has not moved, so a scene
 * of hard cuts pays a comparison per model per frame and nothing else.
 *
 * Driving the dissolve from HERE rather than from the engine's own scheduler is
 * what makes it addressable: the engine's `#dissolve` effects only ever take
 * apart cast subject 0, while a costume swap needs a named model. The two do
 * not collide — `evaluateDissolves` resets only the models it drove itself.
 */
export function applyVisibility(
  engine: VisibilityEngine,
  lanes: Readonly<Record<string, VisibilityWindow[]>>,
  frame: number,
): void {
  for (const id in lanes) {
    const model = engine.getModel(id)
    if (!model) continue
    const state = visibilityAt(lanes[id], frame)
    if (model.visible !== state.visible) model.setVisible(state.visible)
    engine.setModelDissolve(id, state.dissolve)
  }
}
