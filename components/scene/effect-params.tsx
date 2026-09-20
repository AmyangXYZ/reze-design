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

import { useMemo } from "react"
import { Check, RotateCcw } from "lucide-react"
import type { EffectParamDecl, EffectParamValue } from "reze-engine"
import { ColorRow, SliderRow } from "@/components/scene/scene-sidebar"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** `#param color` writes `#rrggbb`; the engine wants the linear-ish 0..1 triple
 *  it declared. sRGB→linear is the engine's own conversion at install, so the
 *  round trip here is plain byte scaling and nothing else. */
const hexToVec = (hex: string): EffectParamValue => {
  const n = parseInt(hex.slice(1), 16)
  return { x: ((n >> 16) & 255) / 255, y: ((n >> 8) & 255) / 255, z: (n & 255) / 255 }
}

const vecToHex = (v: EffectParamValue): string => {
  if (typeof v === "number") return "#000000"
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
}) {
  const t = useT()
  // Whether this scene has moved anything. Drives the button's disabled state,
  // which is also how the panel says "these are the author's numbers".
  const touched = values !== undefined && Object.keys(values).length > 0
  const rows = useMemo(
    () =>
      decls.map((d) => {
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
  if (rows.length === 0 && !aimable) return null

  return (
    <>
      {aimable && (
        <>
          {/* pl-1.5, the row's own padding: the heading and the names share one
              left edge, so the section reads as a list with a label rather than
              as a label with a list indented under it. */}
          <div className="mb-1 truncate pl-1.5 text-[11px] text-muted-foreground">{t.lab.ctl.onModels}</div>
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
                  "h-6 w-full justify-start gap-2 rounded-interior px-1.5 text-xs font-normal hover:bg-white/5",
                  on(m.id) ? "text-blue-400 hover:text-blue-400" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-left" title={m.name}>
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
          <span className="truncate text-[11px] text-muted-foreground">{t.lab.ctl.params}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!touched}
            onClick={onReset}
            className="-mr-1 h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" />
            {t.lab.ctl.resetParams}
          </Button>
        </div>
      )}
      {rows.map(({ d, set }) => {
        if (d.kind === "color") {
          const fallback = typeof d.value === "string" ? d.value : "#ffffff"
          return (
            <ColorRow
              key={d.name}
              label={d.name}
              value={set === undefined ? fallback : vecToHex(set)}
              onChange={(hex) => onChange(d.name, hexToVec(hex))}
              dense
              labelClass="w-[4.75rem]"
            />
          )
        }

        if (d.kind === "vec3") {
          const base = Array.isArray(d.value) ? d.value : [0, 0, 0]
          const v = set === undefined || typeof set === "number" ? { x: base[0], y: base[1], z: base[2] } : set
          // Three sliders rather than a vector widget: these are wind, an offset,
          // a scale per axis — quantities you nudge one axis of, not a direction
          // you aim. A gizmo for something with no position in the scene would be
          // a control for a thing that is not there.
          return (["x", "y", "z"] as const).map((axis, i) => (
            <SliderRow
              key={`${d.name}.${axis}`}
              label={`${d.name}.${axis}`}
              value={v[axis]}
              min={-impliedMax(base[i])}
              max={impliedMax(base[i])}
              step={impliedMax(base[i]) / 100}
              onChange={(n) => onChange(d.name, { ...v, [axis]: n })}
              fmt={(n) => n.toFixed(2)}
              dense
              labelClass="w-[4.75rem]"
            />
          ))
        }

        const base = typeof d.value === "number" ? d.value : 0
        const min = d.min ?? Math.min(0, base)
        const max = d.max ?? impliedMax(base)
        return (
          <SliderRow
            key={d.name}
            label={d.name}
            value={typeof set === "number" ? set : base}
            min={min}
            max={max}
            // A hundred steps across whatever range the author gave, so a dial
            // that runs 0..1 and one that runs 0..60 both drag at the same feel.
            step={(max - min) / 100 || 0.01}
            onChange={(n) => onChange(d.name, n)}
            fmt={(n) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2))}
            dense
            labelClass="w-[4.75rem]"
          />
        )
      })}
    </>
  )
}
