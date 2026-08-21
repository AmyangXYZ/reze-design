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
import { BoneList } from "@/components/scene/bone-list"
import { MorphList } from "@/components/scene/morph-list"
import { useClipActions, useClipSelector, type ClipEditKind } from "@/context/clip-editor"

export const TrackPicker = memo(function TrackPicker({ kind }: { kind: ClipEditKind }) {
  const clip = useClipSelector((s) => s.clip)
  const boneNames = useClipSelector((s) => s.boneNames)
  const morphNames = useClipSelector((s) => s.morphNames)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const selectedMorph = useClipSelector((s) => s.selectedMorph)
  const boneGroup = useClipSelector((s) => s.boneGroup)
  const { setSelectedBone, setSelectedMorph, setBoneGroup } = useClipActions()

  if (kind === "camera") return null

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
          // Viewport picking does not route here yet — when a double-click in
          // the scene selects a bone, this is what scrolls the row into view.
          revealRequest={null}
        />
      )}
    </div>
  )
})
