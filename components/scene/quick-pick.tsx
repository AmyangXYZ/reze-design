"use client"

// Quick-switch list behind a section's blue value text.

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, Search } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ShelfCount } from "@/components/editor/library-rail"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type QuickPickItem = {
  id: string
  label: string
  hint?: string
  /** Which section the row sits in. Defaults to "builtin". */
  section?: "builtin" | "community" | "local"
}

export function QuickPick({
  value,
  applied,
  trigger,
  label,
  items,
  onPick,
  onBrowse,
  onEdit,
  editLabel,
  placeholder,
}: {
  /** Currently applied id, or null when nothing is applied. */
  value: string | null
  /** MEMBERSHIP, for a picker that applies several: every id in here ticks.
   *  A single `value` cannot say "these four are on", which is how a
   *  multi-apply list ended up with no tick anywhere in it. */
  applied?: string[]
  /** Replaces the default value-text trigger. A picker that ADDS to a list is
   *  an action, not a value, and should not wear the same clothes as the rows
   *  it adds to. */
  trigger?: ReactNode
  /** Display override for the trigger, when the raw value isn't what to show (the engine's stock */
  label?: string
  items: QuickPickItem[]
  onPick: (id: string) => void
  /** Escape hatch to the full library, last in the list. Omit when the caller
   *  renders its own Browse affordance beside the picker instead. */
  onBrowse?: () => void
  /** Optional: open the editor on the current value. Rendered above "Browse all…". */
  onEdit?: () => void
  editLabel?: string
  /** Shown (muted) when nothing is applied. */
  placeholder: string
}) {
  const t = useT()
  // Controlled so Edit / Browse can dismiss it — both open another surface, and
  // leaving the list floating over it reads as a stuck menu. Picking a value
  // deliberately does NOT close, so several looks can be tried in a row.
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const current = items.find((i) => i.id === value)
  const isOn = (id: string) => (applied ? applied.includes(id) : id === value)
  // Scroll the applied row into view when the list opens. Each shelf scrolls on
  // its own and the shelves are short, so an applied look a dozen rows down
  // opened to a list with no tick anywhere in it — indistinguishable from
  // nothing being applied. `nearest` so a row already visible does not jump, and
  // a frame late because Radix positions the popover after mount.
  const activeRow = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => activeRow.current?.scrollIntoView({ block: "nearest" }))
    return () => cancelAnimationFrame(id)
  }, [open])
  // Matched against the label and the id, so a built-in is found by its
  // English name in the Chinese UI as well as by the name on screen.
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? items.filter((i) => i.label.toLowerCase().includes(needle) || i.id.toLowerCase().includes(needle))
    : items
  const local = shown.filter((i) => i.section === "local")
  const published = shown.filter((i) => i.section !== "local")
  const row = (i: QuickPickItem) => (
    <Button variant="bare"
      key={i.id}
      ref={isOn(i.id) ? activeRow : undefined}
      onClick={() => onPick(i.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-interior px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
        isOn(i.id) ? "text-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.hint && <span className="shrink-0 font-mono text-2xs text-muted-foreground">{i.hint}</span>}
      {isOn(i.id) && <Check className="size-3.5 shrink-0" />}
    </Button>
  )
  // Blue whenever something is APPLIED — membership when the caller tracks a
  // set, a single value otherwise.
  const anyOn = applied ? applied.length > 0 : value !== null && value !== ""
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="bare"
            className={cn(
              "min-w-0 cursor-pointer truncate text-xs underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current",
              anyOn ? "text-blue-400" : "text-muted-foreground",
            )}
          >
            {/* `||`, not `??`: an empty label is as good as none, and falling
                through to the placeholder keeps the trigger clickable. */}
            {label || current?.label || placeholder}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        // Wide enough for the longest built-in names. The height comes from
        // Radix's measurement of the gap to the viewport edge, capped at 32rem;
        // the var() fallback matters, as the variable is only set once collision
        // detection runs.
        className="flex max-h-[min(32rem,var(--radix-popover-content-available-height,32rem))] w-44 flex-col rounded-surface border-line-strong bg-surface-raised p-1 shadow-float backdrop-blur-xs"
        // Returning focus to the trigger draws a stuck ring on the value text.
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Focus goes to the search, so typing filters straight away.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchRef.current?.focus()
        }}
      >
        <div className="relative mb-1 shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.rail.search}
            className="h-7 border-line-strong bg-white/5 pl-7 text-xs focus-visible:border-blue-400/50 focus-visible:ring-0 md:text-xs"
          />
        </div>
        {/* Your drafts exist only on this device, so they sit apart, above the
            one published list. Rows are 1.75rem (text-xs in py-1.5), so each cap
            is a whole number of rows and never slices one in half. */}
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {local.length > 0 && (
            <div className="flex min-h-0 shrink-0 flex-col border-b border-line pb-1 mb-1">
              <div className="shrink-0 px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                {t.rail.local}
                <ShelfCount n={local.length} />
              </div>
              <ScrollArea bars className="max-h-[3.5rem]">{local.map(row)}</ScrollArea>
            </div>
          )}
          {published.length ? (
            <ScrollArea bars className="max-h-[15.75rem] shrink-0">{published.map(row)}</ScrollArea>
          ) : (
            (!needle || local.length === 0) && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {needle ? t.rail.noMatches : t.rail.communityEmpty}
              </div>
            )
          )}
        </div>

        {(onEdit || onBrowse) && (
        <div className="mt-1 shrink-0 border-t border-line pt-1">
          {onEdit && (
            <Button variant="bare"
              onClick={() => {
                setOpen(false)
                onEdit()
              }}
              className="w-full cursor-pointer rounded-interior px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {editLabel ?? t.materials.editGraph}
            </Button>
          )}
          {onBrowse && (
            <Button variant="bare"
              onClick={() => {
                setOpen(false)
                onBrowse()
              }}
              className="w-full cursor-pointer rounded-interior px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {t.scene.browseAll}
            </Button>
          )}
        </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
