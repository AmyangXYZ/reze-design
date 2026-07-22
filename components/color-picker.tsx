"use client"

// THE color control for the app: a chip (click → picker dialog) + read-only
// hex label. The dialog mirrors the shadcn colors page — the full Tailwind
// palette as a labelled grid: one row per hue, shade columns 50–950, each
// swatch titled with its name and hex, plus a free hex field. Every color
// setting reuses this one component and this one palette.

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { TAILWIND_PALETTE } from "@/lib/tailwind-palette"
import { cn } from "@/lib/utils"

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Cells stretch to fill the dialog width (label column + 11 equal columns).
// Horizontal gap only; row spacing is handled by space-y on the row stack.
const GRID = "grid grid-cols-[3.75rem_repeat(11,minmax(0,1fr))] gap-x-3"

function HexField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  // Controlled text so the preview refreshes live while typing; a valid 6-digit
  // hex applies immediately (no need to blur/enter). When `value` changes from
  // outside (a swatch click), reset the field in-render — React's recommended
  // alternative to a syncing effect.
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }
  return (
    <input
      value={text}
      spellCheck={false}
      className="h-7 w-28 rounded-md border border-white/10 bg-black/30 px-2 font-mono text-xs outline-none focus:border-blue-400/50"
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
      <span className="flex items-center gap-1.5">
        <button
          className="size-4 shrink-0 cursor-pointer rounded-md ring-1 ring-white/15 transition-transform hover:scale-110"
          style={{ background: value }}
          onClick={() => setOpen(true)}
        />
        <span className="w-14 font-mono text-xs text-muted-foreground">{active}</span>
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 rounded-xl border-white/10 bg-zinc-950 sm:max-w-2xl">
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

              {/* Tooltips only open on hover-settle (delay), never during a fast
                  sweep — so they don't affect scrub smoothness. The jank fix was
                  removing the per-swatch box-shadow + dialog backdrop-blur, not the
                  tooltips; hover here is a composited transform only (no paint). */}
              <TooltipProvider delayDuration={150} skipDelayDuration={400}>
                <div className="space-y-[5px]">
                  {TAILWIND_PALETTE.map((row) => {
                    const hue = row[0].name.split("-")[0]
                    return (
                      <div key={hue} className={cn(GRID, "items-center")}>
                        <span className="truncate text-xs text-muted-foreground">{cap(hue)}</span>
                        {row.map(({ name, hex }) => (
                          <Tooltip key={name}>
                            <TooltipTrigger asChild>
                              <button
                                className={cn(
                                  "h-5 w-full cursor-pointer rounded-xs transition-transform duration-75 ease-out hover:z-10 hover:scale-110",
                                  active === hex.toLowerCase()
                                    ? "z-10 ring-2 ring-blue-400 ring-offset-1 ring-offset-zinc-950"
                                    : "ring-1 ring-white/10",
                                )}
                                style={{ background: hex }}
                                onClick={() => {
                                  onChange(hex)
                                  setOpen(false)
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="font-mono text-xs">
                              {name} {hex}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </TooltipProvider>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-white/5 pt-3">
            <span className="text-xs text-muted-foreground">Custom hex</span>
            <HexField value={value} onChange={onChange} />
            <span className="size-6 rounded-md ring-1 ring-white/15" style={{ background: value }} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
