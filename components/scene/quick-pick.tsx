"use client"

// Quick-switch list behind a section's blue value text.

import { useState } from "react"
import { Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  /** Display override for the trigger, when the raw value isn't what to show (the engine's stock */
  label?: string
  items: QuickPickItem[]
  onPick: (id: string) => void
  /** Escape hatch to the full library — always last, always present. */
  onBrowse: () => void
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
  const current = items.find((i) => i.id === value)
  const row = (i: QuickPickItem) => (
    <button
      key={i.id}
      onClick={() => onPick(i.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
        i.id === value ? "text-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.hint && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">{i.hint}</span>}
      {i.id === value && <Check className="size-3.5 shrink-0" />}
    </button>
  )
  // Blue whenever something is APPLIED
  const applied = value !== null && value !== ""
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "min-w-0 cursor-pointer truncate text-xs underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current",
            applied ? "text-blue-400" : "text-muted-foreground/50",
          )}
        >
          {/* `||`, not `??`: an empty label is as good as none, and falling
              through to the placeholder keeps the trigger clickable. */}
          {label || current?.label || placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        // Wide enough for the longest built-in name ("Principled BSDF") — truncating
        // the labels in a list whose whole job is naming things reads as broken.
        //
        // A flex column with a bounded height is what makes the pinned sections
        // below pin: the height comes from Radix's own measurement of the gap to
        // the viewport edge, capped at 28rem so a tall screen doesn't produce a
        // list running the full window. The fallback in the var() matters — the
        // variable is only set when collision detection runs, and without it the
        // whole max-height declaration would be dropped as invalid.
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height,28rem))] w-44 flex-col rounded-xl border-white/10 bg-zinc-950/95 p-1 shadow-float backdrop-blur-xs"
        // Returning focus to the trigger draws a stuck ring on the value text, and
        // grabbing it on open leaves the first row ringed and flashing on close.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Three compartments, same as the full libraries: built-ins take the
            slack and scroll, Community and Local are pinned below at a fixed
            size. Pinned because they are the rows you are most likely to want
            and the ones a growing built-in list pushes out of sight first —
            scrolling past nine shader graphs to reach your own draft is the
            failure this layout exists to prevent.

            The built-in area is flex-1 rather than a fixed max-h, so a SHORT
            list still shrink-wraps (auto height, nothing to grow into) while a
            long one gives way to the compartments instead of overflowing. */}
        <ScrollArea className="min-h-0 flex-1">
          {/* Both headers always, matching the full libraries — and an empty
              Community is the one place a quick switch can suggest that
              publishing exists. Local stays conditional: your own drafts. */}
          <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground/60">
            {t.rail.builtin}
          </div>
          {items.filter((i) => (i.section ?? "builtin") === "builtin").map(row)}
        </ScrollArea>
        <div className="mt-1 shrink-0 border-t border-white/10 pt-1">
          <div className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground/60">
            {t.rail.community}
          </div>
          {items.some((i) => i.section === "community") ? (
            <ScrollArea className="max-h-24">{items.filter((i) => i.section === "community").map(row)}</ScrollArea>
          ) : (
            <div className="px-2 pb-1 text-xs text-muted-foreground/50">{t.rail.communityEmpty}</div>
          )}
        </div>
        {items.some((i) => i.section === "local") && (
          <div className="mt-1 shrink-0 border-t border-white/10 pt-1">
            <div className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground/60">
              {t.rail.local}
            </div>
            <ScrollArea className="max-h-16">{items.filter((i) => i.section === "local").map(row)}</ScrollArea>
          </div>
        )}
        <div className="mt-1 shrink-0 border-t border-white/10 pt-1">
          {onEdit && (
            <button
              onClick={() => {
                setOpen(false)
                onEdit()
              }}
              className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {editLabel ?? t.materials.editGraph}
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false)
              onBrowse()
            }}
            className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          >
            {t.scene.browseAll}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
