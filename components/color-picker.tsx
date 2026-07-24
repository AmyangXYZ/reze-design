"use client"

// THE color control for the app: a chip (click → picker dialog) + read-only
// hex label. The dialog mirrors the shadcn colors page — the full Tailwind
// palette as a labelled grid: one row per hue, shade columns 50–950, each
// swatch titled with its name and hex, plus a free hex field. Every color
// setting reuses this one component and this one palette.

import { useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TAILWIND_PALETTE } from "@/lib/tailwind-palette"
import { cn } from "@/lib/utils"

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Cells stretch to fill the dialog width (label column + 11 equal columns).
// Horizontal gap only; row spacing is handled by space-y on the row stack.
const GRID = "grid grid-cols-[3.75rem_repeat(11,minmax(0,1fr))] gap-x-3"

function HexField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  // Controlled text so the preview refreshes live while typing; a valid 6-digit hex
  // applies immediately. Re-sync from an OUTSIDE change (a swatch click) only while NOT
  // focused — otherwise committing a hex would reformat the text and jump the caret.
  const [text, setText] = useState(value)
  const last = useRef(value)
  const focused = useRef(false)
  if (!focused.current && value !== last.current) {
    last.current = value
    setText(value)
  }
  return (
    <input
      value={text}
      spellCheck={false}
      className="h-7 w-28 rounded-md border border-white/10 bg-black/30 px-2 font-mono text-xs outline-none focus:border-blue-400/50"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        last.current = value
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

export function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false)
  const active = value.toLowerCase()

  return (
    <>
      {/* One button — hovering either the swatch or the hex triggers both effects. */}
      <button className="group flex cursor-pointer items-center gap-1.5" onClick={() => setOpen(true)} aria-label="Pick color">
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

/** The palette + hex picker on its own, so any trigger (the ColorField chip, a node
 *  socket swatch) can open the same one control. Value/onChange are sRGB hex. */
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

  // Hovering a swatch previews its name+hex+color in the bottom bar (event-delegated,
  // so no per-swatch component cost). Instant, no floating tooltip.
  const [hover, setHover] = useState<{ name: string; hex: string } | null>(null)
  const onGridOver = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-hex]")
    setHover(btn ? { name: btn.dataset.name!, hex: btn.dataset.hex! } : null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // Don't autofocus the first swatch on open — Radix shows a tooltip on
          // focus, which made "red-50" pop up every time the picker opened.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="gap-3 rounded-xl border-white/10 bg-zinc-950 sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">Pick a color</DialogTitle>
          </DialogHeader>

          <div className="max-h-[75vh] overflow-auto">
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

              {/* Hover previews in the bottom bar via one delegated handler (no Radix
                  Tooltip per swatch — 242 Tooltip trees were the dialog's open-lag).
                  Hover is a composited transform only, so scrubbing stays smooth. */}
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

          <div className="flex items-center gap-2 border-t border-white/10 pt-3">
            <span className="text-xs text-muted-foreground">Custom hex</span>
            <HexField value={value} onChange={onChange} />
            {/* Right side previews the hovered swatch (name + hex + chip); falls back
                to the current value when nothing is hovered. */}
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
