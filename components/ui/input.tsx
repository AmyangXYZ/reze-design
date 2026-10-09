import * as React from "react"

import { cn } from "@/lib/utils"

// `bare`: for inline fields whose own classes are the whole look — a rename in
// a row, a timeline value, a search line in a menu. It keeps what a field owes
// (text selection, placeholder colour, the disabled state) and adds no height,
// border, padding or background for the call site to fight — the same bargain
// as Button's `bare`.
const BARE =
  "select-text outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"

function Input({ className, type, variant, ...props }: React.ComponentProps<"input"> & { variant?: "bare" }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={
        variant === "bare"
          ? cn(BARE, className)
          : cn(
              "h-9 w-full min-w-0 select-text rounded-chip border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
              className
            )
      }
      {...props}
    />
  )
}

export { Input }
