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
        {/* Three compartments, same as the full libraries.
            Built-ins and Community are PEERS: both flex-1 with the same cap, so
            they share the popover evenly and neither can push the other out of
            sight. Both hold a whole library now — nine-odd built-ins, and every
            published row — and there is no reason the app's own list should
            outrank everyone else's. Local is pinned small below them: your own
            drafts on this device, a short list by nature.

            flex-1 with a max-h rather than a fixed height, so a SHORT list still
            shrink-wraps instead of leaving a hole where rows would be. An empty
            Community drops back to shrink-0 for the same reason — a section with
            one line of text in it must not claim half the panel.

            Every header sits OUTSIDE its scroller, so it stays put while the rows
            move under it: a heading that scrolls away leaves you reading a list
            with no idea whose it is. Both headers always render, matching the
            full libraries — an empty Community is the one place a quick switch
            can suggest that publishing exists. Local stays conditional; an empty
            one tells you nothing you did not know. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground/60">
            {t.rail.builtin}
          </div>
          <ScrollArea bars className="min-h-0 max-h-44 flex-1">
            {items.filter((i) => (i.section ?? "builtin") === "builtin").map(row)}
          </ScrollArea>
        </div>
        <div
          className={cn(
            "mt-1 flex min-h-0 flex-col border-t border-white/10 pt-1",
            items.some((i) => i.section === "community") ? "flex-1" : "shrink-0",
          )}
        >
          <div className="shrink-0 px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground/60">
            {t.rail.community}
          </div>
          {items.some((i) => i.section === "community") ? (
            <ScrollArea bars className="min-h-0 max-h-44 flex-1">
              {items.filter((i) => i.section === "community").map(row)}
            </ScrollArea>
          ) : (
            <div className="px-2 pb-1 text-xs text-muted-foreground/50">{t.rail.communityEmpty}</div>
          )}
        </div>
        {items.some((i) => i.section === "local") && (
          <div className="mt-1 shrink-0 border-t border-white/10 pt-1">
            <div className="px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground/60">
              {t.rail.local}
            </div>
            <ScrollArea bars className="max-h-16">{items.filter((i) => i.section === "local").map(row)}</ScrollArea>
          </div>
        )}
        {(onEdit || onBrowse) && (
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
          {onBrowse && (
            <button
              onClick={() => {
                setOpen(false)
                onBrowse()
              }}
              className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {t.scene.browseAll}
            </button>
          )}
        </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
