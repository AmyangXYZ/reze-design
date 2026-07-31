"use client"

// Editor chrome pieces. RailLogo is the app-level home/menu button at the TOP of the left

import { useState } from "react"
import { PanelLeft, PanelLeftClose, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AccountButton } from "@/components/editor/account-panel"
import { SceneFileActions } from "@/components/editor/scene-file-menu"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const floating = "rounded-lg border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-xs"

// Label and input share one box, so entering rename cannot shift the text or change
// the row's height — the same approach SliderRow uses for its typed values. The border
// is present in both states and merely transparent on the label, or the text would
// jump by a pixel the moment it becomes editable.
const NAME_BOX = "min-w-0 rounded border px-1 text-xs leading-4"

// Shown beside the wordmark. A version is the same in every language, so it lives
// here rather than in the dictionary — keep it in step with package.json and the
// git tag.
const VERSION = "0.3.0 beta"

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
  onExportScene,
  onImportScene,
  onResetScene,
  asHeader = false,
}: {
  sceneName: string
  onRenameScene: (name: string) => void
  docksOpen: boolean
  onToggleDocks: () => void
  onExportScene: () => void
  onImportScene: (file: File) => void
  onResetScene: () => void
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
      // field-sizing keeps the box hugging the text instead of stretching to fill the
      // row, which is what pushed the menu chevron out to the far edge on every rename.
      className={cn(NAME_BOX, "max-w-full [field-sizing:content] border-blue-400/50 bg-white/5 text-foreground outline-none")}
    />
  ) : (
    <span
      onDoubleClick={() => setEditing(true)}
      title={t.brand.renameScene}
      className={cn(NAME_BOX, "cursor-text truncate border-transparent text-muted-foreground")}
    >
      {sceneName}
    </span>
  )
  const sceneActions = <SceneFileActions onExport={onExportScene} onImport={onImportScene} onReset={onResetScene} />

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
      {VERSION}
    </span>
  )

  // Expanded header: title over scene name (two lines). Collapsed pill: one line.
  if (asHeader) {
    return (
      <div className="flex w-full flex-col pt-3.5 pr-1.5 pb-2.5 pl-4 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
          {tag}
          {toggle}
        </div>
        <div className="-ml-[5px] flex min-w-0 items-center gap-1">
          {nameEl}
          {sceneActions}
        </div>
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
  onOpenLibrary?: (kind: "grade" | "effect" | "graph" | "scene") => void
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
