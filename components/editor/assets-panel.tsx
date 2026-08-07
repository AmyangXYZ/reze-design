"use client"

// Assets panel (chromeless): the raw ingredients of a scene

import { memo, type ComponentType, type ReactNode, type RefObject } from "react"
import { Footprints, Globe, Image as ImageIcon, Music, Mountain, PersonStanding, Plus, RotateCcw, Video, X } from "lucide-react"
import type { Engine } from "reze-engine"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section, SliderRow } from "@/components/scene/scene-sidebar"
import { StageMorphs } from "@/components/scene/stage-morphs"
import { DEFAULT_STAGE_TRANSFORM, type StageInfo, type StageTransform } from "@/hooks/use-engine"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Axis suffixes for the placement rows. Not in the dictionary — "X" is "X" in
 *  every language the app speaks, the same reason the camera target composes its
 *  labels rather than carrying nine keys. */
const AXES = ["X", "Y", "Z"] as const

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

/** A titled block inside a stage card. The reset sits on the title's own line,
 *  right-aligned — it acts on everything below it, so it belongs to the heading
 *  rather than trailing the last control. Always present, so the heading row
 *  never changes height or reflows as values move off their defaults; it simply
 *  goes inert when there is nothing to undo. */
function StageSubsection({
  title,
  onReset,
  canReset,
  children,
}: {
  title: string
  onReset: () => void
  /** False when the subsection already sits at its defaults. */
  canReset: boolean
  children: ReactNode
}) {
  const t = useT()
  // No rule above the heading: these are parts of one Stage section, not
  // separate sections, and Section already draws the boundary that matters.
  return (
    <div className="mt-4">
      <div className="mb-2 flex h-5 items-center justify-between">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canReset}
          className="-mr-1.5 h-5 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-35"
          onClick={onReset}
        >
          <RotateCcw className="size-3" />
          {t.stage.reset}
        </Button>
      </div>
      {children}
    </div>
  )
}

/**
 * One stage: its file, where it stands, and its switches.
 *
 * Placement is the thing a stage needs that a character never does — a cast
 * member spawns on a deterministic offset, a building has to be put somewhere.
 * Rotation earns its place because stage PMX are authored facing whichever way
 * the artist happened to work in, and turning the stage is the MMD instinct;
 * turning the camera instead moves the whole composition.
 */
function StageCard({
  stage,
  engineRef,
  onTransform,
  onMorph,
  onResetMorphs,
  onRemove,
}: {
  stage: StageInfo
  engineRef: RefObject<Engine | null>
  onTransform: (patch: Partial<StageTransform>) => void
  /** Takes the stage id so it can be passed through unbound — a per-card closure
   *  would be a new identity every render and defeat StageMorphs' memo. */
  onMorph: (stageId: string, morph: string, weight: number) => void
  onResetMorphs: () => void
  onRemove: () => void
}) {
  const t = useT()
  const { position, rotation, scale } = stage.transform
  const setAxis = (key: "position" | "rotation", i: number, v: number) => {
    const next: [number, number, number] = [...stage.transform[key]]
    next[i] = v
    onTransform({ [key]: next })
  }
  const placed =
    position.some((v) => v !== 0) || rotation.some((v) => v !== 0) || scale !== DEFAULT_STAGE_TRANSFORM.scale
  const switched = Object.values(stage.morphs).some((w) => w > 0)
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={stage.file}>
          {stage.file}
        </span>
        <RemoveButton onClick={onRemove} />
      </div>

      <StageSubsection
        title={t.stage.placement}
        canReset={placed}
        onReset={() => onTransform(DEFAULT_STAGE_TRANSFORM)}
      >
        {AXES.map((axis, i) => (
          <SliderRow
            key={`p${axis}`}
            label={`${t.stage.position} ${axis}`}
            value={position[i]}
            min={-50}
            max={50}
            step={0.1}
            onChange={(v) => setAxis("position", i, v)}
          />
        ))}
        {AXES.map((axis, i) => (
          <SliderRow
            key={`r${axis}`}
            label={`${t.stage.rotation} ${axis}`}
            value={rotation[i]}
            min={-180}
            max={180}
            step={1}
            onChange={(v) => setAxis("rotation", i, v)}
            fmt={(v) => `${v}°`}
          />
        ))}
        {/* Stage PMX come at wildly different scales — 0.05 lets a model authored
            in centimetres meet one authored in MMD units without a re-export. */}
        <SliderRow label={t.stage.scale} value={scale} min={0.05} max={10} step={0.05} onChange={(v) => onTransform({ scale: v })} fmt={(v) => `${v.toFixed(2)}×`} />
      </StageSubsection>

      <StageSubsection title={t.stage.switches} canReset={switched} onReset={onResetMorphs}>
        <StageMorphs engineRef={engineRef} stageId={stage.id} weights={stage.morphs} onChange={onMorph} />
      </StageSubsection>
    </div>
  )
}

// Memoized: the dock keeps tabs mounted (useKeepAlive), so without memo the hidden Assets tab
export const AssetsPanel = memo(function AssetsPanel({
  characters,
  pendingSlot,
  stages,
  engineRef,
  onUploadStage,
  onUploadStageZip,
  stageUploadLabel,
  onRemoveStage,
  onStageTransform,
  onStageMorph,
  onResetStageMorphs,
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
  /** Environment models. Separate from characters: no motion slot, placed by
   *  transform. Each carries its own authored switch weights. */
  stages: StageInfo[]
  /** The stage morph panel reads each stage's morph table straight off the model. */
  engineRef: RefObject<Engine | null>
  onUploadStage: () => void
  /** Desktop only: folder dialogs can't pick a zip, so it needs its own button. */
  onUploadStageZip?: () => void
  /** Platform-specific wording, as with modelUploadLabel. */
  stageUploadLabel: string
  onRemoveStage: (id: string) => void
  onStageTransform: (id: string, patch: Partial<StageTransform>) => void
  onStageMorph: (id: string, morph: string, weight: number) => void
  onResetStageMorphs: (id: string) => void
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
  // With no cast at all the upload row IS the section — making the user click
  // "Add model" first would be a step that reveals the only thing there is to do.
  const empty = characters.length === 0
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
                <RemoveButton onClick={() => onRemoveModel(c.id)} />
              </div>
            </div>
          ))}
          {/* The empty slot: same anatomy, placeholders until its upload lands. */}
          {(pendingSlot || empty) && (
            <div className={empty ? undefined : "mt-3"}>
              <UploadPair
                icon={PersonStanding}
                label={modelUploadLabel}
                onClick={onFillPending}
                onZip={onFillPendingZip}
                joiner={t.assets.or}
              />
              <div className="mt-1.5 flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/40">—</span>
                {/* Nothing to cancel back to when this is the scene's only slot. */}
                {pendingSlot && <RemoveButton onClick={onCancelPending} />}
              </div>
            </div>
          )}
          {/* Form-append: reveal the next slot where it would appear.
              Shown for as long as there is a cast — there is no cap on how many
              models a scene holds, so the way to add one never goes away. While a
              slot is already waiting for its files this opens that slot's picker,
              because a second empty slot is not what the click is asking for. */}
          {!empty && (
            <div className="mt-2.5 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-fit gap-1.5 border-dashed border-white/15 bg-transparent px-2.5 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={pendingSlot ? onFillPending : onAddSlot}
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

        <Section title={t.stage.title}>
          <UploadPair
            icon={Mountain}
            label={stageUploadLabel}
            onClick={onUploadStage}
            onZip={onUploadStageZip}
            joiner={t.assets.or}
          />
          {stages.length === 0 ? (
            <div className="mt-1.5 text-xs text-muted-foreground/40">—</div>
          ) : (
            <div className="mt-1">
              {stages.map((s) => (
                <StageCard
                  key={s.id}
                  stage={s}
                  engineRef={engineRef}
                  onTransform={(patch) => onStageTransform(s.id, patch)}
                  onMorph={onStageMorph}
                  onResetMorphs={() => onResetStageMorphs(s.id)}
                  onRemove={() => onRemoveStage(s.id)}
                />
              ))}
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
