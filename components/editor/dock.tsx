"use client"

// The two editor docks, Figma-style. Both are full-height, flush to the screen
// edge, square-cornered (rounded pills are only the COLLAPSED state, rendered by
// the page). Each dock's header is the always-on pill itself (brand pill left,
// account/play/share cluster right), so the pill reads as part of the sidebar.
// LEFT uses a vertical icon+label rail (room to grow); RIGHT uses two text tabs
// (Figma's Design/Prototype idiom). Panels render their own scroll content.

import type { ComponentType, ReactNode } from "react"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GithubMark } from "@/components/icons"
import { cn } from "@/lib/utils"

export type DockTab = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  content: ReactNode
}

const shell = "flex h-full min-h-0 w-full overflow-hidden shadow-float bg-zinc-950/70 backdrop-blur-md"

export function LeftDock({
  railTop,
  header,
  tabs,
  active,
  onActive,
}: {
  /** App-level logo/home button at the very top of the rail (Figma's logo slot). */
  railTop?: ReactNode
  header: ReactNode
  tabs: DockTab[]
  active: string
  onActive: (id: string) => void
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  return (
    <aside className={cn(shell, "border-r border-white/10")}>
      {/* Vertical rail — logo · divider · icon+label tabs (room to grow). Figma
          style: the active highlight boxes only the ICON; the label sits plain
          below it. */}
      <nav className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-white/10 py-1.5">
        {railTop}
        {railTop && <Separator className="w-7 bg-white/10" />}
        {tabs.map((t) => {
          const Icon = t.icon
          const on = t.id === current.id
          return (
            <button
              key={t.id}
              onClick={() => onActive(t.id)}
              className="flex w-full flex-col items-center gap-1.5 py-0.5"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-md transition-colors",
                  on ? "bg-blue-400/15 text-blue-400" : " hover:bg-white/[0.05]",
                )}
              >
                <Icon className="size-4.5" />
              </span>
              <span className={cn("text-[9px] leading-none font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                {t.label}
              </span>
            </button>
          )
        })}
        {/* GitHub pinned to the bottom of the rail. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href="https://github.com/AmyangXYZ/reze-design"
              target="_blank"
              rel="noreferrer"
              className="mt-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground mb-1"
            >
              <GithubMark className="size-[20px]" />
            </a>
          </TooltipTrigger>
          <TooltipContent side="right">github.com/AmyangXYZ/reze-design</TooltipContent>
        </Tooltip>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <Separator className="bg-white/10" />
        {current.content}
      </div>
    </aside>
  )
}

export function RightDock({
  header,
  tabs,
  active,
  onActive,
}: {
  header: ReactNode
  tabs: DockTab[]
  active: string
  onActive: (id: string) => void
}) {
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  return (
    <aside className={cn(shell, "flex-col border-l border-white/10")}>
      {header}
      <Separator className="bg-white/10" />
      <div className="flex items-center gap-1 p-1">
        {tabs.map((t) => {
          const on = t.id === current.id
          return (
            <button
              key={t.id}
              onClick={() => onActive(t.id)}
              className={cn(
                "flex-1 cursor-pointer rounded-lg px-2 py-1 text-xs font-medium transition-colors",
                on ? "bg-white/[0.08]" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <Separator className="bg-white/10" />
      {current.content}
    </aside>
  )
}
