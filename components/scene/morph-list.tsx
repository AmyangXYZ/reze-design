"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import type { AnimationClip } from "reze-engine"

interface MorphListProps {
  morphNames: string[]
  clip: AnimationClip | null
  selectedMorph: string | null
  onSelectMorph: (name: string) => void
}

export const MorphList = memo(function MorphList({ morphNames, clip, selectedMorph, onSelectMorph }: MorphListProps) {
  return (
    <div className="h-full touch-pan-y overscroll-contain no-scrollbar overflow-y-auto">
      <div className="py-1">
        {morphNames.length === 0 ? (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No morphs</div>
        ) : (
          morphNames.map((name) => {
            const kfCount = clip?.morphTracks.get(name)?.length ?? 0
            const isActive = selectedMorph === name
            return (
              <button
                key={name}
                type="button"
                onClick={() => onSelectMorph(name)}
                className={cn(
                  "flex w-full items-center py-0.5 pl-2 pr-1.5 text-left text-[10px] font-mono leading-snug transition-colors",
                  isActive
                    ? "bg-blue-400/[0.08] text-blue-400 hover:bg-blue-400/12"
                    : "text-muted-foreground hover:bg-white/[0.03]",
                  // Unkeyed morphs recede — a face carries dozens and a clip
                  // usually touches five. Same rule as the bone list.
                  !isActive && kfCount === 0 && "opacity-45",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {kfCount > 0 && (
                  <span className={cn("ml-auto shrink-0 pl-1 tabular-nums text-[9px]", isActive ? "text-blue-400" : "text-muted-foreground")}>
                    [{kfCount}]
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
})
