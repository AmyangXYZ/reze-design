"use client"

// Native scroll container. Scrollbar hidden by default; `bars` shows a slim one.

import * as React from "react"

import { cn } from "@/lib/utils"

function ScrollArea({ className, children, bars, ...props }: React.ComponentProps<"div"> & { bars?: boolean }) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(bars ? "thin-scrollbar" : "no-scrollbar", "relative overflow-x-hidden overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }
