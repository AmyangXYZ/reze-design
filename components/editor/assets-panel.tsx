"use client"

// Assets panel (chromeless): the raw ingredients a user drops in to compose a
// scene — model (PMX folder), animation (VMD), and music. reze-design is a
// finishing tool, not an animation editor: you bring a finished motion and a
// pre-cut track. Each asset is a full-width upload button with its current
// filename truncated on the line below (so a long name never widens the dock).

import type { ComponentType } from "react"
import { Clapperboard, FolderUp, Music, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/scene/scene-sidebar"

function AssetRow({
  icon: Icon,
  label,
  value,
  placeholder,
  meta,
  onClick,
  onRemove,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string | null
  placeholder: string
  /** High-level metadata line (size / duration / count) shown under the filename. */
  meta?: string
  onClick: () => void
  /** When set and a value is present, shows a remove (✕) button at the line's right edge. */
  onRemove?: () => void
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground"
        onClick={onClick}
      >
        <Icon className="size-4" />
        {label}
      </Button>
      {/* Own line: filename (truncated — clips with … instead of widening the dock) + optional remove. */}
      <div className="mt-1.5 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={value ?? undefined}>
          {value ?? placeholder}
        </span>
        {onRemove && value && (
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 size-5 shrink-0 text-muted-foreground hover:text-red-400"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {value && meta && <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{meta}</div>}
    </>
  )
}

export function AssetsPanel({
  modelFile,
  animName,
  audioName,
  modelMeta,
  animMeta,
  audioMeta,
  onUploadModel,
  onUploadAnimation,
  onUploadMusic,
  onRemoveAnimation,
}: {
  /** The loaded model's actual .pmx filename (not the internal id). */
  modelFile: string
  animName: string | null
  audioName: string | null
  modelMeta: string
  animMeta: string
  audioMeta: string
  onUploadModel: () => void
  onUploadAnimation: () => void
  onUploadMusic: () => void
  onRemoveAnimation: () => void
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title="Model">
          <AssetRow
            icon={FolderUp}
            label="Upload PMX model"
            value={modelFile}
            placeholder="No model"
            meta={modelMeta}
            onClick={onUploadModel}
          />
        </Section>

        <Section title="Animation">
          <AssetRow
            icon={Clapperboard}
            label="Upload VMD animation"
            value={animName}
            placeholder="No motion"
            meta={animMeta}
            onClick={onUploadAnimation}
            onRemove={onRemoveAnimation}
          />
        </Section>

        <Section title="Music">
          <AssetRow
            icon={Music}
            label="Upload audio track"
            value={audioName}
            placeholder="No audio"
            meta={audioMeta}
            onClick={onUploadMusic}
          />
        </Section>
      </div>
    </ScrollArea>
  )
}
