"use client"

// What one applied effect exposes: the dials it declares, and who it plays to.
//
// WHY THIS EXISTS: retuning a built-in used to mean forking it. Change the fall
// speed of Rain and you had a second Rain in your drafts, named "Rain (edited)",
// pinned by value rather than by id — so the scene stopped tracking the effect it
// came from, and the library filled with near-duplicates of the same shader.
//
// An effect now declares what is adjustable, in its own source:
//
//   #param float FALL 24 0 60
//   #param color TINT #d0e6ff
//   #param vec3 WIND 0.1 0 0.05
//   #param bool RING true — angel ring | 天使环
//   #param enum PATTERN rain|数字雨 dots|点阵 grid|网格
//
// A switch and a list are one number in the shader, like a slider; they get
// their own control because a slider from 0 to 3 that means "rain, dots,
// circuit, grid" is a dial nobody can read. A note written `English | 中文`
// is the dial's label in each language; otherwise the label is its name.
//
// The engine reads those lines to build the uniform the shader samples, and
// hands the declarations back from the install. This renders exactly what came
// back — never a second parse of the same directives, which would be a control
// free to disagree with the shader it is pointed at.
//
// WHICH MODELS sits here rather than beside the influence slider, and it is not a
// declared dial. An effect used to apply to the whole cast unconditionally, which
// is wrong the moment a scene has two dancers and one of them is the one holding
// the ribbon. It is a setting OF THIS COPY, like a dial and unlike the shader, so
// it belongs in the same panel — but no effect declares it, because then all 36
// built-ins would need a line adding and every fork could forget it. The engine
// reports whether an effect reads the cast at all (`readsCast`), and that is what
// decides whether the list is here: rain falls on the scene.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Check, RotateCcw } from "lucide-react"
import type { EffectBoneValue, EffectParamDecl, EffectParamValue, EffectPointValue } from "reze-engine"
import { dialAt, HOLDING_KINDS, type DialKey } from "@/lib/effects"
import { ColorRow, SliderRow } from "@/components/scene/scene-sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** `#param color` writes `#rrggbb`; the engine wants the linear-ish 0..1 triple
 *  it declared. sRGB→linear is the engine's own conversion at install, so the
 *  round trip here is plain byte scaling and nothing else. */
const hexToVec = (hex: string): EffectParamValue => {
  const n = parseInt(hex.slice(1), 16)
  return { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 }
}

const vecToHex = (v: EffectParamValue): string => {
  if (typeof v === "number" || typeof v === "string" || !("x" in v)) return "#000000"
  const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255)
  return `#${((b(v.x) << 16) | (b(v.y) << 8) | b(v.z)).toString(16).padStart(6, "0")}`
}

/** A float with no author-given range still needs a track to drag along. Zero to
 *  twice the default covers a dial someone chose a middle value for, and a
 *  default of zero has no scale to infer, so it gets a unit one. */
const impliedMax = (v: number) => (v === 0 ? 1 : Math.abs(v) * 2)

export function EffectParams({
  decls,
  values,
  onChange,
  onReset,
  cast = [],
  models,
  onModels,
  keys,
  onKeys,
  frameNow,
  boneNames,
  onPreview,
}: {
  decls: EffectParamDecl[]
  /** Only what this scene moved. Anything absent shows the shader's own default,
   *  which is what lets a retuned built-in reach scenes that never touched it. */
  values: Record<string, EffectParamValue> | undefined
  onChange: (name: string, value: EffectParamValue | undefined) => void
  /** Drop every override at once, back to what the shader declared. Dropping
   *  them rather than writing the defaults in is the point: a scene that stores
   *  no value keeps following the effect if its author retunes it. */
  onReset?: () => void
  /** Who the scene could aim this at, in scene order. Empty — or a cast of one,
   *  or an effect that reads no cast — and the list is not rendered: a picker
   *  with one row that cannot be turned off is a row that says nothing. */
  cast?: { id: string; name: string }[]
  /** The models this copy is on, or undefined for all of them. */
  models?: string[]
  /** Undefined means everyone, which is also what unticking the last model
   *  gives back — an effect on nobody is a dark effect with no sign of why. */
  onModels?: (next: string[] | undefined) => void
  /** This copy's keyed dials, by name. A dial with keys shows its value at the
   *  playhead and moving it writes a key there. */
  keys?: Record<string, DialKey[]>
  /** A dial's keys replaced; undefined takes the dial off keys. */
  onKeys?: (name: string, keys: DialKey[] | undefined) => void
  /** The playhead, in frames. Keying needs it; without it no stopwatch shows. */
  frameNow?: () => number
  /** A character's bone names, for a bone dial — null asks for the first. */
  boneNames?: (modelId: string | null) => string[]
  /** A slider's drag, shown on the effect and nowhere else: the value, and the
   *  dial's keys with that value keyed at the playhead when the dial is keyed.
   *  Given, a drag commits through onChange or onKeys once, where it ends. */
  onPreview?: (name: string, value: EffectParamValue, keys: DialKey[] | null) => void
}) {
  const { t, locale } = useI18n()
  const zh = locale === "zh"
  const labelOf = (d: EffectParamDecl) => (zh ? (d.labelZh ?? d.label) : d.label) ?? d.name
  // The playhead, followed while any dial is keyed, so a keyed dial shows the
  // value it has under the playhead as someone scrubs or plays.
  const anyKeyed = keys !== undefined && Object.values(keys).some((k) => k.length > 0)
  const [frame, setFrame] = useState(() => Math.round(frameNow?.() ?? 0))
  useEffect(() => {
    if (!frameNow || !anyKeyed) return
    let raf = 0
    const tick = () => {
      const f = Math.round(frameNow())
      setFrame((p) => (p === f ? p : f))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [frameNow, anyKeyed])
  /** The keys a dial is on, sorted, or null when it is not keyed. */
  const keysOf = (name: string) => (keys?.[name]?.length ? keys[name] : null)
  /** A key at the playhead, written or moved; the playhead read fresh. */
  const putKey = (d: EffectParamDecl, value: EffectParamValue) => {
    const at = Math.round(frameNow?.() ?? frame)
    const old = keysOf(d.name) ?? []
    const rest = old.filter((k) => k.frame !== at)
    const kept = old.find((k) => k.frame === at)
    onKeys?.(d.name, [...rest, { ...(kept ?? {}), frame: at, value }].sort((a, b) => a.frame - b.frame))
  }
  /** A drag's step, shown without being written down. */
  const preview = onPreview
    ? (d: EffectParamDecl, value: EffectParamValue) => {
        const old = keysOf(d.name)
        if (!old) return onPreview(d.name, value, null)
        const at = Math.round(frameNow?.() ?? frame)
        const kept = old.find((k) => k.frame === at)
        onPreview(d.name, value, [...old.filter((k) => k.frame !== at), { ...(kept ?? {}), frame: at, value }].sort((a, b) => a.frame - b.frame))
      }
    : undefined
  /** A dial changed: a key at the playhead when it is keyed, its value when not. */
  const change = (d: EffectParamDecl, value: EffectParamValue) => (keysOf(d.name) ? putKey(d, value) : onChange(d.name, value))
  // Whether this scene has moved anything. Drives the button's disabled state,
  // which is also how the panel says "these are the author's numbers".
  const touched = values !== undefined && Object.keys(values).length > 0
  const rows = useMemo(
    () =>
      // A lag is the engine's, trailing another dial: nothing to set.
      decls.filter((d) => d.kind !== "lag").map((d) => {
        const set = values?.[d.name]
        return { d, set }
      }),
    [decls, values],
  )
  // Aiming needs somebody to aim at and somebody to aim past.
  const aimable = onModels !== undefined && cast.length > 1
  // Absent = everyone, so every row is ticked. The stored list is an ALLOW list:
  // a model added to the scene later joins an unaimed effect and not an aimed one,
  // which is what having aimed it means.
  const on = (id: string) => models === undefined || models.includes(id)
  const toggle = (id: string) => {
    const next = on(id) ? (models ?? cast.map((m) => m.id)).filter((x) => x !== id) : [...(models ?? []), id]
    // Nobody left, or everybody again — both are the default, and the default is
    // stored as nothing at all so a retuned scene does not churn on save.
    onModels?.(next.length === 0 || next.length === cast.length ? undefined : next)
  }
  /** One dial's control, by kind, showing `set` (or the author's default). */
  const dialControl = (d: EffectParamDecl, set: EffectParamValue | undefined): ReactNode => {
    if (d.kind === "bool") {
      const value = typeof set === "number" ? set : typeof d.value === "number" ? d.value : 0
      return (
        <div className="flex items-center gap-1.5">
          <span className="w-[4.75rem] shrink-0 truncate text-2xs">{labelOf(d)}</span>
          <Switch size="sm" className="ml-auto" checked={value >= 0.5} onCheckedChange={(v) => change(d, v ? 1 : 0)} />
        </div>
      )
    }
    if (d.kind === "enum") {
      const options = d.options ?? []
      const value = typeof set === "number" ? set : typeof d.value === "number" ? d.value : 0
      const at = Math.min(options.length - 1, Math.max(0, Math.round(value)))
      return (
        <div className="flex items-center gap-1.5">
          <span className="w-[4.75rem] shrink-0 truncate text-2xs">{labelOf(d)}</span>
          <Select value={String(at)} onValueChange={(v) => change(d, Number(v))}>
            <SelectTrigger size="sm" className="ml-auto min-w-0 flex-1 text-2xs data-[size=sm]:h-5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o, i) => (
                <SelectItem key={o.id} value={String(i)}>
                  {zh ? (o.labelZh ?? o.id) : o.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }
    if (d.kind === "text") {
      const value = typeof set === "string" ? set : typeof d.value === "string" ? d.value : ""
      return (
        <div className="flex items-center gap-1.5">
          <span className="w-[4.75rem] shrink-0 truncate text-2xs">{labelOf(d)}</span>
          <Input
            variant="bare"
            value={value}
            onChange={(e) => change(d, e.target.value)}
            className="ml-auto block h-4 min-w-0 flex-1 rounded-none border-0 border-b border-line bg-transparent p-0 text-right text-2xs leading-4 outline-none focus:border-foreground"
          />
        </div>
      )
    }
    if (d.kind === "color") {
      const fallback = typeof d.value === "string" ? d.value : "#ffffff"
      return (
        <ColorRow
          label={labelOf(d)}
          value={set === undefined ? fallback : vecToHex(set)}
          onChange={(hex) => change(d, hexToVec(hex))}
          dense
          labelClass="w-[4.75rem]"
        />
      )
    }
    if (d.kind === "bone") {
      const v: EffectBoneValue = set && typeof set === "object" && "bone" in set ? set : { bone: typeof d.value === "string" ? d.value : "", model: null }
      const names = boneNames?.(v.model ?? null) ?? []
      const list = names.includes(v.bone) || !v.bone ? names : [v.bone, ...names]
      const FIRST = "\u0000first"
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="w-[4.75rem] shrink-0 truncate text-2xs">{labelOf(d)}</span>
            <Select value={v.model ?? FIRST} onValueChange={(m) => change(d, { ...v, model: m === FIRST ? null : m })}>
              <SelectTrigger size="sm" className="ml-auto min-w-0 flex-1 text-2xs data-[size=sm]:h-5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FIRST}>{t.lab.ctl.firstCharacter}</SelectItem>
                {cast.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-[4.75rem] shrink-0" />
            <Select value={v.bone} onValueChange={(b) => change(d, { ...v, bone: b })}>
              <SelectTrigger size="sm" className="ml-auto min-w-0 flex-1 text-2xs data-[size=sm]:h-5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {list.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )
    }
    if (d.kind === "vec3" || d.kind === "point") {
      const base = Array.isArray(d.value) ? d.value : [0, 0, 0]
      const v: EffectPointValue =
        set !== undefined && typeof set === "object" && "x" in set ? set : { x: base[0], y: base[1], z: base[2] }
      // A point is a place in the world: a range that reaches round a stage.
      const reach = (i: number) => (d.kind === "point" ? Math.max(20, Math.abs(base[i]) * 2) : impliedMax(base[i]))
      const NOBODY = "\u0000nobody"
      return (
        <div className="flex flex-col">
          {/* Three sliders rather than a vector widget: these are wind, an
              offset, a place — quantities you nudge one axis of. */}
          {(["x", "y", "z"] as const).map((axis, i) => (
            <SliderRow
              key={axis}
              label={`${labelOf(d)}.${axis}`}
              value={v[axis]}
              min={-reach(i)}
              max={reach(i)}
              step={reach(i) / 100}
              onChange={(n) => change(d, { ...v, [axis]: n })}
              onPreview={preview && ((n) => preview(d, { ...v, [axis]: n }))}
              fmt={(n) => n.toFixed(2)}
              dense
              labelClass="w-[4.75rem]"
            />
          ))}
          {d.kind === "point" && cast.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="w-[4.75rem] shrink-0 truncate text-2xs">{t.lab.ctl.follow}</span>
              <Select
                value={v.model ?? NOBODY}
                onValueChange={(m) => change(d, { x: v.x, y: v.y, z: v.z, ...(m === NOBODY ? {} : { model: m }) })}
              >
                <SelectTrigger size="sm" className="ml-auto min-w-0 flex-1 text-2xs data-[size=sm]:h-5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>{t.lab.ctl.none}</SelectItem>
                  {cast.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )
    }
    const base = typeof d.value === "number" ? d.value : 0
    const whole = d.kind === "int"
    const min = d.min ?? Math.min(0, base)
    const max = d.max ?? impliedMax(base)
    return (
      <SliderRow
        label={labelOf(d)}
        value={typeof set === "number" ? set : base}
        min={min}
        max={max}
        // A hundred steps across whatever range the author gave, so a dial
        // that runs 0..1 and one that runs 0..60 both drag at the same feel;
        // a whole number steps by one.
        step={whole ? 1 : (max - min) / 100 || 0.01}
        onChange={(n) => change(d, whole ? Math.round(n) : n)}
        onPreview={preview && ((n) => preview(d, whole ? Math.round(n) : n))}
        fmt={(n) => (whole ? String(Math.round(n)) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2))}
        dense
        labelClass="w-[4.75rem]"
      />
    )
  }

  if (rows.length === 0 && !aimable) return null

  return (
    <>
      {aimable && (
        <>
          {/* pl-1.5, the row's own padding: the heading and the names share one
              left edge, so the section reads as a list with a label rather than
              as a label with a list indented under it. */}
          <div className="mb-1 truncate pl-1.5 text-2xs text-muted-foreground">{t.lab.ctl.onModels}</div>
          <div className="flex flex-col">
            {cast.map((m) => (
              <Button
                key={m.id}
                variant="ghost"
                onClick={() => toggle(m.id)}
                // The library picker's row: a tick on the right, the accent on the
                // text, muted when it is off. One way to say "these are the ones"
                // in this chrome.
                className={cn(
                  "h-6 w-full justify-start gap-2 rounded-interior px-1.5 text-xs font-normal hover:bg-white/10",
                  on(m.id) ? "text-blue-400 hover:text-blue-400" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {m.name}
                </span>
                {/* ALWAYS RENDERED, hidden when off. Dropping the mark hands its
                    width back to the name, so ticking a row re-truncated it and
                    every name in the list moved — a list you are clicking down
                    must not shift under the pointer. */}
                <Check className={cn("size-3.5 shrink-0", on(m.id) ? "opacity-100" : "opacity-0")} />
              </Button>
            ))}
          </div>
        </>
      )}
      {/* Between who it is on and what it is set to, when the panel holds both —
          two lists of rows with nothing between them read as one list. */}
      {aimable && rows.length > 0 && <div className="my-2 border-t border-line" />}
      {onReset && rows.length > 0 && (
        // A header line: what the panel is on the left, its one action on the
        // right — the reading order every other header in the chrome uses, and
        // the same side the rows below put their own controls on. Above the
        // dials because the panel is as tall as the effect has knobs, so a
        // footer would land at a different height for every effect, under the
        // pointer that just opened it.
        <div className="mb-1 flex items-center justify-between gap-2 pl-0.5">
          <span className="truncate text-2xs text-muted-foreground">{t.lab.ctl.params}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!touched}
            onClick={onReset}
            className="-mr-1 h-6 gap-1 px-1.5 text-2xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            {t.lab.ctl.resetParams}
          </Button>
        </div>
      )}
      {rows.map(({ d, set: plain }) => {
        const keyed = keysOf(d.name)
        // What the dial shows: its value under the playhead when it is keyed.
        const set = keyed ? (dialAt(keyed, frame, HOLDING_KINDS.has(d.kind)) ?? plain) : plain
        return (
          <div key={d.name} className="mt-1.5 first:mt-0">
            {dialControl(d, set)}
          </div>
        )
      })}
    </>
  )
}

/** A dial's value when it has never been set: the author's default. */
export function defaultOf(d: EffectParamDecl): EffectParamValue {
  if (d.kind === "text") return typeof d.value === "string" ? d.value : ""
  if (d.kind === "color" && typeof d.value === "string") return hexToVec(d.value)
  if (d.kind === "bone") return { bone: typeof d.value === "string" ? d.value : "", model: null }
  if (Array.isArray(d.value)) return { x: d.value[0], y: d.value[1], z: d.value[2] }
  return typeof d.value === "number" ? d.value : 0
}
