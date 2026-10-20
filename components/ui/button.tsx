"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { useCover } from "@/components/ui/cover"

// The one control a raw <button> is never needed instead of. `bare` is for rows,
// tiles, swatches and chips whose own classes are the whole look: it keeps what
// a button owes (keyboard focus ring, disabled state, the pointer blur below)
// and adds no size, padding, gap, radius or colour for the call site to fight.
// Those fights are why the editor once grew ~90 plain <button>s.
const BARE =
  "outline-none transition-[color,background-color,border-color,box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-foreground disabled:pointer-events-none disabled:opacity-50"

// On the cover a button is type like the words around it. A ghost's hover is a
// change of ink alone, set after the call site's classes so a tint written for
// the boxed chrome cannot reach the canvas; keyboard focus is a thin outline in
// the ink in place of the ring, for every variant there.
const COVER_GHOST = "hover:bg-transparent dark:hover:bg-transparent"
const COVER_FOCUS =
  "focus-visible:ring-0 focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-chip text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        /** See BARE. Takes no size either. */
        bare: "",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        // Timeline scale. The dopesheet's own controls sit in a 17px ruler and
        // a 34px lane strip, where an icon-sm is taller than the row it labels;
        // these two shrink the glyph with the box so the pair still reads as
        // one control rather than a small button around a normal icon.
        xs: "h-6 gap-1 rounded-chip px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 rounded-chip gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-chip px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-chip [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  onClick,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  const cover = useCover()
  const look =
    variant === "bare"
      ? cn(BARE, className)
      : cover && variant === "ghost"
        ? cn(buttonVariants({ variant: "bare", size }), "hover:text-foreground", className, COVER_GHOST)
        : cn(buttonVariants({ variant, size, className }))

  return (
    <Comp
      data-slot="button"
      className={cover ? cn(look, COVER_FOCUS) : look}
      onClick={(e) => {
        // A mouse click leaves the button focused, so a later Space/Enter (meant for play/pause
        if (e.detail > 0) (e.currentTarget as HTMLElement).blur()
        onClick?.(e)
      }}
      {...props}
    />
  )
}

export { Button, buttonVariants }
