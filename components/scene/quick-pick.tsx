"use client"

// Quick-switch list behind a section's blue value text.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check } from "lucide-react"
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
  // Derived once: the rows and the number beside the heading come from the same
  // list, which is the only way they cannot disagree.
  const builtins = items.filter((i) => (i.section ?? "builtin") === "builtin")
  const community = items.filter((i) => i.section === "community")
  const local = items.filter((i) => i.section === "local")
  const row = (i: QuickPickItem) => (
    <button
      key={i.id}
      ref={isOn(i.id) ? activeRow : undefined}
      onClick={() => onPick(i.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5",
        isOn(i.id) ? "text-blue-400" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {i.hint && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{i.hint}</span>}
      {isOn(i.id) && <Check className="size-3.5 shrink-0" />}
    </button>
  )
  // Blue whenever something is APPLIED — membership when the caller tracks a
  // set, a single value otherwise.
  const anyOn = applied ? applied.length > 0 : value !== null && value !== ""
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            className={cn(
              "min-w-0 cursor-pointer truncate text-xs underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current",
              anyOn ? "text-blue-400" : "text-muted-foreground",
            )}
          >
            {/* `||`, not `??`: an empty label is as good as none, and falling
                through to the placeholder keeps the trigger clickable. */}
            {label || current?.label || placeholder}
          </button>
        )}
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
        {/* Row height is 1.75rem — text-xs (a 1rem line box) inside py-1.5 — and
            every cap below is a MULTIPLE of it: 10.5rem is six rows, 7rem is
            four, 3.5rem is two.

            The caps only hold because nothing here flexes. As flex-1 children
            these sections grew into spare room and shrank when the popover was
            tight, both in PIXELS — so a shelf ended up 163px or 174px tall and
            drew a row with its bottom sliced off. Content-sized up to a whole
            number of rows means a shelf is either exactly as tall as its rows or
            exactly as tall as its cap, and never a fraction in between. The
            popover itself takes the overflow in the rare case where all three
            shelves are full at once.

            Three compartments, same as the full libraries. Built-ins get the
            deepest shelf because that list is fixed and learnable; Community is
            shallower here only because the library exists for browsing it, and
            Local is your own drafts on this device — a short list by nature.

            Every header sits OUTSIDE its scroller, so it stays put while the rows
            move under it: a heading that scrolls away leaves you reading a list
            with no idea whose it is. Both headers always render, matching the
            full libraries — an empty Community is the one place a quick switch
            can suggest that publishing exists. Local stays conditional; an empty
            one tells you nothing you did not know.

            EACH SHELF SCROLLS ITSELF — there is no scroller around the group, so
            a wheel over Local moves Local. That is what sets the caps: five rows,
            three and two, which is what the 28rem ceiling has left once three
            headers, two rules and the footer are paid for. Bigger caps and a
            full popover would spill past its own rounded corner. The shelves
            stay shrinkable for the viewport too short even for that. */}
        <div className="flex min-h-0 flex-col">
          <div className="shrink-0 px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
            {t.rail.builtin}
            <ShelfCount n={builtins.length} />
          </div>
          <ScrollArea bars className="max-h-[8.75rem]">{builtins.map(row)}</ScrollArea>
        </div>
        <div
          className="mt-1 flex min-h-0 flex-col border-t border-white/10 pt-1"
        >
          <div className="shrink-0 px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground">
            {t.rail.community}
            <ShelfCount n={community.length} />
          </div>
          {community.length ? (
            <ScrollArea bars className="max-h-[5.25rem]">{community.map(row)}</ScrollArea>
          ) : (
            <div className="px-2 pb-1 text-xs text-muted-foreground">{t.rail.communityEmpty}</div>
          )}
        </div>
        {local.length > 0 && (
          <div className="mt-1 flex min-h-0 flex-col border-t border-white/10 pt-1">
            <div className="shrink-0 px-2 pt-0.5 pb-1 text-xs font-medium text-muted-foreground">
              {t.rail.local}
              <ShelfCount n={local.length} />
            </div>
            <ScrollArea bars className="max-h-[3.5rem]">{local.map(row)}</ScrollArea>
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
