"use client"

// Stage morph switches.
//
// Stage artists ship morphs as CONFIGURATION, not animation: a roof on or off,
// a banner swapped, a neon set recoloured. Nothing drives them — there is no
// stage VMD and there never will be — so the weight the user picks IS the
// scene's state, and it has to be saved with the document.
//
// That is the whole reason characters get no panel like this one. A character's
// morph weights are rewritten every frame by its clip, so sliders over them
// would spend their life arguing with the animation. Faces are the VMD's job.

import { memo, useEffect, useState, type RefObject } from "react"
import type { Engine } from "reze-engine"
import { SliderRow } from "@/components/scene/scene-sidebar"
import { useT } from "@/lib/i18n"

/** Morph name → weight, for the stage the panel is pointed at. */
export type StageMorphWeights = Record<string, number>

export const StageMorphs = memo(function StageMorphs({
  engineRef,
  stageId,
  weights,
  onChange,
}: {
  engineRef: RefObject<Engine | null>
  stageId: string
  /** Authored weights for this stage — the document's, not the engine's. */
  weights: StageMorphWeights
  /** Unbound so its identity is stable: a stage can carry 60+ switches, and a
   *  per-card closure would rebuild every one of those slider subtrees on each
   *  parent render — including every frame of a placement-slider drag. */
  onChange: (stageId: string, morph: string, weight: number) => void
}) {
  const t = useT()
  // Read once per stage: a PMX's morph table never changes after load.
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    const model = engineRef.current?.getModel(stageId)
    if (!model) {
      setNames([])
      return
    }
    // Only morphs the engine can actually act on. The table also lists flip and
    // impulse morphs (PMX 2.1), and UV channels 4–7 this engine does not carry —
    // rendering sliders for those would be offering controls that move nothing.
    const morphs = model.getMorphing().morphs
    setNames(model.getSupportedMorphIndices().map((i) => morphs[i].name))
  }, [engineRef, stageId])

  if (names.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.stage.noMorphs}</p>
  }

  return (
    <>
      {names.map((name) => (
        <SliderRow
          key={name}
          label={name}
          value={weights[name] ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange(stageId, name, v)}
          fmt={(v) => v.toFixed(2)}
        />
      ))}
    </>
  )
})
