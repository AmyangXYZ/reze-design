"use client"

// Assets panel (chromeless): the raw ingredients a user drops in to compose a scene.
// Ordered as a scene builds: character (model + its motion), then the world (stage +
// camera), then audio. reze-design is a finishing tool — you bring finished motion and
// a pre-cut track. Each asset is a full-width upload button with its current filename
// truncated on the line below (so a long name never widens the dock). Stage loads as a
// second model; camera loads a driving VMD (toggled Follow/Free from the transport).

import type { ComponentType } from "react"
import { Box, Footprints, Music, PersonStanding, Video, X } from "lucide-react"
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
  soon,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value?: string | null
  placeholder?: string
  /** High-level metadata line (size / duration / count) shown under the filename. */
  meta?: string
  onClick?: () => void
  /** When set and a value is present, shows a remove (✕) button at the line's right edge. */
  onRemove?: () => void
  /** Not wired yet — disable the button and show a "coming" note instead of a filename. */
  soon?: boolean
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={soon}
        className="h-7 w-full gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground disabled:opacity-40"
        onClick={onClick}
      >
        <Icon className="size-4" />
        {label}
      </Button>
      {soon ? (
        <div className="mt-1.5 text-xs text-muted-foreground/50">Available with the next engine update</div>
      ) : (
        <>
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
      )}
    </>
  )
}

export function AssetsPanel({
  modelFile,
  animName,
  stageName,
  cameraName,
  audioName,
  modelMeta,
  animMeta,
  stageMeta,
  cameraMeta,
  audioMeta,
  onUploadModel,
  onUploadAnimation,
  onUploadStage,
  onUploadCamera,
  onUploadMusic,
  onRemoveAnimation,
  onRemoveStage,
  onRemoveCamera,
}: {
  /** The loaded model's actual .pmx filename (not the internal id). */
  modelFile: string
  animName: string | null
  stageName: string | null
  cameraName: string | null
  audioName: string | null
  modelMeta: string
  animMeta: string
  stageMeta: string
  cameraMeta: string
  audioMeta: string
  onUploadModel: () => void
  onUploadAnimation: () => void
  onUploadStage: () => void
  onUploadCamera: () => void
  onUploadMusic: () => void
  onRemoveAnimation: () => void
  onRemoveStage: () => void
  onRemoveCamera: () => void
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title="Model">
          <AssetRow
            icon={PersonStanding}
            label="Upload PMX model"
            value={modelFile}
            placeholder="No model"
            meta={modelMeta}
            onClick={onUploadModel}
          />
        </Section>

        <Section title="Animation">
          <AssetRow
            icon={Footprints}
            label="Upload VMD animation"
            value={animName}
            placeholder="No motion"
            meta={animMeta}
            onClick={onUploadAnimation}
            onRemove={onRemoveAnimation}
          />
        </Section>

        <Section title="Stage">
          <AssetRow
            icon={Box}
            label="Upload stage model"
            value={stageName}
            placeholder="No stage"
            meta={stageMeta}
            onClick={onUploadStage}
            onRemove={onRemoveStage}
          />
        </Section>

        <Section title="Camera">
          <AssetRow
            icon={Video}
            label="Upload camera motion"
            value={cameraName}
            placeholder="No camera"
            meta={cameraMeta}
            onClick={onUploadCamera}
            onRemove={onRemoveCamera}
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
