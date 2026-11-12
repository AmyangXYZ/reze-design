"use client"

// The picked card's dials in the dock: its size in world units, then its
// placement on the effect dials' panel — a keyed field keys at the playhead,
// as an overlay's does.

import { EffectParams } from "@/components/scene/effect-params"
import { SizeRow } from "@/components/scene/size-row"
import { InsertKeysLine } from "@/components/scene/insert-keys-line"
import type { PlaneInfo } from "@/lib/scene-host"
import { planeDecls, planeFieldsAt, withKeys, type PlaneField } from "@/lib/planes"

export function PlaneDials({
  plane,
  labels,
  sizeLabel,
  insertLabel,
  onInsertKeys,
  frameNow,
  onUpdate,
}: {
  plane: PlaneInfo
  labels: Record<PlaneField, string>
  sizeLabel: string
  insertLabel: string
  /** Every field keyed at the playhead, as it stands. */
  onInsertKeys: () => void
  /** The playhead, in frames. */
  frameNow: () => number
  onUpdate: (patch: Pick<PlaneInfo, "transform" | "keys">) => void
}) {
  const set = (patch: Partial<Record<PlaneField, number>>) =>
    onUpdate({ transform: plane.transform, keys: plane.keys, ...planeFieldsAt(plane, patch, Math.round(frameNow())) })
  const scale = plane.transform.scale
  return (
    <div className="mt-3.5">
      <InsertKeysLine label={insertLabel} onInsert={onInsertKeys} />
      <SizeRow
        label={sizeLabel}
        width={plane.width * scale}
        height={plane.height * scale}
        onWidth={(v) => set({ scale: v / plane.width })}
        onHeight={(v) => set({ scale: v / plane.height })}
      />
      <EffectParams
        decls={planeDecls(plane.transform, labels)}
        values={undefined}
        onChange={(name, v) => typeof v === "number" && set({ [name]: v })}
        keys={plane.keys}
        onKeys={(name, ks) => onUpdate({ transform: plane.transform, keys: withKeys(plane.keys, name, ks) })}
        frameNow={frameNow}
      />
    </div>
  )
}
