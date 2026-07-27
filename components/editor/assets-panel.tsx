"use client"

// Assets panel (chromeless): the raw ingredients of a scene — the character (model +
// its motion), its camera, and music. reze-design is a finishing tool: you bring a
// finished motion and a pre-cut track. Each asset is a full-width upload button with
// its current filename truncated on the line below (so a long name never widens the
// dock). Environment/backgrounds live in the Scene tab, not here.

import { memo, type ComponentType } from "react"
import { Footprints, Globe, Image as ImageIcon, Music, PersonStanding, Video, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/scene/scene-sidebar"
import { useT } from "@/lib/i18n"

function AssetRow({
  icon: Icon,
  label,
  value,
  placeholder,
  meta,
  onClick,
  onRemove,
  secondaryLabel,
  onSecondaryClick,
  secondaryJoiner,
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
  /** Optional compact second action beside the main button (e.g. "ZIP"). */
  secondaryLabel?: string
  onSecondaryClick?: () => void
  /** Word between the two actions ("or") — clarifies they're alternatives. */
  secondaryJoiner?: string
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-0 flex-1 gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground"
          onClick={onClick}
        >
          <Icon className="size-4" />
          <span className="truncate">{label}</span>
        </Button>
        {secondaryLabel && onSecondaryClick && (
          <>
            {secondaryJoiner && <span className="shrink-0 text-[11px] text-muted-foreground/70">{secondaryJoiner}</span>}
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 border-white/10 bg-white/5 px-2.5 text-xs hover:bg-white/10 hover:text-foreground"
              onClick={onSecondaryClick}
            >
              {secondaryLabel}
            </Button>
          </>
        )}
      </div>
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

// Memoized: the dock keeps tabs mounted (useKeepAlive), so without memo the
// hidden Assets tab re-rendered on every page render — every settings-slider
// tick included. All handler props are useCallback'd in page.tsx; the meta
// strings are primitives, so recomputing them doesn't break the bailout.
export const AssetsPanel = memo(function AssetsPanel({
  modelFile,
  animName,
  cameraName,
  audioName,
  backdropName,
  skyboxName,
  modelMeta,
  animMeta,
  cameraMeta,
  audioMeta,
  backdropMeta,
  skyboxMeta,
  modelUploadLabel,
  onUploadModel,
  onUploadModelZip,
  onUploadAnimation,
  onUploadCamera,
  onUploadMusic,
  onUploadBackdrop,
  onUploadSkybox,
  onRemoveMusic,
  onRemoveAnimation,
  onRemoveCamera,
  onRemoveBackdrop,
  onRemoveSkybox,
}: {
  /** The loaded model's actual .pmx filename (not the internal id). */
  modelFile: string
  animName: string | null
  cameraName: string | null
  audioName: string | null
  /** Flat background image filename (DOM layer behind the scene). */
  backdropName: string | null
  /** 360° equirect skybox filename (engine-rendered, follows the camera). */
  skyboxName: string | null
  modelMeta: string
  animMeta: string
  cameraMeta: string
  audioMeta: string
  backdropMeta: string
  skyboxMeta: string
  /** Platform-specific label (desktop: folder wording; mobile: zip wording). */
  modelUploadLabel: string
  onUploadModel: () => void
  /** Desktop only: opens the .zip file dialog (folder dialogs can't pick zips). */
  onUploadModelZip?: () => void
  onUploadAnimation: () => void
  onUploadCamera: () => void
  onUploadMusic: () => void
  onUploadBackdrop: () => void
  onUploadSkybox: () => void
  onRemoveMusic: () => void
  onRemoveAnimation: () => void
  onRemoveCamera: () => void
  onRemoveBackdrop: () => void
  onRemoveSkybox: () => void
}) {
  const t = useT()
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title={t.assets.model}>
          <AssetRow
            icon={PersonStanding}
            label={modelUploadLabel}
            value={modelFile}
            placeholder={t.assets.noModel}
            meta={modelMeta}
            onClick={onUploadModel}
            secondaryLabel={onUploadModelZip ? "ZIP" : undefined}
            onSecondaryClick={onUploadModelZip}
            secondaryJoiner={t.assets.or}
          />
        </Section>

        <Section title={t.assets.animation}>
          <AssetRow
            icon={Footprints}
            label={t.assets.uploadAnimation}
            value={animName}
            placeholder={t.assets.noMotion}
            meta={animMeta}
            onClick={onUploadAnimation}
            onRemove={onRemoveAnimation}
          />
        </Section>

        <Section title={t.assets.camera}>
          <AssetRow
            icon={Video}
            label={t.assets.uploadCamera}
            value={cameraName}
            placeholder={t.assets.noCamera}
            meta={cameraMeta}
            onClick={onUploadCamera}
            onRemove={onRemoveCamera}
          />
        </Section>

        <Section title={t.assets.music}>
          <AssetRow
            icon={Music}
            label={t.assets.uploadMusic}
            value={audioName}
            placeholder={t.assets.noAudio}
            meta={audioMeta}
            onClick={onUploadMusic}
            onRemove={onRemoveMusic}
          />
        </Section>

        <Section title={t.assets.backdrop}>
          <AssetRow
            icon={ImageIcon}
            label={t.assets.uploadBackdrop}
            value={backdropName}
            placeholder={t.assets.noBackdrop}
            meta={backdropMeta}
            onClick={onUploadBackdrop}
            onRemove={onRemoveBackdrop}
          />
        </Section>

        <Section title={t.assets.skybox}>
          <AssetRow
            icon={Globe}
            label={t.assets.uploadSkybox}
            value={skyboxName}
            placeholder={t.assets.noSkybox}
            meta={skyboxMeta}
            onClick={onUploadSkybox}
            onRemove={onRemoveSkybox}
          />
        </Section>
      </div>
    </ScrollArea>
  )
})
