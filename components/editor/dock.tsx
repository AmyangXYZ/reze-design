"use client"

// The two editor docks, Figma-style.

import { useCallback, useState, type ComponentType, type ReactNode } from "react"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GithubMark } from "@/components/icons"
import { LanguageSwitcher } from "@/components/editor/language-switcher"
import { cn } from "@/lib/utils"

export type DockTab = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  content: ReactNode
}

const shell = "flex h-full min-h-0 w-full overflow-hidden shadow-float bg-zinc-950/70 backdrop-blur-xs"

// KEEP-ALIVE. A tab's content mounts the first time it's opened and then STAYS mounted
function useKeepAlive(active: string) {
  const [seen, setSeen] = useState<string[]>([active])
  const remember = useCallback((id: string) => setSeen((s) => (s.includes(id) ? s : [...s, id])), [])
  // `id === active` also covers the parent switching tabs without going through the rail
  const isMounted = (id: string) => id === active || seen.includes(id)
  return { isMounted, remember }
}

/** One mounted tab. Not `hidden` + `flex` together */
function TabPane({ show, children }: { show: boolean; children: ReactNode }) {
  return <div className={show ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>{children}</div>
}

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
  const { isMounted, remember } = useKeepAlive(current.id)
  return (
    <aside className={cn(shell, "border-r border-white/10")}>
      {/* Vertical rail — logo · divider · icon+label tabs (room to grow). */}
      <nav className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-white/10 py-1.5">
        {railTop}
        {railTop && <Separator className="w-7 bg-white/10" />}
        {tabs.map((t) => {
          const Icon = t.icon
          const on = t.id === current.id
          return (
            <button
              key={t.id}
              onClick={() => {
                remember(t.id)
                onActive(t.id)
              }}
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
        {/* Utilities pinned to the bottom of the rail: language above GitHub. */}
        <div className="mt-auto mb-1 flex flex-col items-center gap-2">
          <LanguageSwitcher />
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://github.com/AmyangXYZ/reze-design"
                target="_blank"
                rel="noreferrer"
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
              >
                <GithubMark className="size-[20px]" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="right">github.com/AmyangXYZ/reze-design</TooltipContent>
          </Tooltip>
        </div>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <Separator className="bg-white/10" />
        {tabs.map(
          (t) =>
            isMounted(t.id) && (
              <TabPane key={t.id} show={t.id === current.id}>
                {t.content}
              </TabPane>
            ),
        )}
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
  const { isMounted, remember } = useKeepAlive(current.id)
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
              onClick={() => {
                remember(t.id)
                onActive(t.id)
              }}
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
      {tabs.map(
        (t) =>
          isMounted(t.id) && (
            <TabPane key={t.id} show={t.id === current.id}>
              {t.content}
            </TabPane>
          ),
      )}
    </aside>
  )
}
