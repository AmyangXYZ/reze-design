"use client"

// THE color control for the app: a chip (click → picker dialog) + read-only hex label.

import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Pipette } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  loadColorPickerTab,
  loadRecentColors,
  pushRecentColor,
  RECENT_COLORS,
  saveColorPickerTab,
  type ColorPickerTab,
} from "@/lib/color-picker-pref"
import { useT } from "@/lib/i18n"
import { TAILWIND_PALETTE } from "@/lib/tailwind-palette"
import { cn } from "@/lib/utils"

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Cells stretch to fill the dialog width (label column + 11 equal columns).
const GRID = "grid grid-cols-[3.75rem_repeat(11,minmax(0,1fr))] gap-x-3"

// ── HSV, the model every 3D and photo app's picker is drawn in ──
// h in degrees 0..360, s and v 0..1; rgb 0..255.
type Hsv = { h: number; s: number; v: number }
type Rgb = [number, number, number]

const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace("#", ""), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
const rgbToHex = ([r, g, b]: Rgb) =>
  "#" +
  [r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))
  }
  return [f(5), f(3), f(1)]
}

/** `hue` is what to keep when the colour has none of its own (grey, black):
 *  dragging saturation to zero and back must not snap the hue to red. */
function rgbToHsv([r, g, b]: Rgb, hue = 0): Hsv {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = hue
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 }
}

type ChannelRow = {
  label: string
  value: number
  max: number
  track: string
  set: (n: number) => void
  fmt: (n: number) => string
}

/** A colour you can click. The palette grid keeps its own raw cells — it is
 *  hundreds of them under one delegated hover — but every swatch the picker tab
 *  adds is this, so they share focus handling with the rest of the app. */
function Swatch({ hex, onPick, label, className }: { hex: string; onPick: (hex: string) => void; label?: string; className?: string }) {
  return (
    <Button
      variant="ghost"
      aria-label={label ?? hex}
      tooltip={label ? `${label} ${hex}` : hex}
      className={cn(
        // A PALETTE CELL'S SIZE, not a stretch to the column: the first tab's
        // cells are ~36×20 with a hairline ring, and swatches that grew to fill
        // the width read as buttons rather than colours. Fixed, so a band of
        // them packs left instead of resizing with the dialog. Corners inline,
        // below the variant's, so the merge cannot keep the button's.
        SWATCH,
        "p-0 ring-1 ring-white/10 transition-transform duration-75 hover:z-10 hover:scale-115",
        className,
      )}
      style={{ background: hex, borderRadius: "var(--radius-xs)" }}
      onClick={() => onPick(hex)}
    />
  )
}

/** A labelled band of the picker tab. Fixed slots in every band, so nothing
 *  below it moves as the colour changes. */
function Band({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** Every picker-tab swatch, and the empty recent slots, at one size. */
const SWATCH = "h-5 w-9 shrink-0"

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }

/**
 * The second tab: the picker Blender, Photoshop and every app between them draw
 * — a saturation × value field over the hue and a slider per channel — with
 * what those apps keep around it: the colour you started from, an eyedropper,
 * the colour's tints and shades, its harmonies, and what you picked lately.
 *
 * It keeps its OWN hsv rather than re-deriving it from the hex each render:
 * hex has no hue for a grey and no saturation for black, so a round trip
 * through it would throw away what the hand just set. The hex is re-read only
 * when it changes from outside (a palette pick, a typed hex, a swatch).
 */
function ChannelPicker({
  value,
  onChange,
  original,
  recent,
}: {
  value: string
  onChange: (hex: string) => void
  /** What the field held when the dialog opened — click it to go back. */
  original: string
  recent: string[]
}) {
  const tc = useT().lab.colorPicker
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(value)))
  const [emitted, setEmitted] = useState(value.toLowerCase())
  if (value.toLowerCase() !== emitted) {
    setEmitted(value.toLowerCase())
    setHsv(rgbToHsv(hexToRgb(value), hsv.h))
  }
  const fieldRef = useRef<HTMLDivElement>(null)

  const commit = (next: Hsv) => {
    setHsv(next)
    const hex = rgbToHex(hsvToRgb(next))
    setEmitted(hex)
    if (hex !== value.toLowerCase()) onChange(hex)
  }
  const pick = (hex: string) => {
    if (hex.toLowerCase() !== value.toLowerCase()) onChange(hex.toLowerCase())
  }

  const fromPointer = (e: React.PointerEvent) => {
    const r = fieldRef.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    commit({ ...hsv, s: x, v: 1 - y })
  }

  // Chromium's screen sampler. Absent elsewhere, and then the button is not
  // drawn at all — a control that can only fail is worse than none.
  const EyeDropper =
    typeof window === "undefined" ? undefined : (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  const sample = async () => {
    if (!EyeDropper) return
    try {
      pick((await new EyeDropper().open()).sRGBHex)
    } catch {
      // Escape cancels the sampler, which rejects. Nothing to say about that.
    }
  }

  const rgb = hsvToRgb(hsv)
  const hueHex = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))
  const at = (patch: Partial<Hsv>) => rgbToHex(hsvToRgb({ ...hsv, ...patch }))
  const turn = (deg: number) => at({ h: (hsv.h + deg + 360) % 360 })
  const withChannel = (i: number, c: number): Rgb => rgb.map((x, j) => (j === i ? c : x)) as Rgb
  const rows: ChannelRow[] = [
    {
      label: "H",
      value: hsv.h,
      max: 360,
      track: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
      set: (h) => commit({ ...hsv, h }),
      fmt: (n) => `${Math.round(n)}°`,
    },
    {
      label: "S",
      value: hsv.s * 100,
      max: 100,
      track: `linear-gradient(to right, ${at({ s: 0 })}, ${at({ s: 1 })})`,
      set: (n) => commit({ ...hsv, s: n / 100 }),
      fmt: (n) => `${Math.round(n)}%`,
    },
    {
      label: "V",
      value: hsv.v * 100,
      max: 100,
      track: `linear-gradient(to right, #000, ${at({ v: 1 })})`,
      set: (n) => commit({ ...hsv, v: n / 100 }),
      fmt: (n) => `${Math.round(n)}%`,
    },
    ...(["R", "G", "B"] as const).map(
      (label, i): ChannelRow => ({
        label,
        value: rgb[i],
        max: 255,
        track: `linear-gradient(to right, ${rgbToHex(withChannel(i, 0))}, ${rgbToHex(withChannel(i, 255))})`,
        set: (n) => commit(rgbToHsv(withChannel(i, n), hsv.h)),
        fmt: (n) => String(Math.round(n)),
      }),
    ),
  ]

  // Toward white, the colour, toward black: four steps each way.
  const ramp = [0.8, 0.6, 0.4, 0.2]
    .map((t) => rgbToHex(mix(rgb, [255, 255, 255], t)))
    .concat(rgbToHex(rgb), [0.2, 0.4, 0.6, 0.8].map((t) => rgbToHex(mix(rgb, [0, 0, 0], t))))
  const harmonies: { label: string; hues: number[] }[] = [
    { label: tc.complementary, hues: [180] },
    { label: tc.analogous, hues: [-30, 30] },
    { label: tc.triadic, hues: [120, 240] },
    { label: tc.split, hues: [150, 210] },
  ]

  return (
    <div className="flex flex-col gap-5 pr-1.5 pb-1.5">
      <div className="grid grid-cols-[14rem_minmax(0,1fr)] gap-5">
        {/* Saturation across, value up, over the pure hue. Arrow keys nudge it
            for anyone not holding a mouse. */}
        <div
          ref={fieldRef}
          role="slider"
          tabIndex={0}
          aria-label={tc.field}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={tc.fieldValue(Math.round(hsv.s * 100), Math.round(hsv.v * 100))}
          className="relative aspect-square cursor-crosshair touch-none rounded-interior ring-1 ring-white/10 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})` }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            fromPointer(e)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e)
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.01
            const keys: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            }
            const d = keys[e.key]
            if (!d) return
            e.preventDefault()
            commit({ ...hsv, s: Math.min(1, Math.max(0, hsv.s + d[0])), v: Math.min(1, Math.max(0, hsv.v + d[1])) })
          }}
        >
          <span
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: value }}
          />
        </div>

        <div className="flex flex-col justify-between">
          {/* Before and after, as Photoshop shows them: the left half is what
              you opened with, and clicking it puts that back. */}
          <div className="flex items-center gap-2">
            <div className="flex h-6 min-w-0 flex-1 overflow-hidden rounded-chip ring-1 ring-white/10">
              <Button
                variant="ghost"
                aria-label={tc.backTo(original)}
                tooltip={tc.backTo(original)}
                className="h-full flex-1 rounded-none p-0"
                style={{ background: original }}
                onClick={() => pick(original)}
              />
              <div className="h-full flex-1" style={{ background: value }} />
            </div>
            {EyeDropper && (
              <Button variant="ghost" size="icon-xs" aria-label={tc.eyedropper} tooltip={tc.eyedropper} onClick={sample}>
                <Pipette />
              </Button>
            )}
          </div>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="w-3 shrink-0 text-xs text-muted-foreground">{r.label}</span>
              <Slider
                aria-label={r.label}
                className="min-w-0 flex-1 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:hover:ring-2 [&_[data-slot=slider-track]]:h-1"
                value={[r.value]}
                min={0}
                max={r.max}
                step={1}
                track={r.track}
                onValueChange={([n]) => r.set(n)}
              />
              <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {r.fmt(r.value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Band label={tc.ramp}>
        <div className="flex gap-3">
          {ramp.map((hex, i) => (
            <Swatch key={i} hex={hex} onPick={pick} className={cn(i === 4 && "z-10 ring-2 ring-blue-400 ring-offset-1 ring-offset-zinc-950")} />
          ))}
        </div>
      </Band>

      <Band label={tc.harmony}>
        <div className="flex gap-6">
          {harmonies.map((g) => (
            <div key={g.label} className="flex min-w-0 flex-col gap-1">
              <div className="flex gap-1.5">
                {g.hues.map((d) => (
                  <Swatch key={d} hex={turn(d)} onPick={pick} label={g.label} />
                ))}
              </div>
              <span className="truncate text-xs text-muted-foreground">{g.label}</span>
            </div>
          ))}
        </div>
      </Band>

      <Band label={tc.recent}>
        <div className="flex gap-3">
          {Array.from({ length: RECENT_COLORS }, (_, i) =>
            recent[i] ? (
              <Swatch key={i} hex={recent[i]} onPick={pick} />
            ) : (
              <div key={i} className={cn(SWATCH, "rounded-xs border border-dashed border-line")} />
            ),
          )}
        </div>
      </Band>
    </div>
  )
}

/** Hex text field — typing a complete `#rrggbb` commits it live. */
export function HexField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (hex: string) => void
  className?: string
}) {
  // Controlled text so the preview refreshes live while typing
  // State, not refs: both are read during render to decide the re-sync below
  const [text, setText] = useState(value)
  const [last, setLast] = useState(value)
  const [focused, setFocused] = useState(false)
  if (!focused && value !== last) {
    setLast(value)
    setText(value)
  }
  return (
    <input
      value={text}
      spellCheck={false}
      className={cn(
        "h-7 w-28 rounded-md border border-white/10 bg-black/30 px-2 font-mono text-xs outline-none focus:border-blue-400/50",
        className,
      )}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setLast(value)
        setText(value)
      }}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const hex = raw.trim().replace(/^#?/, "#").toLowerCase()
        if (/^#[0-9a-f]{6}$/.test(hex) && hex !== value.toLowerCase()) onChange(hex)
      }}
    />
  )
}

export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (hex: string) => void
  /** Shown but inert — for a colour whose switch is off, so the row keeps its
   *  shape instead of growing a swatch when the switch flips. */
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const active = value.toLowerCase()
  const tc = useT().lab.colorPicker

  return (
    <>
      {/* One button — hovering either the swatch or the hex triggers both effects. */}
      <button
        className="group flex cursor-pointer items-center gap-1.5 disabled:pointer-events-none disabled:opacity-40"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={tc.open}
      >
        <span
          className="size-4 shrink-0 rounded-md ring-1 ring-white/15 transition-transform group-hover:scale-110"
          style={{ background: value }}
        />
        <span className="font-mono text-xs text-muted-foreground underline-offset-2 group-hover:text-foreground group-hover:underline">
          {active}
        </span>
      </button>

      <ColorPickerDialog open={open} onOpenChange={setOpen} value={value} onChange={onChange} />
    </>
  )
}

/** The palette + hex picker on its own, so any trigger (the ColorField chip, a node socket */
export function ColorPickerDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (hex: string) => void
}) {
  const active = value.toLowerCase()
  const tc = useT().lab.colorPicker

  // The tab this browser last used, re-read on every open — so switching in one
  // field's picker is what the next field's picker opens on too.
  const [tab, setTab] = useState<ColorPickerTab>("palette")
  const [wasOpen, setWasOpen] = useState(false)
  // What the field held at open (the picker's "back to"), and the recents as
  // they stood then. A colour joins the recents when the dialog closes on it,
  // not on every drag step — sixty near-identical blues are not a history.
  const [original, setOriginal] = useState(value)
  const [recent, setRecent] = useState<string[]>([])
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTab(loadColorPickerTab())
      setOriginal(value)
      setRecent(loadRecentColors())
    } else if (value.toLowerCase() !== original.toLowerCase()) {
      pushRecentColor(value)
    }
  }

  // Hovering a swatch previews its name+hex+color in the bottom bar (event-delegated
  const [hover, setHover] = useState<{ name: string; hex: string } | null>(null)
  const onGridOver = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-hex]")
    setHover(btn ? { name: btn.dataset.name!, hex: btn.dataset.hex! } : null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // Don't autofocus the first swatch on open
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="gap-3 rounded-xl border-white/10 bg-zinc-950 sm:max-w-2xl"
        >
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as ColorPickerTab)
              saveColorPickerTab(v as ColorPickerTab)
            }}
            className="gap-3"
          >
          {/* Title and tabs on one line, centred on the close button: the
              button's middle sits 24px down (top-4 + half its 16px), the
              content's padding puts this 24px row's middle at 36px, and -mt-3
              takes back the difference. */}
          <DialogHeader className="-mt-3 flex-row items-center gap-3 pr-8">
            <DialogTitle className="text-sm font-medium">{tc.title}</DialogTitle>
            <TabsList>
              <TabsTrigger value="palette">{tc.palette}</TabsTrigger>
              <TabsTrigger value="picker">{tc.picker}</TabsTrigger>
            </TabsList>
          </DialogHeader>

          {/* BOTH TABS IN ONE CELL, the hidden one invisible rather than gone,
              so the dialog is the palette's size whichever is showing and
              switching moves nothing. (TabsContent unmounts or display:nones
              the inactive tab, which is exactly the resize this avoids.) */}
          <div className="grid">
          <div
            role="tabpanel"
            className={cn("col-start-1 row-start-1 min-h-0", tab !== "picker" && "invisible")}
          >
            <ChannelPicker value={value} onChange={onChange} original={original} recent={recent} />
          </div>

          <div
            role="tabpanel"
            className={cn("col-start-1 row-start-1 max-h-[75vh] overflow-auto", tab !== "palette" && "invisible")}
          >
            {/* Padding so the edge cells' rings/hover-scale aren't clipped by overflow. */}
            <div className="pr-1.5 pb-1.5">
              {/* Shade column headers */}
              <div className={cn(GRID, "mb-1.5")}>
                <span />
                {SHADES.map((s) => (
                  <span key={s} className="text-center text-xs text-muted-foreground tabular-nums">
                    {s}
                  </span>
                ))}
              </div>

              {/* Hover previews in the bottom bar via one delegated handler (no Radix Tooltip per swatch */}
              <div className="space-y-[5px]" onMouseOver={onGridOver} onMouseLeave={() => setHover(null)}>
                {TAILWIND_PALETTE.map((row) => {
                  const hue = row[0].name.split("-")[0]
                  return (
                    <div key={hue} className={cn(GRID, "items-center")}>
                      <span className="truncate text-xs text-muted-foreground">{cap(hue)}</span>
                      {row.map(({ name, hex }) => (
                        <button
                          key={name}
                          data-name={name}
                          data-hex={hex}
                          className={cn(
                            "h-5 w-full cursor-pointer rounded-xs transition-transform duration-75 ease-out hover:z-10 hover:scale-115",
                            active === hex.toLowerCase()
                              ? "z-10 ring-2 ring-blue-400 ring-offset-1 ring-offset-zinc-950"
                              : "ring-1 ring-white/10",
                          )}
                          style={{ background: hex }}
                          onClick={() => {
                            onChange(hex)
                            onOpenChange(false)
                          }}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          </div>
          </Tabs>

          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <span className="text-xs text-muted-foreground">{tc.customHex}</span>
            <HexField value={value} onChange={onChange} />
            {/* Right side previews the hovered swatch (name + hex + chip) */}
            <div className="ml-auto flex items-center gap-2">
              {hover && <span className="text-xs text-muted-foreground">{cap(hover.name)}</span>}
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {(hover?.hex ?? value).toLowerCase()}
              </span>
              <span
                className="size-6 rounded-md ring-1 ring-white/15"
                style={{ background: hover?.hex ?? value }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
  )
}
