"use client"

// Native scroll container with the scrollbar hidden

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
