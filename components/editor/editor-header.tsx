"use client"

// The ONE header every floating editor wears — graph, WGSL, grade.

import type { ComponentType, ReactNode } from "react"
import { Grip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Shared button styling for anything in the actions slot, so callers can't invent their own */
export function EditorHeaderButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn("size-6", active ? "text-pink-300 hover:text-pink-200" : "text-zinc-400 hover:text-zinc-100")}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function EditorHeaderSeparator() {
  return <Separator orientation="vertical" className="mx-1 h-4 bg-white/10" />
}

export function EditorHeader({
  icon: Icon,
  iconClassName,
  title,
  /** Drag affordance is pointless (and misleading) when the panel fills the screen. */
  fullscreen = false,
  actions,
  onClose,
  closeLabel,
}: {
  icon: ComponentType<{ className?: string }>
  iconClassName?: string
  title: string
  fullscreen?: boolean
  /** Tool buttons — use EditorHeaderButton / EditorHeaderSeparator. */
  actions?: ReactNode
  onClose: () => void
  closeLabel: string
}) {
  return (
    <header
      data-drag-handle
      className={cn(
        "relative flex shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950 py-1 pr-2 pl-3",
        !fullscreen && "cursor-grab active:cursor-grabbing",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0 text-zinc-400", iconClassName)} />
      <span className="min-w-0 truncate text-xs font-medium text-zinc-200">{title}</span>
      {!fullscreen && (
        <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-zinc-600">
          <Grip className="size-4" />
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
        {actions ? <EditorHeaderSeparator /> : null}
        <EditorHeaderButton icon={X} label={closeLabel} onClick={onClose} />
      </div>
    </header>
  )
}
