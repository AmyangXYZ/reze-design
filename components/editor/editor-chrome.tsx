"use client"

// Editor chrome pieces. RailLogo is the app-level home/menu button at the TOP of the left

import { useState } from "react"
import { PanelLeft, PanelLeftClose, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AccountButton } from "@/components/editor/account-panel"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const floating = "rounded-lg border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-xs"

/** Top of the left rail — the logo/home button for app-level operations. */
export function RailLogo() {
  return (
    <span className="mt-1.5 flex size-9 items-center justify-center text-pink-400" aria-hidden>
      <WandSparkles className="size-4.5" />
    </span>
  )
}

export function BrandPill({
  sceneName,
  onRenameScene,
  docksOpen,
  onToggleDocks,
  asHeader = false,
}: {
  sceneName: string
  onRenameScene: (name: string) => void
  docksOpen: boolean
  onToggleDocks: () => void
  /** Render flat & full-width as a dock header (expanded, logo lives in the rail), vs a floating */
  asHeader?: boolean
}) {
  const t = useT()
  // Double-click to rename, the same gesture as renaming a style group or a node.
  const [editing, setEditing] = useState(false)
  const commit = (value: string) => {
    const next = value.trim()
    if (next && next !== sceneName) onRenameScene(next.slice(0, 60))
    setEditing(false)
  }
  const nameEl = editing ? (
    <input
      autoFocus
      defaultValue={sceneName}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value)
        // Escape abandons the edit rather than committing a half-typed name.
        else if (e.key === "Escape") setEditing(false)
      }}
      maxLength={60}
      className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-1 text-xs outline-none"
    />
  ) : (
    <span
      onDoubleClick={() => setEditing(true)}
      title={t.brand.renameScene}
      className="min-w-0 flex-1 cursor-text truncate text-xs text-muted-foreground"
    >
      {sceneName}
    </span>
  )
  const toggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground", asHeader ? "ml-auto" : "ml-1")}
          onClick={onToggleDocks}
        >
          {docksOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{docksOpen ? t.brand.hidePanels : t.brand.showPanels}</TooltipContent>
    </Tooltip>
  )

  // A small tag by the title so visitors know it's a live work-in-progress.
  const tag = (
    <span className="shrink-0 rounded-full bg-blue-400/15 px-1.5 py-px text-[10px] leading-none font-medium tracking-wide text-blue-400 max-sm:hidden">
      {t.brand.preRelease}
    </span>
  )

  // Expanded header: title over scene name (two lines). Collapsed pill: one line.
  if (asHeader) {
    return (
      <div className="flex w-full items-center gap-2 py-2.5 pt-5.5 pr-1.5 pl-4">
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
            {tag}
          </div>
          {nameEl}
        </div>
        {toggle}
      </div>
    )
  }
  return (
    <div className={cn("flex items-center gap-1.5", floating, "py-1.5 pr-1.5 pl-2")}>
      <span className="flex size-7 items-center justify-center text-pink-400" aria-hidden>
        <WandSparkles className="size-4.5" />
      </span>
      <span className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
      <span className="ml-1 max-w-32">{nameEl}</span>
      {toggle}
    </div>
  )
}

export function TopRightCluster({
  onShare,
  onOpenLibrary,
  asHeader = false,
}: {
  /** Opens the page-level publish-scene dialog. */
  onShare: () => void
  /** Account-tab stat numbers open the matching library on "Yours". */
  onOpenLibrary?: (kind: "grade" | "effect" | "graph") => void
  asHeader?: boolean
}) {
  const t = useT()
  const accountBtn = <AccountButton asHeader={asHeader} onOpenLibrary={onOpenLibrary} />

  const shareBtn = (
    <Button
      size="sm"
      onClick={onShare}
      className="h-7 rounded-md bg-blue-400 px-3 text-xs font-medium text-white hover:bg-blue-300"
    >
      {t.share.label}
    </Button>
  )

  // Figma order: portfolio (avatar) on the left, Share pushed to the right.
  if (asHeader) {
    return (
      <div className="flex w-full items-center gap-1 pt-3 pr-2 pb-2 pl-2">
        {accountBtn}
        <span className="ml-auto">{shareBtn}</span>
      </div>
    )
  }
  // Collapsed: a single pill holding account + Share together (Figma parity).
  return (
    <div className={cn("flex items-center gap-1.5 py-1.5 pr-1.5 pl-1.5", floating)}>
      {accountBtn}
      {shareBtn}
    </div>
  )
}
