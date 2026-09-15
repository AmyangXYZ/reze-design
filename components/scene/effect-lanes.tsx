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
// Escape and ⌘Z act on blocks wherever in the band focus is, so a click on bare
// track to place the playhead is followed by a paste there.

import {
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
import { useT } from "@/lib/i18n"
import type { AppliedEffect } from "@/lib/effects"
import type { EffectWindow } from "@/lib/effect-schedule"
import { cn } from "@/lib/utils"

/** One row, the Effects list's `h-6`, so the list and the lanes scroll as one. */
export const LANE_H = 24
/** How close to an end grabs the end rather than the block, in pixels. */
const EDGE = 6
/** Snapping reach in pixels, so it pulls the same at every zoom. */
const SNAP_PX = 6
/** Travel before a press becomes a drag, so a click selects without an edit. */
const DRAG_PX = 3
const HISTORY_LIMIT = 64
const UNDO_SCOPE = "effect-lanes"

/** What the Effects tab hands the timeline. */
export type EffectLanesData = {
  effects: AppliedEffect[]
  onEffects: (next: AppliedEffect[]) => void
  selectedEffect: string | null
  onSelectEffect: (uid: string | null) => void
  /** The Effects list's scroll, which the lanes follow. */
  scrollTop: number
}

/** What the band's right-click menu can do, filled in by EffectLanes. */
export type EffectLanesApi = {
  /** Whether the press that opened the menu was on a block, and whether
   *  anything is copied. */
  menu: () => { clip: boolean; paste: boolean }
  cut: () => void
  copy: () => void
  paste: () => void
  remove: () => void
}

type Span = { start: number; end: number }
type Grab = "move" | "in" | "out"

const keyOf = (uid: string, index: number) => `${uid}#${index}`

/** The blocks a row draws. No window is the whole scene: one block, open at the end. */
const blocksOf = (e: AppliedEffect): EffectWindow[] => (e.window?.length ? e.window : [{ start: 0 }])
/** Where a block stops. An open end runs to the end of the scene. */
const endOf = (w: EffectWindow, frameCount: number) => w.end ?? Math.max(frameCount, w.start + 1)
const spanOf = (w: EffectWindow, frameCount: number): Span => ({ start: w.start, end: endOf(w, frameCount) })
const sortWindows = (lane: EffectWindow[]) => [...lane].sort((a, b) => a.start - b.start)
const uidsOf = (effects: AppliedEffect[]) => effects.map((e) => e.uid ?? "").join("|")

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
type Copied = { uid: string; rel: number; length: number; blendIn?: number; blendOut?: number }
let clipboard: Copied[] = []

type Step = { before: AppliedEffect[]; after: AppliedEffect[] }

/**
 * One side of a step, laid over the list as it stands now.
 *
 * Only what the lanes change moves: each row's windows, and rows the step
 * removed or brought. A dial turned in the dock since then stays turned.
 */
function reapply(current: AppliedEffect[], target: AppliedEffect[], leaving: AppliedEffect[]): AppliedEffect[] {
  const has = (list: AppliedEffect[], uid: string) => list.some((e) => e.uid === uid)
  const next = current.filter((e) => !(e.uid && has(leaving, e.uid) && !has(target, e.uid)))
  target.forEach((t, i) => {
    if (!t.uid) return
    const at = next.findIndex((e) => e.uid === t.uid)
    if (at >= 0) next[at] = { ...next[at], window: t.window }
    else if (!has(leaving, t.uid)) next.splice(Math.min(i, next.length), 0, t)
  })
  return next
}

export function EffectLanes({
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
  apiRef,
  top,
  bottom,
  labelWidth,
}: EffectLanesData & {
  /** Whether the Effects tab is showing. Mounted either way, so the history
   *  and the selection outlive a trip to another tab. */
  visible: boolean
  pxPerFrame: number
  scrollX: number
  frameCount: number
  playhead: number
  /** Put the playhead on a frame, as a click on a keyframe does. */
  onSeek: (frame: number) => void
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
  const [preview, setPreview] = useState<{ uid: string; index: number; span: Span } | null>(null)
  const previewRef = useRef(preview)
  /** Whether the last press in the band was on a block, for what the menu enables. */
  const menuOnClip = useRef(false)
  const drag = useRef<{
    grab: Grab
    uid: string
    index: number
    x0: number
    from: Span
    others: Span[]
    targets: number[]
    additive: boolean
    started: boolean
  } | null>(null)

  // ── History ─────────────────────────────────────────────────────────────
  // A step belongs to the rows it was taken on: an effect added or removed
  // anywhere else starts it over.
  const past = useRef<Step[]>([])
  const future = useRef<Step[]>([])
  const known = useRef(uidsOf(effects))
  const ids = uidsOf(effects)
  useEffect(() => {
    if (ids === known.current) return
    known.current = ids
    past.current = []
    future.current = []
  }, [ids])
  const apply = useCallback(
    (next: AppliedEffect[]) => {
      known.current = uidsOf(next)
      onEffects(next)
    },
    [onEffects],
  )
  const commit = useCallback(
    (next: AppliedEffect[]) => {
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
  useUndoScope(UNDO_SCOPE, { undo, redo }, { enabled: visible })

  // ── Gestures ────────────────────────────────────────────────────────────
  const targetsExcept = (except: string): number[] => {
    const out = [0, frameCount, Math.round(playhead)]
    for (const e of effects) {
      if (!e.uid) continue
      const uid = e.uid
      blocksOf(e).forEach((w, i) => {
        if (keyOf(uid, i) !== except) out.push(w.start, endOf(w, frameCount))
      })
    }
    return out
  }

  const down = (uid: string, index: number, grab: Grab) => (e: ReactPointerEvent<HTMLElement>) => {
    const key = keyOf(uid, index)
    if (e.button === 2) {
      // A right-click picks the block for the menu, keeping a selection it is
      // already part of.
      e.stopPropagation()
      menuOnClip.current = true
      setSelected((s) => (s.has(key) ? s : new Set([key])))
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
      others: blocks.filter((_, j) => j !== index).map((w) => spanOf(w, frameCount)),
      targets: targetsExcept(key),
      additive,
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
    // A click, not a drag: the playhead goes to where the block starts, so what
    // it shows is what you picked and a paste lands right behind it.
    if (!d.started) {
      if (d.grab === "move" && !d.additive) onSeek(d.from.start)
      return
    }
    if (!p || (p.span.start === d.from.start && p.span.end === d.from.end)) return
    const effect = effectsRef.current.find((x) => x.uid === d.uid)
    if (!effect) return
    const blocks = blocksOf(effect)
    const old = blocks[d.index]
    // An open end stays open when only the start moved: it still runs to the
    // end of the scene.
    const moved: EffectWindow =
      d.grab === "in" && old.end === undefined ? { ...old, start: p.span.start } : { ...old, start: p.span.start, end: p.span.end }
    const lane = sortWindows(blocks.map((w, j) => (j === d.index ? moved : w)))
    commit(effectsRef.current.map((x) => (x.uid === d.uid ? { ...x, window: lane } : x)))
    setSelected(new Set([keyOf(d.uid, lane.indexOf(moved))]))
  }

  // ── Keys ────────────────────────────────────────────────────────────────
  const picked = () => {
    const out: { uid: string; index: number; w: EffectWindow }[] = []
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
    clipboard = items.map(({ uid, w }) => ({
      uid,
      rel: w.start - base,
      length: endOf(w, frameCount) - w.start,
      ...(w.blendIn ? { blendIn: w.blendIn } : {}),
      ...(w.blendOut ? { blendOut: w.blendOut } : {}),
    }))
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
      // The last block goes, and the effect with it.
      return lane.length ? [{ ...effect, window: lane }] : []
    })
    commit(next)
    setSelected(new Set())
    if (selectedEffect && !next.some((x) => x.uid === selectedEffect)) onSelectEffect(null)
  }

  const paste = () => {
    if (!clipboard.length) return
    const base = Math.max(0, Math.round(playhead))
    const lanes = new Map<string, EffectWindow[]>()
    const landed: { uid: string; w: EffectWindow }[] = []
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
      const w: EffectWindow = {
        start: at,
        end: at + c.length,
        ...(c.blendIn ? { blendIn: c.blendIn } : {}),
        ...(c.blendOut ? { blendOut: c.blendOut } : {}),
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
        menu: () => ({ clip: menuOnClip.current, paste: clipboard.length > 0 }),
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
      if (containerRef.current?.contains(e.target as Node)) return
      setSelected((s) => (s.size ? new Set() : s))
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

  if (!visible) return null

  const rows = [...effects].reverse()
  return (
    // Pointer-transparent itself, so a press between blocks reaches the canvas
    // below and scrubs; focusable, so keys land in the band after a block is
    // pressed.
    <div
      ref={containerRef}
      tabIndex={-1}
      className="pointer-events-none absolute overflow-hidden outline-none"
      style={{ top, bottom, left: labelWidth, right: 0 }}
    >
      <div style={{ transform: `translateY(${-scrollTop}px)` }}>
        {rows.map((effect) => {
          const uid = effect.uid ?? effect.id
          return (
            <div
              key={uid}
              className={cn("relative border-b border-line", selectedEffect === effect.uid && "bg-blue-400/[0.04]")}
              style={{ height: LANE_H }}
            >
              {blocksOf(effect).map((w, i) => {
                const live = preview && preview.uid === uid && preview.index === i ? preview.span : spanOf(w, frameCount)
                const length = Math.max(1, live.end - live.start)
                const isSelected = selected.has(keyOf(uid, i))
                return (
                  <div
                    key={i}
                    onPointerDown={down(uid, i, "move")}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    title={`${effect.name} · ${live.start}–${live.end}`}
                    className={cn(
                      "pointer-events-auto absolute inset-y-[3px] flex touch-none cursor-grab items-center overflow-hidden rounded-chip border px-1.5 active:cursor-grabbing",
                      isSelected
                        ? "border-blue-400 bg-blue-400/35"
                        : "border-blue-400/50 bg-blue-400/20 hover:bg-blue-400/30",
                    )}
                    style={{ left: live.start * pxPerFrame - scrollX, width: Math.max(3, length * pxPerFrame) }}
                  >
                    {(w.blendIn ?? 0) > 0 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent"
                        style={{ width: `${Math.min(100, ((w.blendIn ?? 0) / length) * 100)}%` }}
                      />
                    )}
                    {(w.blendOut ?? 0) > 0 && (
                      <span
                        className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/50 to-transparent"
                        style={{ width: `${Math.min(100, ((w.blendOut ?? 0) / length) * 100)}%` }}
                      />
                    )}
                    <span className="pointer-events-none relative min-w-0 truncate text-[10px] leading-none text-foreground">
                      {effect.name}
                    </span>
                    <span
                      onPointerDown={down(uid, i, "in")}
                      className="absolute inset-y-0 left-0 z-10 cursor-ew-resize"
                      style={{ width: EDGE }}
                    />
                    <span
                      onPointerDown={down(uid, i, "out")}
                      className="absolute inset-y-0 right-0 z-10 cursor-ew-resize"
                      style={{ width: EDGE }}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
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
  children,
}: {
  apiRef: RefObject<EffectLanesApi | null>
  enabled: boolean
  children: ReactElement
}) {
  const t = useT()
  const [can, setCan] = useState({ clip: false, paste: false })
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setCan(apiRef.current?.menu() ?? { clip: false, paste: false })
      }}
    >
      <ContextMenuTrigger asChild disabled={!enabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem disabled={!can.clip} onSelect={() => apiRef.current?.cut()}>
          {t.lab.timeline.cut}
        </ContextMenuItem>
        <ContextMenuItem disabled={!can.clip} onSelect={() => apiRef.current?.copy()}>
          {t.lab.timeline.copy}
        </ContextMenuItem>
        <ContextMenuItem disabled={!can.paste} onSelect={() => apiRef.current?.paste()}>
          {t.lab.timeline.paste}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" disabled={!can.clip} onSelect={() => apiRef.current?.remove()}>
          {t.lab.timeline.delete}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
