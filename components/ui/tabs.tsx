"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { useCover } from "@/components/ui/cover"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  // On the cover a tabbed pane keeps its tab line in place and scrolls only
  // what is under it (TabsContent), so the column has to be allowed to shrink.
  const cover = useCover()
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", cover && "min-h-0", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  // On the cover a tab bar is a line of words: no well, the chosen one
  // underlined (TabsTrigger), set from the left like the type around it. Every
  // tab shows whole; more than fit wrap onto the next line.
  const cover = useCover()
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-cover={cover || undefined}
      className={cn(
        "group/tabs inline-flex w-fit items-center",
        // The tab bar heads its pane there, so it sits on the pane's hairline.
        cover
          ? "h-auto flex-wrap justify-start gap-x-4 gap-y-1.5 border-b border-line pb-2"
          : "h-6 justify-center rounded-interior bg-white/[0.06] p-0.5",
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-5 items-center justify-center rounded-chip px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        "group-data-[cover]/tabs:relative group-data-[cover]/tabs:flex-none group-data-[cover]/tabs:px-0 group-data-[cover]/tabs:hover:text-foreground",
        "group-data-[cover]/tabs:after:absolute group-data-[cover]/tabs:after:inset-x-2 group-data-[cover]/tabs:after:-bottom-0.5 group-data-[cover]/tabs:after:h-[1.5px] group-data-[cover]/tabs:after:rounded-full",
        // The chosen tab is stroked heavier rather than set in a heavier weight,
        // so its word keeps its spacing (the index does the same).
        "group-data-[cover]/tabs:data-[state=active]:[-webkit-text-stroke:0.35px_currentColor] group-data-[cover]/tabs:data-[state=active]:text-foreground group-data-[cover]/tabs:data-[state=active]:after:bg-blue-400",
        "group-not-data-[cover]/tabs:data-[state=active]:bg-white/10 data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  const cover = useCover()
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", cover && "no-scrollbar cover-enter min-h-0 overflow-y-auto", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
