"use client"

// The phone's menu mark: three bars, which close together into one while the
// menu is open — the top and the foot sliding onto the middle — and spread
// again when it closes. Not a cross: the menu carries its own close. Bars
// rather than glyphs, so the two marks are one drawing moving.

import { cn } from "@/lib/utils"

const BAR = "absolute inset-x-0 h-[1.5px] rounded-full bg-current transition-[translate] duration-233 ease-[cubic-bezier(0.32,0.72,0,1)]"

export function MenuMark({ open, className }: { open: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative block size-4", className)}>
      <span className={cn(BAR, "top-[3px]", open && "translate-y-[4.25px]")} />
      <span className={cn(BAR, "top-[7.25px]")} />
      <span className={cn(BAR, "top-[11.5px]", open && "-translate-y-[4.25px]")} />
    </span>
  )
}
