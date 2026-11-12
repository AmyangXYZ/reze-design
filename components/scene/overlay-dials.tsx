"use client"

// The picked overlay's dials in the dock: its exact size in the export's
// pixels, then its fields on the effect dials' panel (keying at the playhead,
// a drag shown at once and written on release). A drag on the canvas shows
// here as it happens, read from the drag store — this panel re-renders with
// it, the page does not.

import { useSyncExternalStore } from "react"
import { SliderRow } from "@/components/scene/scene-sidebar"
import { EffectParams } from "@/components/scene/effect-params"
import { SizeRow } from "@/components/scene/size-row"
import { InsertKeysLine } from "@/components/scene/insert-keys-line"
import {
  overlayDecls,
  overlayDrag,
  overlayFieldsAt,
  withFieldKeys,
  type LiveOverlay,
  type OverlayField,
} from "@/lib/overlays"

export function OverlayDials({
  overlay,
  labels,
  sizeLabel,
  insertLabel,
  onInsertKeys,
  outHeight,
  frameNow,
  onUpdate,
  onPreview,
  layerLabel,
  place,
  onLayer,
}: {
  overlay: LiveOverlay
  labels: Record<OverlayField, string>
  sizeLabel: string
  insertLabel: string
  /** Every field keyed at the playhead, as it stands. */
  onInsertKeys: () => void
  /** The export frame's height in pixels, what the exact size is measured in. */
  outHeight: number
  /** The playhead, in frames. */
  frameNow: () => number
  onUpdate: (patch: Partial<LiveOverlay>) => void
  /** A dial's drag, for the layer to show before the document has it. */
  onPreview: (patch: Partial<Pick<LiveOverlay, OverlayField>>) => void
  layerLabel: string
  /** Its place in the pile, 0 at the back, and the pile's height. */
  place: [number, number]
  /** Moved to a place in the pile, 0 at the back. */
  onLayer: (at: number) => void
}) {
  const [at, count] = place
  const drag = useSyncExternalStore(overlayDrag.subscribe, overlayDrag.get, () => null)
  // A canvas drag on this overlay shows as its fields' values; a dragged field
  // reads as plain while the drag lasts, so its dial follows the pointer.
  const patch = drag?.id === overlay.id ? drag.patch : null
  const shown: LiveOverlay = patch ? { ...overlay, ...patch, keys: withoutFields(overlay.keys, patch) } : overlay
  const setSize = (size: number) => onUpdate(overlayFieldsAt(overlay, { size }, Math.round(frameNow())))
  return (
    <div className="mt-3.5">
      <InsertKeysLine label={insertLabel} onInsert={onInsertKeys} />
      <SizeRow
        label={sizeLabel}
        width={shown.size * outHeight * overlay.aspect}
        height={shown.size * outHeight}
        onWidth={(w) => setSize(w / overlay.aspect / outHeight)}
        onHeight={(h) => setSize(h / outHeight)}
        digits={0}
      />
      <EffectParams
        decls={overlayDecls(shown, labels)}
        values={undefined}
        onChange={(name, v) => typeof v === "number" && onUpdate({ [name]: v })}
        keys={shown.keys}
        onKeys={(name, ks) => onUpdate({ keys: withFieldKeys(overlay.keys, name, ks) })}
        frameNow={frameNow}
        onPreview={(name, v) => typeof v === "number" && onPreview({ [name]: v })}
      />
      {/* Which layer it is, 1 at the bottom: slid past another, it goes over it. */}
      {count > 1 && (
        <div className="mt-1.5">
          <SliderRow
            label={layerLabel}
            value={at + 1}
            min={1}
            max={count}
            step={1}
            onChange={(n) => onLayer(Math.round(n) - 1)}
            fmt={(n) => `${Math.round(n)} / ${count}`}
            dense
            labelClass="w-[4.75rem]"
          />
        </div>
      )}
    </div>
  )
}

function withoutFields(keys: LiveOverlay["keys"], patch: object): LiveOverlay["keys"] {
  if (!keys) return keys
  const out = { ...keys }
  for (const k of Object.keys(patch)) delete out[k]
  return Object.keys(out).length ? out : undefined
}
