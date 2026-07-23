"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuSub = ContextMenuPrimitive.Sub

const menuSurface =
  "z-50 min-w-36 overflow-hidden rounded-lg border border-white/10 bg-zinc-950/90 p-1 text-xs shadow-float backdrop-blur-md " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

const itemBase =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-foreground outline-none select-none " +
  "focus:bg-white/[0.06] data-[state=open]:bg-white/[0.06] data-[disabled]:pointer-events-none data-[disabled]:opacity-40"

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content data-slot="context-menu-content" className={cn(menuSurface, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: "default" | "danger" }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(itemBase, variant === "danger" && "text-red-400 focus:bg-red-400/10 focus:text-red-400", className)}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger data-slot="context-menu-sub-trigger" className={cn(itemBase, "justify-between", className)} {...props}>
      {children}
      <ChevronRight className="size-3.5 text-muted-foreground" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        className={cn(menuSurface, "max-h-64 overflow-y-auto", className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn("my-1 h-px bg-white/10", className)} {...props} />
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
}
