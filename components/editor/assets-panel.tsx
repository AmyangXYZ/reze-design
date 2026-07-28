"use client"

// Assets panel (chromeless): the raw ingredients of a scene

import { memo, type ComponentType } from "react"
import { Footprints, Globe, Image as ImageIcon, Music, PersonStanding, Plus, Video, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/scene/scene-sidebar"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type CharacterCardData = {
  id: string
  file: string
  active: boolean
  animName: string | null
}

/** The main upload button + optional "or ZIP" secondary — one slot's action row. */
function UploadPair({
  icon: Icon,
  label,
  onClick,
  onZip,
  joiner,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  onZip?: () => void
  joiner?: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        className="h-7 min-w-0 flex-1 gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground disabled:opacity-40"
        onClick={onClick}
      >
        <Icon className="size-4" />
        <span className="truncate">{label}</span>
      </Button>
      {onZip && (
        <>
          {joiner && <span className="shrink-0 text-[11px] text-muted-foreground/70">{joiner}</span>}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-7 shrink-0 border-white/10 bg-white/5 px-2.5 text-xs hover:bg-white/10 hover:text-foreground disabled:opacity-40"
            onClick={onZip}
          >
            ZIP
          </Button>
        </>
      )}
    </div>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-mr-1 size-5 shrink-0 text-muted-foreground hover:text-red-400"
      onClick={onClick}
    >
      <X className="size-3.5" />
    </Button>
  )
}

function AssetRow({
  icon: Icon,
  label,
  value,
  onClick,
  onRemove,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value?: string | null
  onClick?: () => void
  /** When set and a value is present, shows a remove (✕) button at the line's right edge. */
  onRemove?: () => void
  /** Inert row (an empty model slot's animation placeholder). */
  disabled?: boolean
}) {
  return (
    <>
      <UploadPair icon={Icon} label={label} onClick={onClick} disabled={disabled} />
      {/* Own line: filename (truncated */}
      <div className="mt-1.5 flex items-center gap-1">
        <span className={cn("min-w-0 flex-1 truncate text-xs", value ? "text-muted-foreground" : "text-muted-foreground/40")} title={value ?? undefined}>
          {value ?? "—"}
        </span>
        {onRemove && value && <RemoveButton onClick={onRemove} />}
      </div>
    </>
  )
}

// Memoized: the dock keeps tabs mounted (useKeepAlive), so without memo the hidden Assets tab
export const AssetsPanel = memo(function AssetsPanel({
  characters,
  pendingSlot,
  cameraName,
  audioName,
  backdropName,
  skyboxName,
  modelUploadLabel,
  addModelLabel,
  onSelectModel,
  onReplaceSlot,
  onReplaceSlotZip,
  onAddSlot,
  onFillPending,
  onFillPendingZip,
  onCancelPending,
  onRemoveModel,
  onUploadAnimation,
  onRemoveAnimation,
  onUploadCamera,
  onUploadMusic,
  onUploadBackdrop,
  onUploadSkybox,
  onRemoveMusic,
  onRemoveCamera,
  onRemoveBackdrop,
  onRemoveSkybox,
}: {
  characters: CharacterCardData[]
  /** An empty slot is open (revealed by "+ Add model", filled by its uploads). */
  pendingSlot: boolean
  cameraName: string | null
  audioName: string | null
  /** Flat background image filename (DOM layer behind the scene). */
  backdropName: string | null
  /** 360° equirect skybox filename (engine-rendered, follows the camera). */
  skyboxName: string | null
  /** Platform-specific label (desktop: folder wording; mobile: zip wording). */
  modelUploadLabel: string
  addModelLabel: string
  onSelectModel: (id: string) => void
  /** This slot's upload: replace ITS model (keeps slot position + transform + clip). */
  onReplaceSlot: (id: string) => void
  /** Desktop only: replace via .zip (folder dialogs can't pick zips). */
  onReplaceSlotZip?: (id: string) => void
  /** Reveal the empty slot (no dialog yet — its own buttons open one). */
  onAddSlot: () => void
  onFillPending: () => void
  onFillPendingZip?: () => void
  onCancelPending: () => void
  /** Slots 2+ only — slot 1 is permanent. */
  onRemoveModel: (id: string) => void
  /** Per-model: upload a VMD motion for this model. */
  onUploadAnimation: (id: string) => void
  onRemoveAnimation: (id: string) => void
  onUploadCamera: () => void
  onUploadMusic: () => void
  onUploadBackdrop: () => void
  onUploadSkybox: () => void
  onRemoveMusic: () => void
  onRemoveCamera: () => void
  onRemoveBackdrop: () => void
  onRemoveSkybox: () => void
}) {
  const t = useT()
  const multi = characters.length > 1 || pendingSlot
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-4 py-3.5">
        <Section title={t.assets.model}>
          {characters.map((c, i) => (
            <div key={c.id} className={i > 0 ? "mt-3" : undefined}>
              <UploadPair
                icon={PersonStanding}
                label={modelUploadLabel}
                onClick={() => onReplaceSlot(c.id)}
                onZip={onReplaceSlotZip ? () => onReplaceSlotZip(c.id) : undefined}
                joiner={t.assets.or}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  onClick={() => onSelectModel(c.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-xs",
                    // Active model reads brighter once there's a choice to make.
                    multi && c.active ? "text-foreground" : "text-muted-foreground",
                    multi && !c.active && "cursor-pointer hover:text-foreground",
                  )}
                  title={c.file}
                >
                  {c.file}
                </button>
                {i > 0 && <RemoveButton onClick={() => onRemoveModel(c.id)} />}
              </div>
            </div>
          ))}
          {/* The empty slot: same anatomy, placeholders until its upload lands. */}
          {pendingSlot && (
            <div className="mt-3">
              <UploadPair
                icon={PersonStanding}
                label={modelUploadLabel}
                onClick={onFillPending}
                onZip={onFillPendingZip}
                joiner={t.assets.or}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/40">—</span>
                <RemoveButton onClick={onCancelPending} />
              </div>
            </div>
          )}
          {/* Form-append: reveal the next slot where it would appear. */}
          {!pendingSlot && (
            <div className="mt-2.5 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-fit gap-1.5 border-dashed border-white/15 bg-transparent px-2.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={onAddSlot}
            >
              <Plus className="size-3.5" />
              {addModelLabel}
            </Button>
            </div>
          )}
        </Section>

        <Section title={t.assets.animation}>
          {characters.map((c, i) => (
            <div key={c.id} className={i > 0 ? "mt-2.5" : undefined}>
              {/* One motion row per model — captioned once there's a cast. */}
              {multi && (
                <div className="mb-1 truncate text-[11px] text-muted-foreground/60" title={c.file}>
                  {c.file}
                </div>
              )}
              <AssetRow
                icon={Footprints}
                label={t.assets.uploadAnimation}
                value={c.animName}
                onClick={() => onUploadAnimation(c.id)}
                onRemove={() => onRemoveAnimation(c.id)}
              />
            </div>
          ))}
          {/* The empty slot's future motion row — inert until its model lands. */}
          {pendingSlot && (
            <div className="mt-2.5">
              <div className="mb-1 truncate text-[11px] text-muted-foreground/40">—</div>
              <AssetRow icon={Footprints} label={t.assets.uploadAnimation} disabled />
            </div>
          )}
        </Section>

        <Section title={t.assets.camera}>
          <AssetRow icon={Video} label={t.assets.uploadCamera} value={cameraName} onClick={onUploadCamera} onRemove={onRemoveCamera} />
        </Section>

        <Section title={t.assets.music}>
          <AssetRow icon={Music} label={t.assets.uploadMusic} value={audioName} onClick={onUploadMusic} onRemove={onRemoveMusic} />
        </Section>

        <Section title={t.assets.backdrop}>
          <AssetRow icon={ImageIcon} label={t.assets.uploadBackdrop} value={backdropName} onClick={onUploadBackdrop} onRemove={onRemoveBackdrop} />
        </Section>

        <Section title={t.assets.skybox}>
          <AssetRow icon={Globe} label={t.assets.uploadSkybox} value={skyboxName} onClick={onUploadSkybox} onRemove={onRemoveSkybox} />
        </Section>
      </div>
    </ScrollArea>
  )
})
