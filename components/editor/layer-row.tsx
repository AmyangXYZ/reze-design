"use client"

// One row of the scene stack.
//
// Collapsed it is a single line that still reports its state — but it names the
// DECISION ("Golden hour"), not the values behind it ("205° · 21°"). Reciting
// numbers at rest is what makes a panel read as a debug GUI, and it is the
// difference between reading a scene in one column and parsing it.
//
// The summary is sans, not mono, for the same reason: a preset name is a name,
// and monospacing it puts the readout back.
//
// Only one row is open at a time — enforced by the caller, since the stack owns
// which — so presets-then-parameters inside a row costs no ambient noise.

import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function LayerRow({
  icon: Icon,
  name,
  /** What this layer is SET TO. Omitted when the row has nothing to report. */
  summary,
  open,
  onToggle,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  summary?: string | null
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
          open ? "bg-white/[0.05]" : "hover:bg-white/[0.04]",
        )}
      >
        <Icon className={cn("size-4 shrink-0", open ? "text-blue-400" : "text-muted-foreground")} />
        <span className="shrink-0 text-xs">{name}</span>
        {/* Hidden rather than unmounted while open: the row must not reflow when
            the body appears, and the summary is about to be redundant anyway. */}
        <span
          className={cn(
            "ml-auto max-w-[8.25rem] truncate text-[11px] text-muted-foreground transition-opacity",
            open && "opacity-0",
          )}
        >
          {summary}
        </span>
      </button>
      {open && <div className="px-3 pt-0.5 pb-3">{children}</div>}
    </div>
  )
}

/**
 * Presets before parameters — the pattern the libraries already use, applied
 * inside a row. Picking one renames the row above, which is the whole point:
 * the summary reports a decision the user made, not a number they scrolled past.
 */
export function PresetChips({
  options,
  value,
  onPick,
}: {
  options: string[]
  value: string | null
  onPick: (name: string) => void
}) {
  return (
    <div className="mb-2.5 flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          aria-pressed={o === value}
          onClick={() => onPick(o)}
          className={cn(
            // 4px — the chip step of the radii scale.
            "rounded-chip border px-2 py-0.5 text-[10.5px] transition-colors",
            o === value
              ? "border-blue-400/40 bg-blue-400/15 text-blue-400"
              : "border-line-strong text-muted-foreground hover:border-white/25 hover:text-foreground",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/** A group label above a run of rows — Cast, Scene. Mono and quiet: it is a
 *  divider that happens to have a word on it, not a heading competing with the
 *  row names underneath. */
export function StackGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="px-3 pt-3 pb-1 font-mono text-[9.5px] tracking-[0.15em] text-muted-foreground uppercase">
        {label}
      </div>
      {children}
    </>
  )
}
