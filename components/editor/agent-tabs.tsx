"use client"

// The AI panel's conversations, as tabs: each is its own history, the first
// request names it, × deletes it, + starts another. A run belongs to the tab
// it started in, so while one is going the others hold still.

import { useEffect, useRef } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ConversationTab } from "@/lib/ai/conversation-store"

export type AgentTabsText = { newChat: string; closeTab: string }

/** The editor's own tabs (components/ui/tabs), one chip per conversation, its
 *  × inside the chip beside the trigger — a button cannot hold a button. */
export function AgentTabs({
  tabs,
  activeId,
  runningId,
  onSelect,
  onClose,
  onNew,
  text,
}: {
  tabs: ConversationTab[]
  activeId: string | null
  /** The tab whose request is running: it shows so, and stays until done. */
  runningId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  text: AgentTabsText
}) {
  const strip = useRef<HTMLDivElement>(null)

  // As an editor's tabs behave: no scrollbar, the wheel scrolls the row
  // sideways, and the open tab is always brought into view.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])
  useEffect(() => {
    strip.current?.querySelector('[data-state="active"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeId, tabs.length])

  return (
    <div className="flex shrink-0 items-center gap-1.5 py-1.5 pr-4 pl-2.5">
      <Tabs value={activeId ?? undefined} onValueChange={onSelect} className="min-w-0 flex-1">
        {/* As a browser's tabs: they share the row, shrinking toward a floor
            before the row starts to scroll. */}
        <TabsList ref={strip} className="no-scrollbar h-auto w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none bg-transparent p-0">
          {tabs.map((t) => {
            const open = t.id === activeId
            const working = t.id === runningId
            return (
              // Each tab its own chip: the editor's tab shades, without the
              // shared track behind them.
              <span
                key={t.id}
                className={cn(
                  "group relative flex max-w-36 min-w-16 flex-1 basis-0 items-center rounded-chip",
                  // The left dock's tab shades: the open one lifted, the rest a quiet chip.
                  open ? "bg-white/[0.14] text-foreground" : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground",
                )}
              >
                <TabsTrigger value={t.id} className="w-full min-w-0 justify-start pr-5 data-[state=active]:bg-transparent">
                  <span className="truncate">{t.title || text.newChat}</span>
                </TabsTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={text.closeTab}
                  onClick={() => onClose(t.id)}
                  disabled={working}
                  className={cn(
                    "absolute right-0.5 size-4 rounded-chip text-muted-foreground hover:bg-white/10 hover:text-foreground",
                    open ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <X className="size-3" />
                </Button>
              </span>
            )
          })}
        </TabsList>
      </Tabs>
      <Button
        variant="ghost"
        size="icon"
        aria-label={text.newChat}
        tooltip={text.newChat}
        onClick={onNew}
        className="size-5 shrink-0 rounded-chip text-muted-foreground hover:bg-white/10 hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  )
}
