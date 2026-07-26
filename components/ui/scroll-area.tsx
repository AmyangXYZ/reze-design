"use client"

// Native scroll container with the scrollbar hidden — the app's panels scroll
// "bare" (wheel / trackpad / touch), exactly like the materials tree's
// no-scrollbar div. This replaced Radix's ScrollArea: its whole purpose is
// drawing a custom scrollbar, which this design deliberately doesn't show —
// and its viewport disables native scrolling unless its scrollbar is mounted,
// which made "hide the scrollbar" needlessly fragile.

import * as React from "react"

import { cn } from "@/lib/utils"

function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("no-scrollbar relative overflow-x-hidden overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
