"use client"

// The panes of the cover's console.
//
// The console is a numbered index with the chosen entry's controls beside it,
// so a pane is shown only while its entry is chosen, and it carries no title:
// the index already names it, and its tabs already say which part is open. A
// pane that adds to itself ("Add model") ends its list with that action.

import { Button } from "@/components/ui/button"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function LayerRow({
  domId,
  children,
}: {
  /** Addressable for go-to: the palette scrolls a row into view by this id. */
  domId?: string
  children: ReactNode
}) {
  return (
    // A column that shrinks to the console: a tabbed pane scrolls under its
    // tab line (TabsContent), any other pane scrolls whole.
    <section id={domId} className="flex min-h-0 flex-col">
      {/* text-muted-foreground on the WRAPPER: every control label inside is
          muted, and controls that mean to be bright override locally. */}
      <div className="no-scrollbar cover-enter flex min-h-0 flex-col overflow-y-auto px-4 pb-3 text-muted-foreground">{children}</div>
    </section>
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
        <Button variant="bare"
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
        </Button>
      ))}
    </div>
  )
}

/** A pane of the console holding a run of rows — Cast, Clips, Music — with
 *  the action that adds to it as the list's last line. */
export function StackGroup({
  domId,
  action,
  open = true,
  children,
}: {
  /** Addressable for go-to, like LayerRow's. */
  domId?: string
  action?: ReactNode
  open?: boolean
  children: ReactNode
}) {
  if (!open) return null
  return (
    // -mt-2: its rows are h-8, so this sets the first one's text on the
    // index's first row, where a tabbed pane's tabs sit.
    <section id={domId} className="group/stack -mt-2 flex min-h-0 flex-col pb-3">
      <div className="no-scrollbar cover-enter flex min-h-0 flex-col overflow-y-auto">
        {children}
        {action && <div className="mx-4 mt-1 flex">{action}</div>}
      </div>
    </section>
  )
}
