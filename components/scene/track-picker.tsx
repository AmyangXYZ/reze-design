"use client"

// Which bone, or which morph, the curve half is showing.
//
// The dopesheet's ROWS are the channels the clip already keys — that is what a
// channel list means, and it is why no permanent bone browser was ported when
// the timeline came over. This is the other half of that argument: keying a
// bone for the first time has to be able to name one with no track yet, and the
// dopesheet by definition cannot list it.
//
// So it is a picker, not a browser, and it only exists while the editor is open
// on a track that HAS things to pick between. The camera has exactly one track,
// so it gets no column at all — a list of one is a label.

import { memo } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BoneList } from "@/components/scene/bone-list"
import { MorphList } from "@/components/scene/morph-list"
import { useClipActions, useClipSelector, type ClipEditKind } from "@/context/clip-editor"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const TrackPicker = memo(function TrackPicker({
  kind,
  objects = [],
  objectId = null,
  onObject,
}: {
  kind: ClipEditKind
  /** The Objects tab's subjects: every prop in the scene. */
  objects?: { id: string; label: string }[]
  objectId?: string | null
  onObject?: (id: string) => void
}) {
  const clip = useClipSelector((s) => s.clip)
  const boneNames = useClipSelector((s) => s.boneNames)
  const morphNames = useClipSelector((s) => s.morphNames)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const selectedMorph = useClipSelector((s) => s.selectedMorph)
  const boneGroup = useClipSelector((s) => s.boneGroup)
  const revealRequest = useClipSelector((s) => s.revealBone)
  const { setSelectedBone, setSelectedMorph, setBoneGroup } = useClipActions()

  if (kind === "camera" || kind === "effect") return null
  if (kind === "object") return <ObjectTrackList objects={objects} objectId={objectId} onObject={onObject} />

  return (
    // A fixed column, and a narrow one. It is a means to the canvas beside it,
    // not a panel in its own right — the same reasoning that keeps the label
    // gutter at 42px.
    //
    // line-STRONG, and the earlier `line` was wrong. That token divides rows
    // within one surface; this edge bounds a region — a scrolling index of rig
    // names against a canvas you drag keyframes on, two different things to do
    // with your mouse. At white/6% it read as a hairline that might have been
    // part of the canvas, which is the failure AGENTS.md calls out by name.
    //
    // Its rows run BELOW the app's xs tier, which is the one place that is
    // right: this is a dense index of a hundred-odd rig names that you scan
    // rather than read, in a column narrow enough that xs truncates most of
    // them. Everywhere else, two tiers.
    <div className="flex w-[7rem] shrink-0 flex-col overflow-hidden border-r border-line-strong">
      {kind === "morph" ? (
        <MorphList
          morphNames={morphNames}
          clip={clip}
          selectedMorph={selectedMorph}
          onSelectMorph={setSelectedMorph}
        />
      ) : (
        <BoneList
          modelBones={boneNames}
          clip={clip}
          selectedGroup={boneGroup}
          selectedBone={selectedBone}
          // Toggle, not select. The list opens exactly one group at a time and
          // pressing the open one used to re-select it — so a group could be
          // opened and never shut, and the only way back to a short list was to
          // open a different group. Selecting the open one clears it instead.
          onSelectGroup={(g) => setBoneGroup((prev) => (prev === g ? "" : g))}
          onSelectBone={setSelectedBone}
          // A double-click in the scene lands here: the pick widens the group
          // if it has to, then bumps an epoch, and this scrolls the row in.
          revealRequest={revealRequest}
        />
      )}
    </div>
  )
})

/**
 * The Objects tab's column: which prop, then its tracks — the Parent row, which
 * holds what the prop rides over time, and the prop's own bones.
 */
function ObjectTrackList({
  objects,
  objectId,
  onObject,
}: {
  objects: { id: string; label: string }[]
  objectId: string | null
  onObject?: (id: string) => void
}) {
  const t = useT()
  const clip = useClipSelector((s) => s.clip)
  const boneNames = useClipSelector((s) => s.boneNames)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const parentSelected = useClipSelector((s) => s.parentSelected)
  const { setSelectedBone, setParentSelected } = useClipActions()
  return (
    <div className="flex w-[7rem] shrink-0 flex-col overflow-hidden border-r border-line-strong">
      <div className="shrink-0 border-b border-line p-1">
        <Select value={objectId ?? undefined} onValueChange={(id) => onObject?.(id)} disabled={objects.length === 0}>
          <SelectTrigger size="sm" className="w-full min-w-0 text-[11px] data-[size=sm]:h-5">
            <SelectValue placeholder={t.lab.ctl.none} />
          </SelectTrigger>
          <SelectContent>
            {objects.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {objectId && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TrackRow
            label={t.lab.timeline.parent}
            active={parentSelected}
            onClick={() => {
              setSelectedBone(null)
              setParentSelected(true)
            }}
          />
          {boneNames.map((name) => (
            <TrackRow
              key={name}
              mono
              label={name}
              count={clip?.boneTracks.get(name)?.length ?? 0}
              active={!parentSelected && selectedBone === name}
              onClick={() => {
                setParentSelected(false)
                setSelectedBone(name)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TrackRow({
  label,
  active,
  count = 0,
  mono = false,
  onClick,
}: {
  label: string
  active: boolean
  count?: number
  mono?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-5 w-full justify-start gap-1 rounded-none px-2 text-left text-[10px] font-normal leading-none transition-none",
        mono && "font-mono",
        active
          ? "bg-blue-400/[0.08] text-blue-400 hover:bg-blue-400/12 hover:text-blue-400 dark:hover:bg-blue-400/12"
          : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-[9px] tabular-nums">[{count}]</span>}
    </Button>
  )
}
