"use client"

// Which kind of track the editor is on.
//
// A column of icons at the editor's left edge, each the icon the left dock
// gives that kind, so the rail and the dock name things alike. A column rather
// than a header row: the editor's height is fixed and every band in it was laid
// out against that number, while its width has room to spare.

import { Camera, Footprints, Shapes, Smile, Sparkles, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ClipEditKind } from "@/context/clip-editor"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function EditorRail({ kind, onKind }: { kind: ClipEditKind; onKind: (kind: ClipEditKind) => void }) {
  const t = useT()
  const items: { kind: ClipEditKind; icon: LucideIcon; label: string }[] = [
    { kind: "motion", icon: Footprints, label: t.lab.lanes.motion },
    { kind: "morph", icon: Smile, label: t.lab.lanes.morph },
    { kind: "camera", icon: Camera, label: t.lab.lanes.camera },
    { kind: "effect", icon: Sparkles, label: t.lab.rows.effect },
    { kind: "object", icon: Shapes, label: t.lab.rows.object },
  ]
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-line-strong py-1.5">
      {items.map((item) => {
        const active = item.kind === kind
        return (
          <Tooltip key={item.kind}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={item.label}
                aria-pressed={active}
                onClick={() => onKind(item.kind)}
                className={cn(
                  "transition-none",
                  active
                    ? "bg-blue-400/[0.08] text-blue-400 hover:bg-blue-400/12 hover:text-blue-400 dark:hover:bg-blue-400/12"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
