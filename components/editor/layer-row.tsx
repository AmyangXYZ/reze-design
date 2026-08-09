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
// Name bright, summary muted — always, not by open/closed state. The column is
// meant to be read as a list of decisions, and dimming the names at rest makes
// you hunt for the one you want instead of scanning them.
//
// Name and value are the SAME size. They sit on one line and are read as one
// statement — "Background: Shining Stars" — so shrinking the right half makes it
// read as a footnote to the row rather than as the row's answer. Colour already
// separates them, and that is the only separation this needs.
//
// Only one row is open at a time — enforced by the caller, since the stack owns
// which — so presets-then-parameters inside a row costs no ambient noise.

import type { ComponentType, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function LayerRow({
  icon: Icon,
  name,
  domId,
  /** What this layer is SET TO. Omitted when the row has nothing to report. */
  summary,
  open,
  onToggle,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  name: string
  /** Addressable for go-to: the palette scrolls a row into view by this id. */
  domId?: string
  summary?: string | null
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div id={domId} className="border-t border-line first:border-t-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors",
          open ? "bg-white/[0.05]" : "hover:bg-white/[0.04]",
        )}
      >
        <Icon className={cn("size-4 shrink-0", open ? "text-blue-400" : "text-muted-foreground")} />
        <span className="shrink-0 text-[13px] text-foreground font-medium">{name}</span>
        {/* Hidden rather than unmounted while open: the row must not reflow when
            the body appears, and the summary is about to be redundant anyway. */}
        <span
          className={cn(
            // No transition: the body swaps instantly when rows switch, and a
            // summary that FADES back in reads as the value arriving late.
            "ml-auto max-w-[8.25rem] truncate text-[13px] text-muted-foreground",
            open && "opacity-0",
          )}
        >
          {summary}
        </span>
      </button>
      {/* Symmetric padding, and pt has to MATCH pb rather than being the tighter
          value that felt right in isolation. An open header carries a tint, so
          its own py-2.5 reads as part of the header block and not as space below
          it — the eye measures from the band's edge. With pt-1 the item sat 4px
          under the band and 14px above the next divider, which is what made it
          look mispositioned rather than merely close. Tighten both together or
          not at all. */}
      {/* text-muted-foreground on the WRAPPER: the row name above is bright and
          every control label inside is muted, so title and items never read as
          the same tier. Controls that mean to be bright (a selected chip, an
          editing value) override locally.

          pt one step under pb: the open header's tinted band contributes its
          own 8px below the title, so equal paddings read as a LARGER gap above
          the first control than below the last. Slightly smaller pt is what
          looks symmetric. */}
      {open && <div className="px-4 pt-2 pb-3 text-muted-foreground">{children}</div>}
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
            "rounded-chip border px-2 py-0.5 text-xs transition-colors",
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

/** A group label above a run of rows — Cast, Scene.
 *
 *  Body size, with mono + uppercase + colour carrying the difference instead of
 *  scale. Tracking eases from 0.18em to 0.12em on the way up: letter-spacing is
 *  there to keep small caps from clotting, and the amount that helps at 10px is
 *  visibly loose at 14 — spacing has to come DOWN as size goes up. */
export function StackGroup({
  label,
  domId,
  /** Acts on the whole group — adding to it. Revealed by hovering ANYWHERE in
   *  the group, not only the label: the rows are what you are looking at when
   *  you decide you want another one. */
  action,
  children,
}: {
  label: string
  /** Addressable for go-to, like LayerRow's. */
  domId?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div id={domId} className="group/stack">
      {/* Tight under the label, looser above it. The whitespace has to say which
          rows the label OWNS — a label floating equidistant between the block
          above and the block below belongs to neither. */}
      <div className="flex items-center gap-2 px-4 pt-6 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </span>
        {/* The action has to fit the label's own line box, or a group that has
            one is taller than a group that does not. */}
        {action && (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/stack:opacity-100 focus-within:opacity-100">
            {action}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
