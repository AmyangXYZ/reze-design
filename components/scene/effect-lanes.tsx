"use client"

// Effect clips on the timeline's own axis: the Effects tab's band.
//
// A row is one applied effect, and a block on it is one window where that
// effect plays, its own clock reading zero at the block's left edge. The
// document already stores exactly this (`AppliedEffect.window`, in frames) and
// the engine evaluates it every frame, so this surface edits data and nothing
// else.
//
// An effect with no window plays for the whole scene and shows as one block
// from the first frame; its first edit makes that window explicit. Blocks on a
// row never overlap, because the engine plays only the later of two
// overlapping windows. Deleting the last block on a row removes the effect.
//
// While the tab shows, the band owns the timeline's keys: Delete, ⌘C, ⌘X, ⌘V,
// S (split at the playhead), Escape and ⌘Z act on blocks wherever in the band focus is, so a click on bare
// track to place the playhead is followed by a paste there.

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useUndoScope } from "@/hooks/use-undo-scope"
import { usePlayheadFrameRef } from "@/context/clip-editor"
import { useT } from "@/lib/i18n"
import type { EffectWindow } from "@/lib/effect-schedule"
import { FPS } from "@/lib/clip"
import type { FadeCurve } from "@/lib/timeline"
import { cn } from "@/lib/utils"

/** One row, the Effects list's `h-6`, so the list and the lanes scroll as one. */
export const LANE_H = 24
/** Room between the time ruler and the first lane. */
export const LANE_TOP = 4
/** How close to an end grabs the end rather than the block, in pixels. Wide
 *  enough to land on without aiming, and above the ramp knobs: an end is the
 *  commoner grab, so where the two meet the end wins. */
const EDGE = 10
/** A ramp knob's hit box, in pixels. */
const KNOB = 10
/** Snapping reach in pixels, so it pulls the same at every zoom. Generous
 *  enough that butting one clip against the next is the easy outcome rather
 *  than a thing you fight the pointer for. */
const SNAP_PX = 10
/** How far in from the left edge a revealed lane's first clip lands, in pixels. */
const REVEAL_PAD = 40
/** Travel before a press becomes a drag, so a click selects without an edit. */
const DRAG_PX = 3
const HISTORY_LIMIT = 64
const UNDO_SCOPE = "effect-lanes"

/**
 * A row this band can draw: something named, with windows on it.
 *
 * An applied effect is one. So is a cast member, whose windows are the stretches
 * it is on stage for — the same gesture, the same drawing, the same clipboard,
 * because "when is this thing present" is one question however the scene answers
 * it. The band knows nothing else about either.
 */
/** A window as this band edits it. `curve` is carried but never interpreted
 *  here — the band moves clips, and what a ramp's shape means belongs to
 *  whoever evaluates it. Typed as the evaluator's own union rather than a loose
 *  string, so a row handed back still narrows to what the document holds. */
export type LaneWindow = EffectWindow & { curve?: FadeCurve }

export type LaneRow = {
  id: string
  uid?: string
  name: string
  window?: LaneWindow[]
  /** Nesting in the row list: 1 for a material under its model. */
  depth?: number
  /** A row with rows under it, and whether they are showing. */
  toggle?: "open" | "closed"
}

/** What a lane-bearing tab hands the timeline. */
export type EffectLanesData<T extends LaneRow = LaneRow> = {
  effects: T[]
  onEffects: (next: T[]) => void
  selectedEffect: string | null
  onSelectEffect: (uid: string | null) => void
  /** Show or hide the rows under a row that has them. */
  onToggle?: (uid: string) => void
  /** Open a row's curves — the Effects tab's "Edit curves…". */
  onEditCurves?: (uid: string) => void
  /** Key every field of a row's object at the playhead, as it stands. */
  onKeyAll?: (uid: string) => void
  /** The row list's scroll, which the lanes follow. */
  scrollTop: number
}

/** What the band's right-click menu can do, filled in by EffectLanes. */
export type EffectLanesApi = {
  /** Whether the press that opened the menu was on a block, and whether
   *  anything is copied. */
  menu: () => { clip: boolean; paste: boolean; split: boolean; row: string | null }
  cut: () => void
  /** Cut the picked clips the playhead is inside in two, at the playhead. */
  split: () => void
  copy: () => void
  paste: () => void
  remove: () => void
}

type Span = { start: number; end: number }
/** Ramp lengths in frames, as a block draws them. */
type Fade = { in: number; out: number }
/** A block's body, either end, or the knob of either ramp. */
type Grab = "move" | "in" | "out" | "fadeIn" | "fadeOut"

const keyOf = (uid: string, index: number) => `${uid}#${index}`

/** The blocks a row draws. No window is the whole scene: one block, open at the end. */
// No window at all is one clip spanning the scene; an EMPTY one is a lane with
// no clips — an effect whose last clip was cut, kept so one can go back in.
const blocksOf = (e: LaneRow): LaneWindow[] => (e.window ? e.window : [{ start: 0 }])
/** Where a block stops. An open end runs to the end of the scene. */
const endOf = (w: EffectWindow, frameCount: number) => w.end ?? Math.max(frameCount, w.start + 1)
const spanOf = (w: EffectWindow, frameCount: number): Span => ({ start: w.start, end: endOf(w, frameCount) })
const sortWindows = (lane: EffectWindow[]) => [...lane].sort((a, b) => a.start - b.start)
const fadeOf = (w: EffectWindow): Fade => ({ in: Math.max(0, w.blendIn ?? 0), out: Math.max(0, w.blendOut ?? 0) })

/**
 * The window with these ramps, each held inside the block and the two never
 * overlapping. An out ramp closes an open end where it stands: it needs an end
 * to measure back from. With no ramp left, the shape goes too.
 */
function withFade(w: LaneWindow, fade: Fade, frameCount: number): LaneWindow {
  const length = endOf(w, frameCount) - w.start
  const fin = Math.max(0, Math.min(length, Math.round(fade.in)))
  const fout = Math.max(0, Math.min(length - fin, Math.round(fade.out)))
  const end = fout > 0 && w.end === undefined ? endOf(w, frameCount) : w.end
  return {
    start: w.start,
    ...(end === undefined ? {} : { end }),
    ...(fin ? { blendIn: fin } : {}),
    ...(fout ? { blendOut: fout } : {}),
    ...((fin || fout) && w.curve ? { curve: w.curve } : {}),
  }
}
const uidsOf = (effects: readonly LaneRow[]) => effects.map((e) => e.uid ?? "").join("|")

/**
 * Where a block of `length` asked for at `wanted` lands without covering a
 * neighbour, with its start held in [0, maxStart]. Null when the row has no
 * room.
 *
 * `nearest` is a drag: the closest free spot either way, so the block stays
 * under the pointer. `after` is a paste: the first free spot at or after the
 * playhead, so pasting again at the same playhead lines copies up behind each
 * other.
 */
function fit(others: Span[], wanted: number, length: number, maxStart: number, prefer: "nearest" | "after"): number | null {
  const hi = Math.max(0, maxStart)
  const clamp = (c: number) => Math.min(hi, Math.max(0, Math.round(c)))
  const clashes = (s: number) => others.some((o) => s < o.end && s + length > o.start)
  const want = clamp(wanted)
  if (!clashes(want)) return want
  const landings = [...new Set([0, hi, ...others.flatMap((o) => [o.end, o.start - length])].map(clamp))].filter(
    (c) => !clashes(c),
  )
  if (prefer === "after") {
    const after = landings.filter((c) => c >= want).sort((a, b) => a - b)
    if (after.length) return after[0]
  }
  landings.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))
  return landings.length ? landings[0] : null
}

/** The nearest target within reach, or the frame itself rounded. */
function snap(frame: number, targets: number[], reach: number): { frame: number; d: number } {
  let best = Math.round(frame)
  let bestD = Infinity
  for (const t of targets) {
    const d = Math.abs(t - frame)
    if (d <= reach && d < bestD) {
      bestD = d
      best = t
    }
  }
  return { frame: best, d: bestD }
}

/** Copied blocks, kept outside React so a copy survives the editor closing.
 *  Each remembers its row and where it sat against the earliest one copied. */
type Copied = { uid: string; rel: number; length: number; blendIn?: number; blendOut?: number; curve?: FadeCurve }
let clipboard: Copied[] = []
/** The band's clipboard, shared by every band so a clip copied on one tab
 *  pastes on another. Written through a function, outside any component: it is
 *  module state that a press changes, never something a render reads to draw. */
const setClipboard = (items: Copied[]) => {
  clipboard = items
}

type Step<T extends LaneRow> = { before: T[]; after: T[] }

/**
 * One side of a step, laid over the list as it stands now.
 *
 * Only what the lanes change moves: each row's windows, and rows the step
 * removed or brought. A dial turned in the dock since then stays turned.
 */
function reapply<T extends LaneRow>(current: T[], target: T[], leaving: T[]): T[] {
  const has = (list: T[], uid: string) => list.some((e) => e.uid === uid)
  const next = current.filter((e) => !(e.uid && has(leaving, e.uid) && !has(target, e.uid)))
  target.forEach((t, i) => {
    if (!t.uid) return
    const at = next.findIndex((e) => e.uid === t.uid)
    if (at >= 0) next[at] = { ...next[at], window: t.window }
    else if (!has(leaving, t.uid)) next.splice(Math.min(i, next.length), 0, t)
  })
  return next
}

export function EffectLanes<T extends LaneRow>({
  visible,
  effects,
  onEffects,
  selectedEffect,
  onSelectEffect,
  scrollTop,
  pxPerFrame,
  scrollX,
  frameCount,
  playhead,
  onSeek,
  onScrollX,
  keepEmpty = false,
  ramps = true,
  apiRef,
  top,
  bottom,
  labelWidth,
}: EffectLanesData<T> & {
  /** Whether the Effects tab is showing. Mounted either way, so the history
   *  and the selection outlive a trip to another tab. */
  visible: boolean
  pxPerFrame: number
  scrollX: number
  frameCount: number
  playhead: number
  /** Put the playhead on a frame, as a click on a keyframe does. */
  onSeek: (frame: number) => void
  /** Pan the timeline to a horizontal scroll, in pixels. */
  onScrollX?: (x: number) => void
  /** A row whose last clip goes stays, empty — the Effects tab's lanes, where
   *  an emptied lane is a silent effect waiting for a paste. */
  keepEmpty?: boolean
  /** Whether a clip's ends ramp, with a knob at each top corner — a model's
   *  dissolve. An effect fades on its Strength curve instead. */
  ramps?: boolean
  /** Filled with what the right-click menu offers; see EffectLanesMenu. */
  apiRef?: RefObject<EffectLanesApi | null>
  /** The curve band this draws over, as insets from the canvas box. */
  top: number
  bottom: number
  labelWidth: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const effectsRef = useRef(effects)
  useEffect(() => {
    effectsRef.current = effects
  })
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  /** The row a press on one of its clips is picking: that press chose its
   *  own clip, where a pick from the list takes the whole row. */
  const [pressedRow, setPressedRow] = useState<string | null>(null)
  const onSelectRef = useRef(onSelectEffect)
  useEffect(() => {
    onSelectRef.current = onSelectEffect
  })
  // ONE SELECTION. A row picked in the list selects its clips, so it looks
  // exactly as pressing the lane does; dropping the row drops them. Adjusted as
  // the pick arrives, during render, which is how state that follows a prop is
  // kept in step without a second paint.
  const [seenPick, setSeenPick] = useState(selectedEffect)
  if (selectedEffect !== seenPick) {
    setSeenPick(selectedEffect)
    if (!selectedEffect) {
      if (selected.size) setSelected(new Set())
    } else if (pressedRow !== selectedEffect) {
      const row = effects.find((r) => (r.uid ?? r.id) === selectedEffect)
      if (row) setSelected(new Set(blocksOf(row).map((_, i) => keyOf(selectedEffect, i))))
    }
    if (pressedRow !== null) setPressedRow(null)
  }
  const [preview, setPreview] = useState<{ uid: string; index: number; span: Span; fade?: Fade; knob?: "fadeIn" | "fadeOut" } | null>(null)
  const previewRef = useRef(preview)
  /** Whether the last press in the band was on a block, for what the menu enables. */
  const menuOnClip = useRef(false)
  /** The row of the clip the menu was opened on, for "Edit curves…". */
  const menuRow = useRef<string | null>(null)
  const drag = useRef<{
    grab: Grab
    uid: string
    index: number
    x0: number
    from: Span
    fade: Fade
    others: Span[]
    targets: number[]
    additive: boolean
    started: boolean
    /** The frame under the press, where a click puts the playhead. */
    at: number
  } | null>(null)

  // ── History ─────────────────────────────────────────────────────────────
  // A step belongs to the rows it was taken on: an effect added or removed
  // anywhere else starts it over.
  const past = useRef<Step<T>[]>([])
  const future = useRef<Step<T>[]>([])
  const known = useRef(uidsOf(effects))
  const ids = uidsOf(effects)
  useEffect(() => {
    if (ids === known.current) return
    known.current = ids
    past.current = []
    future.current = []
  }, [ids])
  const apply = useCallback(
    (next: T[]) => {
      known.current = uidsOf(next)
      onEffects(next)
    },
    [onEffects],
  )
  const commit = useCallback(
    (next: T[]) => {
      past.current.push({ before: effectsRef.current, after: next })
      if (past.current.length > HISTORY_LIMIT) past.current.shift()
      future.current = []
      apply(next)
    },
    [apply],
  )
  const undo = useCallback(() => {
    const step = past.current.pop()
    if (!step) return
    future.current.push(step)
    setSelected(new Set())
    apply(reapply(effectsRef.current, step.before, step.after))
  }, [apply])
  const redo = useCallback(() => {
    const step = future.current.pop()
    if (!step) return
    past.current.push(step)
    setSelected(new Set())
    apply(reapply(effectsRef.current, step.after, step.before))
  }, [apply])
  const undoScope = useUndoScope(UNDO_SCOPE, { undo, redo }, { enabled: visible, claim: true })

  // ── Gestures ────────────────────────────────────────────────────────────
  const targetsExcept = (except: string): number[] => {
    // CLIP EDGES FIRST. `snap` keeps the first of equally-near targets, and the
    // scene's landmarks used to be at the head of this list — so a clip edge and
    // the playhead the same distance away resolved to the playhead, and the join
    // you were aiming for lost to a tie. Butting one clip against the next is
    // the gesture this whole band is for; it wins.
    const out: number[] = []
    for (const e of effects) {
      if (!e.uid) continue
      const uid = e.uid
      blocksOf(e).forEach((w, i) => {
        if (keyOf(uid, i) !== except) out.push(w.start, endOf(w, frameCount))
      })
    }
    out.push(0, frameCount, Math.round(playhead))
    return out
  }

  /** The frame under a pointer, on the scene's range. */
  const frameAt = (clientX: number) => {
    const box = containerRef.current?.getBoundingClientRect()
    const f = box && pxPerFrame > 0 ? Math.round((clientX - box.left + scrollX) / pxPerFrame) : 0
    return Math.max(0, Math.min(frameCount, f))
  }

  const down = (uid: string, index: number, grab: Grab) => (e: ReactPointerEvent<HTMLElement>) => {
    const key = keyOf(uid, index)
    // A right-click, or a Mac's control-click, which arrives as the left
    // button: it picks the block for the menu, keeping a selection it is
    // already part of.
    if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
      e.stopPropagation()
      menuOnClip.current = true
      menuRow.current = uid
      setSelected((s) => (s.has(key) ? s : new Set([key])))
      if (uid !== selectedEffect) setPressedRow(uid)
      onSelectEffect(uid)
      return
    }
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    containerRef.current?.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    const additive = e.shiftKey
    setSelected((s) => (additive ? new Set(s).add(key) : s.has(key) && s.size === 1 ? s : new Set([key])))
    if (uid !== selectedEffect) setPressedRow(uid)
    onSelectEffect(uid)
    const effect = effects.find((x) => x.uid === uid)
    if (!effect) return
    const blocks = blocksOf(effect)
    drag.current = {
      grab,
      uid,
      index,
      x0: e.clientX,
      from: spanOf(blocks[index], frameCount),
      fade: fadeOf(blocks[index]),
      others: blocks.filter((_, j) => j !== index).map((w) => spanOf(w, frameCount)),
      targets: targetsExcept(key),
      additive,
      at: frameAt(e.clientX),
      started: false,
    }
  }

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || pxPerFrame <= 0) return
    const px = e.clientX - d.x0
    if (!d.started) {
      if (Math.abs(px) < DRAG_PX) return
      d.started = true
    }
    const df = px / pxPerFrame
    const reach = SNAP_PX / pxPerFrame
    const { from, others, targets } = d
    if (d.grab === "fadeIn" || d.grab === "fadeOut") {
      // A knob sets its own ramp's length, up to whatever the other leaves.
      const length = from.end - from.start
      const fade =
        d.grab === "fadeIn"
          ? { in: Math.max(0, Math.min(length - d.fade.out, Math.round(d.fade.in + df))), out: d.fade.out }
          : { in: d.fade.in, out: Math.max(0, Math.min(length - d.fade.in, Math.round(d.fade.out - df))) }
      previewRef.current = { uid: d.uid, index: d.index, span: from, fade, knob: d.grab }
      setPreview(previewRef.current)
      return
    }
    let span: Span
    if (d.grab === "move") {
      // Either edge may be the one that lands on something; the nearer wins.
      const length = from.end - from.start
      const byStart = snap(from.start + df, targets, reach)
      const byEnd = snap(from.end + df, targets, reach)
      const wanted = byEnd.d < byStart.d ? byEnd.frame - length : byStart.frame
      // The preview shows where it will LAND, gap-fitted, so release never jumps.
      const landed = fit(others, wanted, length, frameCount - length, "nearest")
      span = landed === null ? from : { start: landed, end: landed + length }
    } else if (d.grab === "in") {
      const floor = Math.max(0, ...others.filter((o) => o.end <= from.start).map((o) => o.end))
      const start = Math.max(floor, Math.min(from.end - 1, snap(from.start + df, targets, reach).frame))
      span = { start, end: from.end }
    } else {
      const ceiling = Math.min(Math.max(frameCount, from.end), ...others.filter((o) => o.start >= from.end).map((o) => o.start))
      const end = Math.min(ceiling, Math.max(from.start + 1, snap(from.end + df, targets, reach).frame))
      span = { start: from.start, end }
    }
    previewRef.current = { uid: d.uid, index: d.index, span }
    setPreview(previewRef.current)
  }

  const up = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    const p = previewRef.current
    drag.current = null
    previewRef.current = null
    setPreview(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    // A click, not a drag: the playhead goes where you pressed, so a split
    // (S) cuts there and a paste lands right behind the block.
    if (!d.started) {
      if (d.grab === "move" && !d.additive) onSeek(d.at)
      return
    }
    if (!p) return
    const fading = d.grab === "fadeIn" || d.grab === "fadeOut"
    if (fading ? !p.fade || (p.fade.in === d.fade.in && p.fade.out === d.fade.out) : p.span.start === d.from.start && p.span.end === d.from.end)
      return
    const effect = effectsRef.current.find((x) => x.uid === d.uid)
    if (!effect) return
    const blocks = blocksOf(effect)
    const old = blocks[d.index]
    // An open end stays open when only the start moved: it still runs to the
    // end of the scene. A trim keeps the ramps, held inside what is left.
    const moved: LaneWindow =
      fading && p.fade
        ? withFade(old, p.fade, frameCount)
        : withFade(
            d.grab === "in" && old.end === undefined ? { ...old, start: p.span.start } : { ...old, start: p.span.start, end: p.span.end },
            fadeOf(old),
            frameCount,
          )
    const lane = sortWindows(blocks.map((w, j) => (j === d.index ? moved : w)))
    commit(effectsRef.current.map((x) => (x.uid === d.uid ? { ...x, window: lane } : x)))
    setSelected(new Set([keyOf(d.uid, lane.indexOf(moved))]))
  }

  // ── Keys ────────────────────────────────────────────────────────────────
  const picked = () => {
    const out: { uid: string; index: number; w: LaneWindow }[] = []
    for (const effect of effectsRef.current) {
      if (!effect.uid) continue
      const uid = effect.uid
      blocksOf(effect).forEach((w, index) => {
        if (selected.has(keyOf(uid, index))) out.push({ uid, index, w })
      })
    }
    return out
  }

  const copySelected = () => {
    const items = picked()
    if (!items.length) return false
    const base = Math.min(...items.map((b) => b.w.start))
    setClipboard(items.map(({ uid, w }) => ({
      uid,
      rel: w.start - base,
      length: endOf(w, frameCount) - w.start,
      ...(w.blendIn ? { blendIn: w.blendIn } : {}),
      ...(w.blendOut ? { blendOut: w.blendOut } : {}),
      ...(w.curve ? { curve: w.curve } : {}),
    })))
    return true
  }

  const removeSelected = () => {
    const items = picked()
    if (!items.length) return
    const drop = new Map<string, Set<number>>()
    for (const b of items) drop.set(b.uid, (drop.get(b.uid) ?? new Set<number>()).add(b.index))
    const next = effectsRef.current.flatMap((effect) => {
      const gone = effect.uid ? drop.get(effect.uid) : undefined
      if (!gone) return [effect]
      const lane = blocksOf(effect).filter((_, i) => !gone.has(i))
      // The last block goes: an effect keeps its row, empty and silent, for a
      // paste to land in; a model's row goes, which reads as on throughout.
      return lane.length || keepEmpty ? [{ ...effect, window: lane }] : []
    })
    commit(next)
    setSelected(new Set())
    if (selectedEffect && !next.some((x) => x.uid === selectedEffect)) onSelectEffect(null)
  }

  const paste = () => {
    if (!clipboard.length) return
    const base = Math.max(0, Math.round(playhead))
    const lanes = new Map<string, LaneWindow[]>()
    const landed: { uid: string; w: LaneWindow }[] = []
    for (const c of clipboard) {
      const effect = effectsRef.current.find((x) => x.uid === c.uid)
      if (!effect) continue
      const lane = lanes.get(c.uid) ?? [...blocksOf(effect)]
      const at = fit(
        lane.map((w) => spanOf(w, frameCount)),
        base + c.rel,
        c.length,
        frameCount - c.length,
        "after",
      )
      if (at === null) continue
      const w: LaneWindow = {
        start: at,
        end: at + c.length,
        ...(c.blendIn ? { blendIn: c.blendIn } : {}),
        ...(c.blendOut ? { blendOut: c.blendOut } : {}),
        ...(c.curve ? { curve: c.curve } : {}),
      }
      lane.push(w)
      lanes.set(c.uid, lane)
      landed.push({ uid: c.uid, w })
    }
    if (!landed.length) return
    const next = effectsRef.current.map((x) => {
      const lane = x.uid ? lanes.get(x.uid) : undefined
      return lane ? { ...x, window: sortWindows(lane) } : x
    })
    commit(next)
    setSelected(
      new Set(landed.map(({ uid, w }) => keyOf(uid, next.find((x) => x.uid === uid)?.window?.indexOf(w) ?? 0))),
    )
  }

  /**
   * The picked clips the playhead is inside, each cut in two there: the left
   * keeps the start's dissolve, the right the end's, and both keep the shape.
   * The right one is a clip of its own, so an effect's clock starts again at
   * its left edge.
   */
  const splittable = (at: number) => picked().filter(({ w }) => w.start < at && at < endOf(w, frameCount))
  const splitSelected = (frame?: number) => {
    const at = frame ?? Math.round(playhead)
    const items = splittable(at)
    if (!items.length) return
    const byRow = new Map<string, Set<number>>()
    for (const b of items) byRow.set(b.uid, (byRow.get(b.uid) ?? new Set<number>()).add(b.index))
    const halves: { uid: string; w: LaneWindow }[] = []
    const next = effectsRef.current.map((row) => {
      const hit = row.uid ? byRow.get(row.uid) : undefined
      if (!hit || !row.uid) return row
      const uid = row.uid
      const lane = blocksOf(row).flatMap((w, i) => {
        if (!hit.has(i)) return [w]
        const fade = fadeOf(w)
        const shape = w.curve ? { curve: w.curve } : {}
        const left = withFade({ start: w.start, end: at, ...shape }, { in: fade.in, out: 0 }, frameCount)
        const right = withFade(
          { start: at, ...(w.end === undefined ? {} : { end: w.end }), ...shape },
          { in: 0, out: fade.out },
          frameCount,
        )
        halves.push({ uid, w: left }, { uid, w: right })
        return [left, right]
      })
      return { ...row, window: sortWindows(lane) }
    })
    commit(next)
    setSelected(
      new Set(halves.map(({ uid, w }) => keyOf(uid, next.find((x) => x.uid === uid)?.window?.indexOf(w) ?? 0))),
    )
  }

  const onKeys = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      removeSelected()
    } else if (mod && key === "c") {
      e.preventDefault()
      copySelected()
    } else if (mod && key === "x") {
      e.preventDefault()
      if (copySelected()) removeSelected()
    } else if (mod && key === "v") {
      e.preventDefault()
      paste()
    } else if (!mod && !e.altKey && key === "s") {
      e.preventDefault()
      splitSelected()
    } else if (e.key === "Escape" && selected.size > 0) {
      // Only when there is a selection to let go of; otherwise Escape keeps
      // closing surfaces as everywhere else.
      e.stopPropagation()
      setSelected(new Set())
    }
  }
  const keysRef = useRef(onKeys)
  useEffect(() => {
    keysRef.current = onKeys
    if (apiRef)
      apiRef.current = {
        menu: () => ({
          clip: menuOnClip.current,
          paste: clipboard.length > 0,
          split: menuOnClip.current && splittable(Math.round(playhead)).length > 0,
          row: menuOnClip.current ? menuRow.current : null,
        }),
        split: () => splitSelected(),
        cut: () => {
          if (copySelected()) removeSelected()
        },
        copy: () => {
          copySelected()
        },
        paste,
        remove: removeSelected,
      }
  })

  // The band is the canvas's box. While the tab shows, keys pressed anywhere in
  // it are the lanes' (the canvas leaves them alone on this tab), ⌘Z routes
  // here, and a press on bare track lets the blocks go.
  useEffect(() => {
    const area = containerRef.current?.parentElement
    if (!visible || !area) return
    const onKey = (e: KeyboardEvent) => keysRef.current(e)
    const onDown = (e: PointerEvent) => {
      // A block's own handler sets this back when the press is on one.
      menuOnClip.current = false
      menuRow.current = null
      if (containerRef.current?.contains(e.target as Node)) return
      setSelected((s) => (s.size ? new Set() : s))
      // One selection, not two: bare track lets the row go with its clips.
      onSelectRef.current(null)
    }
    area.addEventListener("keydown", onKey)
    area.addEventListener("pointerdown", onDown, true)
    area.dataset.undoScope = UNDO_SCOPE
    return () => {
      area.removeEventListener("keydown", onKey)
      area.removeEventListener("pointerdown", onDown, true)
      delete area.dataset.undoScope
    }
  }, [visible])


  // A row picked in the list is the lane to work on: keys go to the band, and
  // when none of its clips is on screen the timeline pans to its first, a
  // little in from the left edge. A pick made by pressing a clip changes
  // nothing — that clip is already in view.
  const lastPicked = useRef<string | null>(selectedEffect)
  useEffect(() => {
    if (!visible || selectedEffect === lastPicked.current) {
      lastPicked.current = selectedEffect
      return
    }
    lastPicked.current = selectedEffect
    if (!selectedEffect) return
    const row = effectsRef.current.find((r) => (r.uid ?? r.id) === selectedEffect)
    const box = containerRef.current
    if (!row || !box) return
    box.focus({ preventScroll: true })
    const spans = blocksOf(row).map((w) => spanOf(w, frameCount))
    const from = scrollX / pxPerFrame
    const to = (scrollX + box.clientWidth) / pxPerFrame
    if (spans.some((sp) => sp.end > from && sp.start < to)) return
    const first = Math.min(...spans.map((sp) => sp.start))
    onScrollX?.(Math.max(0, first * pxPerFrame - REVEAL_PAD))
  }, [selectedEffect, visible, frameCount, scrollX, pxPerFrame, onScrollX])

  // The line follows the playhead's own ref every frame, as the canvas's does:
  // during playback the frame moves without a render.
  const playheadLine = useRef<SVGLineElement>(null)
  const framesRef = usePlayheadFrameRef()
  useEffect(() => {
    if (!visible) return
    let raf = 0
    const tick = () => {
      const x = String(framesRef.current * pxPerFrame - scrollX)
      const el = playheadLine.current
      if (el && el.getAttribute("x1") !== x) {
        el.setAttribute("x1", x)
        el.setAttribute("x2", x)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible, framesRef, pxPerFrame, scrollX])

  if (!visible) return null

  const rows = [...effects].reverse()
  return (
    // Pointer-transparent itself, so a press between blocks reaches the canvas
    // below and scrubs; focusable, so keys land in the band after a block is
    // pressed.
    <div
      ref={containerRef}
      // The lanes' own undo scope on the element that takes focus: ⌘Z goes to
      // the focused scope first, and untagged this resolved to the clip's.
      {...undoScope}
      tabIndex={-1}
      // Focused to take keys, never to look focused: on paper a focused
      // element is washed in ink, and this one covers the whole band.
      data-focus-quiet=""
      className="pointer-events-none absolute overflow-hidden outline-none"
      style={{ top, bottom, left: labelWidth, right: 0 }}
    >
      <div style={{ transform: `translateY(${-scrollTop}px)`, paddingTop: LANE_TOP }}>
        {rows.map((effect) => {
          const uid = effect.uid ?? effect.id
          return (
            <div
              key={uid}
              // No rules between rows: the clips are what a lane shows, and the
              // picked row shows as its clips, selected.
              className="relative"
              style={{ height: LANE_H }}
            >
              {blocksOf(effect).map((w, i) => {
                const live = preview && preview.uid === uid && preview.index === i ? preview.span : spanOf(w, frameCount)
                const length = Math.max(1, live.end - live.start)
                const fade = preview && preview.uid === uid && preview.index === i && preview.fade ? preview.fade : fadeOf(w)
                const knobbing = preview && preview.uid === uid && preview.index === i ? preview.knob : undefined
                const width = Math.max(3, length * pxPerFrame)
                const isSelected = selected.has(keyOf(uid, i))
                return (
                  <div
                    key={i}
                    onPointerDown={down(uid, i, "move")}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    className={cn(
                      "group pointer-events-auto absolute inset-y-[3px] flex touch-none cursor-grab items-center overflow-hidden rounded-chip border px-1.5",
                      // Grabbing only once it moves: a click is a click.
                      preview?.uid === uid && preview.index === i && "cursor-grabbing",
                      // Selection has to survive a band of neighbours that are
                      // already blue, so it changes what the EDGE is made of
                      // rather than how blue the fill is: white outline, deeper
                      // body. One pixel of it — the fill carries the weight, and
                      // a thicker rule would eat a short clip.
                      isSelected
                        ? "border-white/75 bg-blue-400/60"
                        : "border-blue-400/40 bg-blue-400/15 hover:bg-blue-400/25",
                    )}
                    style={{ left: live.start * pxPerFrame - scrollX, width }}
                  >
                    {fade.in > 0 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent"
                        style={{ width: `${Math.min(100, (fade.in / length) * 100)}%` }}
                      />
                    )}
                    {fade.out > 0 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/50 to-transparent"
                        style={{ width: `${Math.min(100, (fade.out / length) * 100)}%` }}
                      />
                    )}
                    <span
                      className={cn(
                        "pointer-events-none relative min-w-0 truncate text-2xs leading-none text-foreground",
                        knobbing && "invisible",
                      )}
                    >
                      {effect.name}
                    </span>
                    <span
                      onPointerDown={down(uid, i, "in")}
                      className="absolute inset-y-0 left-0 z-30 cursor-ew-resize"
                      style={{ width: EDGE }}
                    />
                    <span
                      onPointerDown={down(uid, i, "out")}
                      className="absolute inset-y-0 right-0 z-30 cursor-ew-resize"
                      style={{ width: EDGE }}
                    />
                    {/* The ramps' knobs, at the top corners: each drags its own
                        end's ramp in from the edge, and back to zero takes it off. */}
                    {ramps &&
                      width >= 2 * (EDGE + KNOB) &&
                      (["fadeIn", "fadeOut"] as const).map((grab) => {
                        const frames = grab === "fadeIn" ? fade.in : fade.out
                        const px = frames * pxPerFrame
                        // Never inside the end's own zone: a ramp of zero sits
                        // just past it, so the end and the knob are two targets.
                        const at = Math.max(EDGE, Math.min(width - KNOB - EDGE, px - KNOB / 2))
                        const side = grab === "fadeIn" ? "left" : "right"
                        // While it drags, its length reads out beside it in
                        // seconds and frames, inward of the knob.
                        const reading = knobbing === grab
                        return (
                          <Fragment key={grab}>
                            <span
                              onPointerDown={down(uid, i, grab)}
                              className={cn(
                                "absolute top-0 z-20 flex cursor-ew-resize items-start justify-center",
                                px > 0 || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                              )}
                              style={{ width: KNOB, height: KNOB, [side]: at }}
                            >
                              <span className="mt-px size-1.5 rounded-full bg-foreground" />
                            </span>
                            {reading && (
                              <span
                                className="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 font-mono text-2xs whitespace-nowrap text-foreground tabular-nums"
                                style={{ [side]: at + KNOB + 2 }}
                              >
                                {(frames / FPS).toFixed(2)}s · {frames}f
                              </span>
                            )}
                          </Fragment>
                        )
                      })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {/* The playhead, again, over the rows: the canvas draws it beneath this
          band, where a picked row's fill covered it. Its line, its dash. */}
      <svg className="pointer-events-none absolute inset-0 z-40 h-full w-full overflow-visible">
        <line
          ref={playheadLine}
          x1={playhead * pxPerFrame - scrollX}
          x2={playhead * pxPerFrame - scrollX}
          y1={0}
          y2="100%"
          stroke="#d83838"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      </svg>
    </div>
  )
}

/**
 * The band's right-click menu, around the canvas's box while the Effects tab
 * shows. Cut, copy and delete act on the block pressed and the selection it is
 * in; paste lands at the playhead, or the first free spot after it.
 */
export function EffectLanesMenu({
  apiRef,
  enabled,
  onEditCurves,
  onKeyAll,
  children,
}: {
  apiRef: RefObject<EffectLanesApi | null>
  enabled: boolean
  /** The way into a row's curves; absent where rows have none. */
  onEditCurves?: (uid: string) => void
  /** Record a row's object as it stands, at the playhead. */
  onKeyAll?: (uid: string) => void
  children: ReactElement
}) {
  const t = useT()
  const [can, setCan] = useState<{ clip: boolean; paste: boolean; split: boolean; row: string | null }>({
    clip: false,
    paste: false,
    split: false,
    row: null,
  })
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setCan(apiRef.current?.menu() ?? { clip: false, paste: false, split: false, row: null })
      }}
    >
      <ContextMenuTrigger asChild disabled={!enabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        {onEditCurves && (
          <>
            <ContextMenuItem disabled={!can.row} onSelect={() => can.row && onEditCurves(can.row)}>
              {t.lab.timeline.editCurves}
            </ContextMenuItem>
            {onKeyAll && (
              <ContextMenuItem disabled={!can.row} onSelect={() => can.row && onKeyAll(can.row)}>
                {t.lab.timeline.keyAll}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem disabled={!can.clip} onSelect={() => apiRef.current?.cut()}>
          {t.lab.timeline.cut}
        </ContextMenuItem>
        <ContextMenuItem disabled={!can.clip} onSelect={() => apiRef.current?.copy()}>
          {t.lab.timeline.copy}
        </ContextMenuItem>
        <ContextMenuItem disabled={!can.paste} onSelect={() => apiRef.current?.paste()}>
          {t.lab.timeline.paste}
        </ContextMenuItem>
        <ContextMenuItem disabled={!can.split} onSelect={() => apiRef.current?.split()}>
          {t.lab.timeline.split}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" disabled={!can.clip} onSelect={() => apiRef.current?.remove()}>
          {t.lab.timeline.delete}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
