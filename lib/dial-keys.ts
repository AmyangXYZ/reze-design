// Editing a dial's keys as a set: what the curve view and the Properties panel
// both do to a selection — move it, remove it, copy, cut and paste it, clear
// the track. Pure, so the timeline test can pin it. A selection is a list of
// indices into the sorted keys; every edit hands back the keys and where the
// selection landed, since moving keys reorders them.

import type { EffectParamValue } from "reze-engine"
import type { DialKey } from "@/lib/effects"

export type KeyEdit = { keys: DialKey[]; selected: number[] }

/** The keys as the editors show them: a dial with none stands as one key at
 *  frame 0 holding its plain value, so there is always a dot to grab and a
 *  line that is the dial. Any edit through it writes that key for real. */
export function shownKeys(keys: readonly DialKey[] | undefined, plain: EffectParamValue): DialKey[] {
  return keys?.length ? [...keys] : [{ frame: 0, value: plain }]
}

const byFrame = (a: DialKey, b: DialKey) => a.frame - b.frame

/** The keys with `moved` laid in: any other key on a frame a moved one lands
 *  on gives way. The selection follows the moved keys. */
function landing(rest: DialKey[], moved: DialKey[]): KeyEdit {
  const taken = new Set(moved.map((k) => k.frame))
  const keys = [...rest.filter((k) => !taken.has(k.frame)), ...moved].sort(byFrame)
  return { keys, selected: moved.map((k) => keys.indexOf(k)).sort((a, b) => a - b) }
}

/**
 * The selection shifted by `frames`, each value passed through `value`. The
 * set keeps its spacing: it stops at frame 0 and at `last` as one piece.
 */
export function moveKeys(
  keys: readonly DialKey[],
  selected: readonly number[],
  frames: number,
  value: (v: EffectParamValue) => EffectParamValue,
  last: number,
): KeyEdit {
  const pick = new Set(selected.filter((i) => i >= 0 && i < keys.length))
  if (pick.size === 0) return { keys: [...keys], selected: [] }
  const picked = keys.filter((_, i) => pick.has(i))
  const lo = Math.min(...picked.map((k) => k.frame))
  const hi = Math.max(...picked.map((k) => k.frame))
  const df = Math.max(-lo, Math.min(last - hi, frames))
  const moved = picked.map((k) => ({ ...k, frame: k.frame + df, value: value(k.value) }))
  return landing(
    keys.filter((_, i) => !pick.has(i)),
    moved,
  )
}

/** The keys without the selection. */
export function removeKeys(keys: readonly DialKey[], selected: readonly number[]): DialKey[] {
  const pick = new Set(selected)
  return keys.filter((_, i) => !pick.has(i))
}

/** Copied keys, frames counted from the first of them, and the shape of
 *  value they carry so a paste never puts a colour into a number. */
type Copied = { keys: DialKey[]; vector: boolean }
let clipboard: Copied | null = null
const isVector = (v: EffectParamValue) => typeof v === "object"

/** The selection onto the dial clipboard. False when nothing is selected. */
export function copyKeys(keys: readonly DialKey[], selected: readonly number[]): boolean {
  const picked = keys.filter((_, i) => selected.includes(i))
  if (picked.length === 0) return false
  const first = picked[0].frame
  clipboard = { keys: picked.map((k) => ({ ...k, frame: k.frame - first })), vector: isVector(picked[0].value) }
  return true
}

/** Whether the clipboard holds keys a dial shaped like `sample` can take. */
export function canPasteKeys(sample: EffectParamValue): boolean {
  return clipboard !== null && clipboard.vector === isVector(sample)
}

/** The clipboard laid down from `frame`, over whatever was there; the pasted
 *  keys come back selected. Null when it holds nothing this dial can take. */
export function pasteKeys(keys: readonly DialKey[], frame: number, sample: EffectParamValue, last: number): KeyEdit | null {
  if (!clipboard || !canPasteKeys(sample)) return null
  const moved = clipboard.keys
    .map((k) => ({ ...k, frame: k.frame + frame }))
    .filter((k) => k.frame <= last)
  if (moved.length === 0) return null
  return landing([...keys], moved)
}
