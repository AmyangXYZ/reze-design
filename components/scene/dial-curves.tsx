"use client"

// An effect's dials over time, as curves — the camera's curve view, for an
// effect. One tab per dial, one line per tab (three for a vector or a colour,
// in the axis colours), drawn through the very interpolation the engine plays,
// over the timeline's own ruler, playhead and zoom.
//
// It lays over the curve area the way the effect lanes do, rather than being
// threaded through the timeline canvas: that canvas draws bones, morphs and the
// camera from the clip, and an effect's dials are scene state, not a clip.
//
// Editing:
//   click a dot         it alone; shift-click adds or drops it
//   drag a dot          the selection, by frame and by value (that channel)
//   drag empty space    a box that selects the keys inside; shift adds
//   press empty space   the playhead there, and nothing selected
//   double-click        a key there, at the value under the pointer
//   Delete, ⌘C ⌘X ⌘V    the selection off, copied, cut, pasted at the playhead

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useUndoScope } from "@/hooks/use-undo-scope"
import type { EffectParamDecl, EffectParamValue } from "reze-engine"
import { defaultOf } from "@/components/scene/effect-params"
import { AXIS } from "@/lib/animation"
import { dialAt, HOLDING_KINDS, type DialKey } from "@/lib/effects"
import { copyKeys, moveKeys, pasteKeys, removeKeys, shownKeys } from "@/lib/dial-keys"

/** What the editor hands the timeline while an effect's curves are open. */
export type DialCurvesData = {
  /** The effect's name, for the way back to the lanes. */
  name: string
  /** Its dials that can be drawn as a value over time, in tab order. */
  decls: EffectParamDecl[]
  tab: string
  onTab: (name: string) => void
  keys: Record<string, DialKey[]>
  /** The effect's plain dial values, for a dial with no keys. */
  plain: Record<string, EffectParamValue> | undefined
  onKeys: (name: string, keys: DialKey[] | undefined) => void
  /** The selected keys of the open tab, by index. */
  selected: number[]
  onSelect: (indices: number[]) => void
  onClose: () => void
  /** Chinese labels where a list option has them. */
  zh?: boolean
}

type Channel = { color: string; get: (v: EffectParamValue) => number; set: (v: EffectParamValue, n: number) => EffectParamValue }

const scalar: Channel = {
  color: "currentColor",
  get: (v) => (typeof v === "number" ? v : 0),
  set: (_v, n) => n,
}
const component = (axis: "x" | "y" | "z"): Channel => ({
  color: AXIS[axis],
  get: (v) => (typeof v === "object" && "x" in v ? v[axis] : 0),
  set: (v, n) => (typeof v === "object" && "x" in v ? { ...v, [axis]: n } : v),
})

/** The lines a dial draws: one, or three for anything with x, y and z. */
/**
 * A colour as one flat line through the middle, painted in its colour: keys
 * move in time, and the colour itself is picked in Properties. Height was
 * tried twice — luminance, then the picker's value — and read as a value the
 * colour did not obviously have.
 */
const flat: Channel = {
  color: "currentColor",
  get: () => 0.5,
  set: (v) => v,
}
/** A colour value as CSS, for painting the line and the keys in it. */
export function cssOf(v: EffectParamValue): string {
  if (!(typeof v === "object" && "x" in v)) return "currentColor"
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255)
  return `rgb(${c(v.x)},${c(v.y)},${c(v.z)})`
}

/** The lines a dial draws: three for a vector's axes; one for a colour, its
 *  brightness, drawn in the colour itself; one for anything else. */
export function channelsOf(d: EffectParamDecl): Channel[] {
  if (d.kind === "color") return [flat]
  return d.kind === "vec3" || d.kind === "point" ? [component("x"), component("y"), component("z")] : [scalar]
}

/** A dial that can be shown as a value over time — every kind but a bone. */
export const curveable = (d: EffectParamDecl) => d.kind !== "bone"

/** A round step for about `count` ticks across `span`: 1, 2 or 5 a power of ten. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const m = raw / mag
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * mag
}

/** Inner margin, so a key at the top or bottom of the range stays grabbable. */
const PAD = 14
const DOT = 4
const SNAP_PX = 3

export function DialCurves({
  data,
  pxPerFrame,
  scrollX,
  frameCount,
  playhead,
  top,
  bottom,
  labelWidth,
  onSeek,
}: {
  data: DialCurvesData
  pxPerFrame: number
  scrollX: number
  frameCount: number
  /** Where a paste lands. */
  playhead: number
  top: number
  bottom: number
  labelWidth: number
  onSeek: (frame: number) => void
}) {
  const decl = data.decls.find((d) => d.name === data.tab) ?? data.decls[0]
  const plainValue = decl ? (data.plain?.[decl.name] ?? defaultOf(decl)) : 0
  const keys = useMemo(() => (decl ? shownKeys(data.keys[decl.name], plainValue) : []), [data.keys, decl, plainValue])
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Keys being dragged: the keys and selection as they were at the press, the
  // channel grabbed, and the value range frozen so the scale holds still under
  // the pointer. Every tick writes through, so the scene and the dock follow.
  const [drag, setDrag] = useState<{
    base: DialKey[]
    /** The keys as the scene stored them at the press, for undo. */
    stored: DialKey[] | undefined
    sel: number[]
    ch: number
    x0: number
    y0: number
    range: { lo: number; hi: number }
    moved: boolean
  } | null>(null)
  // This editor's own undo: a drag is one step, as is each add, delete, cut
  // and paste. It holds ⌘Z while the curves are open, as the lanes do theirs.
  type Step = { name: string; before: DialKey[] | undefined; after: DialKey[] | undefined }
  const past = useRef<Step[]>([])
  const future = useRef<Step[]>([])
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  })
  const record = useCallback((name: string, before: DialKey[] | undefined, after: DialKey[] | undefined) => {
    past.current.push({ name, before, after })
    if (past.current.length > 100) past.current.shift()
    future.current = []
  }, [])
  const edit = useCallback(
    (name: string, next: DialKey[] | undefined) => {
      record(name, dataRef.current.keys[name], next)
      dataRef.current.onKeys(name, next)
    },
    [record],
  )
  const undo = useCallback(() => {
    const step = past.current.pop()
    if (!step) return
    future.current.push(step)
    dataRef.current.onKeys(step.name, step.before)
    dataRef.current.onSelect([])
  }, [])
  const redo = useCallback(() => {
    const step = future.current.pop()
    if (!step) return
    past.current.push(step)
    dataRef.current.onKeys(step.name, step.after)
    dataRef.current.onSelect([])
  }, [])
  const undoScope = useUndoScope("dial-curves", { undo, redo }, { claim: true })
  // A press on empty space: a click seeks, a drag draws a selecting box.
  const [box, setBox] = useState<{ x0: number; y0: number; x: number; y: number; additive: boolean; moved: boolean } | null>(null)

  const holds = decl ? HOLDING_KINDS.has(decl.kind) : false
  const channels = decl ? channelsOf(decl) : []
  const fallback = decl ? defaultOf(decl) : 0
  const selected = data.selected

  // The value range: the author's, where the dial has one; else the keys' and
  // the default's, padded so the line never sits on the edge.
  const fitted = useMemo(() => {
    if (!decl) return { lo: 0, hi: 1 }
    if (decl.kind === "bool") return { lo: 0, hi: 1 }
    if (decl.kind === "enum") return { lo: 0, hi: Math.max(1, (decl.options?.length ?? 2) - 1) }
    if (decl.kind === "color") return { lo: 0, hi: 1 }
    if ((decl.kind === "float" || decl.kind === "int") && decl.min !== undefined && decl.max !== undefined) return { lo: decl.min, hi: decl.max }
    const vals = [...keys.map((k) => k.value), fallback].flatMap((v) => channels.map((c) => c.get(v)))
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    const span = Math.max(1e-3, hi - lo)
    lo -= span * 0.2 + (hi === lo ? 1 : 0)
    hi += span * 0.2 + (hi === lo ? 1 : 0)
    return { lo, hi }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decl, keys, fallback])
  const range = drag?.range ?? fitted

  const h = size.h
  const toX = (f: number) => f * pxPerFrame - scrollX
  const toY = (v: number) => PAD + (1 - (v - range.lo) / (range.hi - range.lo || 1)) * Math.max(1, h - 2 * PAD)
  const fromY = (y: number) => range.lo + (1 - (y - PAD) / Math.max(1, h - 2 * PAD)) * (range.hi - range.lo)
  const frameAt = (clientX: number) => {
    const r = boxRef.current?.getBoundingClientRect()
    const f = r && pxPerFrame > 0 ? Math.round((clientX - r.left + scrollX) / pxPerFrame) : 0
    return Math.max(0, Math.min(frameCount, f))
  }
  /** A value as the dial can hold it: whole for a count, a switch or a list. */
  const tidy = (n: number) => {
    if (!decl) return n
    if (decl.kind === "int" || decl.kind === "enum" || decl.kind === "bool") return Math.round(Math.min(range.hi, Math.max(range.lo, n)))
    return n
  }

  // The keyboard, while the curves are open: Delete, and copy, cut, paste at
  // the playhead. Typing in a field keeps its keys.
  useEffect(() => {
    if (!decl) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        e.preventDefault()
        const left = removeKeys(keys, selected)
        edit(decl.name, left.length ? left : undefined)
        data.onSelect([])
      } else if (mod && (k === "c" || k === "x") && selected.length) {
        if (window.getSelection()?.toString()) return
        e.preventDefault()
        copyKeys(keys, selected)
        if (k === "x") {
          const left = removeKeys(keys, selected)
          edit(decl.name, left.length ? left : undefined)
          data.onSelect([])
        }
      } else if (mod && k === "a") {
        // The whole track: every key of this dial, to shift together.
        e.preventDefault()
        data.onSelect(keys.map((_, i) => i))
      } else if (selected.length && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // Steady where a hand is not: a frame left or right, a step up or
        // down — a hundredth of the dial's range, or one for a count, a switch
        // or a list — and Shift ten of either. A colour or a vector has no
        // single value to step, so it only moves in time.
        e.preventDefault()
        const many = e.shiftKey ? 10 : 1
        const df = e.key === "ArrowLeft" ? -many : e.key === "ArrowRight" ? many : 0
        const scalar = channels.length === 1 && decl.kind !== "color"
        const whole = decl.kind === "int" || decl.kind === "enum" || decl.kind === "bool"
        const step = (whole ? 1 : (range.hi - range.lo) / 100) * many
        const dv = !scalar ? 0 : e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0
        if (df === 0 && dv === 0) return
        const ch = channels[0]
        const next = moveKeys(keys, selected, df, (v) => (dv === 0 ? v : ch.set(v, tidy(ch.get(v) + dv))), frameCount)
        edit(decl.name, next.keys)
        data.onSelect(next.selected)
      } else if (mod && k === "v") {
        const pasted = pasteKeys(keys, Math.round(playhead), keys[0]?.value ?? defaultOf(decl), frameCount)
        if (!pasted) return
        e.preventDefault()
        edit(decl.name, pasted.keys)
        data.onSelect(pasted.selected)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // channels, range and tidy follow decl and the keys, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decl, keys, selected, data, playhead, frameCount, edit])

  if (!decl) return null

  /** A key at a frame: what the curve already says there, with the line under
   *  the pointer moved to where it was pressed. */
  const addKey = (frame: number, y: number) => {
    const here = dialAt(keys, frame, holds) ?? fallback
    const near = channels.reduce((best, c, i) => (Math.abs(toY(c.get(here)) - y) < Math.abs(toY(channels[best].get(here)) - y) ? i : best), 0)
    const value = channels[near].set(here, tidy(fromY(y)))
    const next = [...keys.filter((k) => k.frame !== frame), { frame, value }].sort((a, b) => a.frame - b.frame)
    edit(decl.name, next)
    data.onSelect([next.findIndex((k) => k.frame === frame)])
  }

  const dotDown = (i: number, ch: number) => (e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    boxRef.current?.focus({ preventScroll: true })
    if (e.shiftKey) {
      data.onSelect(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].sort((a, b) => a - b))
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    // Pressing a key outside the selection takes it alone; inside, the set moves.
    const sel = selected.includes(i) ? selected : [i]
    data.onSelect(sel)
    setDrag({ base: keys, stored: data.keys[decl.name], sel, ch, x0: e.clientX, y0: e.clientY, range, moved: false })
  }
  const dotMove = (e: ReactPointerEvent<SVGElement>) => {
    if (!drag || pxPerFrame <= 0) return
    const dx = e.clientX - drag.x0
    const dy = e.clientY - drag.y0
    if (!drag.moved && Math.hypot(dx, dy) < SNAP_PX) return
    const ch = channels[drag.ch]
    const dv = -dy * ((range.hi - range.lo) / Math.max(1, h - 2 * PAD))
    const next = moveKeys(drag.base, drag.sel, Math.round(dx / pxPerFrame), (v) => ch.set(v, tidy(ch.get(v) + dv)), frameCount)
    data.onKeys(decl.name, next.keys)
    data.onSelect(next.selected)
    if (!drag.moved) setDrag({ ...drag, moved: true })
  }
  const endDrag = () => {
    if (drag?.moved) record(decl.name, drag.stored, dataRef.current.keys[decl.name])
    setDrag(null)
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const emptyDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Taken here, so the canvas below does not scrub under a box.
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = local(e)
    setBox({ x0: p.x, y0: p.y, x: p.x, y: p.y, additive: e.shiftKey, moved: false })
    // The playhead goes there on the press, as on the time axis.
    if (!e.shiftKey) {
      data.onSelect([])
      onSeek(frameAt(e.clientX))
    }
  }
  const emptyMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!box) return
    const p = local(e)
    const moved = box.moved || Math.hypot(p.x - box.x0, p.y - box.y0) >= SNAP_PX
    setBox({ ...box, x: p.x, y: p.y, moved })
  }
  const emptyUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!box) return
    const b = box
    setBox(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!b.moved) return
    const [x0, x1] = [Math.min(b.x0, b.x), Math.max(b.x0, b.x)]
    const [y0, y1] = [Math.min(b.y0, b.y), Math.max(b.y0, b.y)]
    const inside = keys.flatMap((k, i) => {
      const x = toX(k.frame)
      return x >= x0 && x <= x1 && channels.some((c) => {
        const y = toY(c.get(k.value))
        return y >= y0 && y <= y1
      })
        ? [i]
        : []
    })
    data.onSelect(b.additive ? [...new Set([...selected, ...inside])].sort((a, c) => a - c) : inside)
  }

  // The curve, sampled across what is on screen: two pixels a sample, through
  // the same reading the engine plays.
  const w = size.w
  const f0 = Math.max(0, Math.floor(scrollX / Math.max(pxPerFrame, 1e-6)))
  const f1 = Math.min(frameCount, Math.ceil((scrollX + w) / Math.max(pxPerFrame, 1e-6)))
  const step = Math.max(1 / 4, 2 / Math.max(pxPerFrame, 1e-6))
  // A colour's line is painted in the colour it has along the way: short
  // segments, each in the value at its start.
  const tinted =
    decl.kind === "color"
      ? (() => {
          const out: { d: string; color: string }[] = []
          let prev: { x: number; y: number } | null = null
          for (let f = f0; f <= f1 + step; f += step) {
            const at = Math.min(f, f1)
            const v = dialAt(keys, at, holds) ?? fallback
            const pt = { x: toX(at), y: toY(0.5) }
            if (prev) out.push({ d: `M${prev.x.toFixed(1)} ${prev.y.toFixed(1)}L${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`, color: cssOf(v) })
            prev = pt
          }
          return out
        })()
      : null
  // A colour's easing, which the flat line cannot show by height: between each
  // pair of keys, a faint curve rising from one to the next in the segment's
  // own shape, through the same reading the engine plays.
  const easings =
    decl.kind === "color"
      ? keys.slice(1).map((b, i) => {
          const a = keys[i]
          const shape: DialKey[] = [{ frame: a.frame, value: 0 }, { ...b, value: 1 }]
          const mid = toY(0.5)
          // As tall as the room above the line allows, so the shape reads.
          const rise = Math.max(16, Math.min(72, mid - PAD - 12))
          let d = ""
          for (let f = a.frame; f <= b.frame + 1e-6; f += Math.max(step, (b.frame - a.frame) / 64)) {
            const u = dialAt(shape, Math.min(f, b.frame), false)
            const y = mid - 10 - (typeof u === "number" ? u : 0) * rise
            d += `${d ? "L" : "M"}${toX(Math.min(f, b.frame)).toFixed(1)} ${y.toFixed(1)}`
          }
          return d
        })
      : []
  const paths = channels.map((c) => {
    let p = ""
    for (let f = f0; f <= f1 + step; f += step) {
      const v = dialAt(keys, Math.min(f, f1), holds) ?? fallback
      p += `${p ? "L" : "M"}${toX(Math.min(f, f1)).toFixed(1)} ${toY(c.get(v)).toFixed(1)}`
    }
    return p
  })

  // The value axis, as the camera's: rules across, numbers in the gutter on
  // the left, the zero line a step stronger. A switch and a list step by one.
  const whole = decl.kind === "int" || decl.kind === "bool" || decl.kind === "enum"
  const tick = whole ? Math.max(1, Math.round(niceStep(range.hi - range.lo, 4))) : niceStep(range.hi - range.lo, 4)
  const ticks: number[] = []
  // A colour's line is flat: no value axis to read.
  if (decl.kind !== "color")
    for (let v = Math.ceil(range.lo / tick) * tick; v <= range.hi + tick * 1e-6; v += tick) ticks.push(Math.abs(v) < tick * 1e-6 ? 0 : v)
  const tickLabel = (v: number) => {
    if (decl.kind === "enum") {
      const o = decl.options?.[Math.round(v)]
      return o ? (o.labelZh && data.zh ? o.labelZh : o.id) : String(v)
    }
    const digits = tick >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(tick)))
    return v.toFixed(digits)
  }

  return (
    <div
      ref={boxRef}
      // Empty space's crosshair, as on the bone curves: a press moves the
      // playhead there, a drag boxes keys.
      {...undoScope}
      // Focused on a press, so ⌘Z reaches this editor's own history: undo goes
      // to the scope holding focus first, and left on the timeline's canvas it
      // went to the clip's. Focused to take keys, never to look focused.
      tabIndex={-1}
      data-focus-quiet=""
      className="absolute cursor-crosshair touch-none select-none text-foreground outline-none"
      style={{ top, bottom, left: labelWidth, right: 0 }}
      onPointerDown={emptyDown}
      onPointerMove={emptyMove}
      onPointerUp={emptyUp}
      onPointerCancel={() => setBox(null)}
      onDoubleClick={(e) => addKey(frameAt(e.clientX), local(e).y)}
    >
      <svg width={w} height={h} className="block overflow-visible">
        {ticks.map((v) => {
          const y = toY(v)
          return (
            <g key={v}>
              <line x1={-5} x2={w} y1={y} y2={y} stroke="currentColor" strokeWidth={v === 0 ? 1 : 0.5} opacity={v === 0 ? 0.18 : 0.1} />
              <text
                x={-6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="currentColor"
                opacity={0.9}
                className="font-mono"
                style={{ fontSize: 9 }}
              >
                {tickLabel(v)}
              </text>
            </g>
          )
        })}
        <line x1={0.5} x2={0.5} y1={0} y2={h} stroke="currentColor" strokeWidth={1} opacity={0.1} />
        {easings.map((d, i) => (
          <path key={`e${i}`} d={d} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.35} />
        ))}
        {tinted
          ? tinted.map((seg, i) => <path key={i} d={seg.d} fill="none" stroke={seg.color} strokeWidth={3} strokeLinecap="round" />)
          : paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={channels[i].color}
                strokeWidth={channels.length === 1 ? 2 : 1.5}
              />
            ))}
        {keys.map((k, i) =>
          channels.map((c, ch) => {
            const picked = selected.includes(i)
            return (
              decl.kind === "color" ? (
                // A colour key is a swatch of its colour, edged in the ink so
                // a dark one holds on the sheet, in the accent when picked.
                <rect
                  key={`${i}:${ch}`}
                  x={toX(k.frame) - 6}
                  y={toY(0.5) - 8}
                  width={12}
                  height={16}
                  rx={3}
                  fill={cssOf(k.value)}
                  stroke={picked ? "var(--color-blue-400)" : "currentColor"}
                  strokeWidth={picked ? 2 : 1}
                  className={drag ? "cursor-grabbing" : "cursor-grab"}
                  onPointerDown={dotDown(i, ch)}
                  onPointerMove={dotMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={(e) => e.stopPropagation()}
                />
              ) : (
                // The dot as drawn, and round it a wider ring that takes the
                // pointer: a 4px dot is a target you miss. A grab hand over a
                // key, as on the bone curves; a closed one while it moves.
                <g key={`${i}:${ch}`}>
                  <circle
                    cx={toX(k.frame)}
                    cy={toY(c.get(k.value))}
                    r={picked ? DOT + 1 : DOT}
                    fill={c.color}
                    stroke={picked ? "var(--color-blue-400)" : "none"}
                    strokeWidth={2}
                    className="pointer-events-none"
                  />
                  <circle
                    cx={toX(k.frame)}
                    cy={toY(c.get(k.value))}
                    r={9}
                    fill="transparent"
                    className={drag ? "cursor-grabbing" : "cursor-grab"}
                    onPointerDown={dotDown(i, ch)}
                    onPointerMove={dotMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                </g>
              )
            )
          }),
        )}
        {box?.moved && (
          <rect
            x={Math.min(box.x0, box.x)}
            y={Math.min(box.y0, box.y)}
            width={Math.abs(box.x - box.x0)}
            height={Math.abs(box.y - box.y0)}
            // The canvas marquee's own fill and edge.
            fill="rgba(90,160,240,0.08)"
            stroke="rgba(90,160,240,0.55)"
            strokeWidth={1}
          />
        )}
      </svg>
    </div>
  )
}
