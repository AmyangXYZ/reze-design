"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCover } from "@/components/ui/cover"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  // On the cover a switch is drawn, not filled: a hairline pill with a dot in
  // it, at rest on the left in the muted ink, on the right in the full ink
  // when on, the pill's line darkening with it.
  const cover = useCover()
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[color,background-color,border-color,box-shadow,opacity] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        cover &&
          "border-line-strong bg-transparent shadow-none data-[state=checked]:border-foreground data-[state=checked]:bg-transparent data-[state=unchecked]:bg-transparent dark:data-[state=unchecked]:bg-transparent focus-visible:ring-0 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground",
          // Inside the hairline: 2px clear of it at either end.
          cover &&
            "ml-0.5 transition-[translate,background-color] group-data-[size=default]/switch:size-2.5 group-data-[size=sm]/switch:size-2 data-[state=unchecked]:bg-muted-foreground dark:data-[state=unchecked]:bg-muted-foreground data-[state=checked]:bg-foreground dark:data-[state=checked]:bg-foreground group-data-[size=default]/switch:data-[state=checked]:translate-x-4 group-data-[size=sm]/switch:data-[state=checked]:translate-x-2.5",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
