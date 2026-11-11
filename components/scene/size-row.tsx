"use client"

import { Input } from "@/components/ui/input"
import { VALUE_BOX } from "@/components/scene/scene-sidebar"
import { cn } from "@/lib/utils"

/**
 * Two linked number boxes on one row — a size, in world units.
 *
 * Committed on blur and on Enter rather than per keystroke: "2" on the way to
 * "20" is a card that jumps to a twentieth of its size and back while you type.
 * Escape abandons the edit, which is what every other typed field here does.
 */
export function SizeRow({
  label,
  width,
  height,
  onWidth,
  onHeight,
  digits = 1,
}: {
  label: string
  width: number
  height: number
  onWidth: (v: number) => void
  onHeight: (v: number) => void
  /** Decimals shown: world units take one, pixels none. */
  digits?: number
}) {
  // Each number held off the ×, in boxes no wider than the numbers: the width
  // to the left of its box, the height to the right of its own, so the gap is
  // the same on both sides.
  const box = (value: number, commit: (v: number) => void, key: string, align: string) => (
    <Input variant="bare"
      key={key}
      // The live value while not editing; a draft is local to the input, so
      // there is nothing to reconcile when the other box moves this one.
      defaultValue={value.toFixed(digits)}
      // Re-keyed on the value it shows, so the OTHER box's edit refreshes this
      // one — an uncontrolled input keeps its own text otherwise, and the pair
      // would silently disagree about the size of the same card.
      onBlur={(e) => {
        const v = Number(e.currentTarget.value)
        if (Number.isFinite(v) && v > 0) commit(v)
        else e.currentTarget.value = value.toFixed(digits)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          e.currentTarget.value = value.toFixed(digits)
          e.currentTarget.blur()
        }
      }}
      className={cn(VALUE_BOX, align, "border-transparent text-muted-foreground outline-none focus:border-foreground focus:text-foreground")}
    />
  )
  // Right-aligned like every other value in this dock: the labels run down the
  // left and the numbers line up down the right.
  return (
    <div className="mt-2.5 flex items-center gap-2 first:mt-0">
      <span className="w-16 shrink-0 truncate text-xs">{label}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {box(width, onWidth, `w${width.toFixed(digits)}`, "w-8 text-left")}
        <span className="text-2xs text-muted-foreground">×</span>
        {box(height, onHeight, `h${height.toFixed(digits)}`, "w-8 text-right")}
      </div>
    </div>
  )
}
