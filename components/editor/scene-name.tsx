"use client"

// The scene's name, and the gesture for changing it.
//
// Label and input share ONE box — same padding, same rule, same line height —
// so entering rename cannot shift the text or change the row's height. The
// field is an underline, no box: present in BOTH states and merely transparent
// on the label; without it the text jumps by a pixel the moment it is editable.
//
// Double-click, the same gesture as renaming a style group or a node and as
// typing a slider's value, so it needs no affordance of its own.
//
// The raw <input> is deliberate. components/ui/input is h-9, w-full, px-3,
// text-base and carries a focus ring — every one of which would have to be
// overridden here, and a primitive you override everywhere is not a primitive
// you are using. This is the extension instead: one box, owned in one place.
// The 0.3.x chrome carried a second copy of this box; it went with that chrome.

import { Input } from "@/components/ui/input"
import { useState } from "react"
import { cn } from "@/lib/utils"

/** Both states, so neither can drift from the other. `display` is the cover's
 *  title: the serif, italic, at the one display size. */
const NAME_BOX = {
  // py-0 in BOTH: an <input> brings the browser's own top and bottom padding,
  // which the label does not have, and the text dropped a pixel on rename.
  plain: "min-w-0 rounded-none border-0 border-b px-1 py-0 text-xs leading-4",
  // A line a little taller than the type, so the serif's italics are whole in
  // the field as on the label.
  display: "min-w-0 rounded-none border-0 border-b px-1 py-0 font-display text-display leading-[1.15] italic",
}

const MAX = 60

export function SceneName({
  name,
  onRename,
  display = false,
  className,
}: {
  name: string
  onRename: (name: string) => void
  display?: boolean
  className?: string
}) {
  const box = NAME_BOX[display ? "display" : "plain"]
  const [editing, setEditing] = useState(false)
  const commit = (value: string) => {
    const next = value.trim()
    // A scene must have a name, so an empty field abandons the edit rather than
    // clearing it — there is nothing sensible to show afterwards.
    if (next && next !== name) onRename(next.slice(0, MAX))
    setEditing(false)
  }

  if (editing) {
    return (
      <Input variant="bare"
        autoFocus
        defaultValue={name}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e.currentTarget.value)
          // Escape abandons rather than committing a half-typed name.
          else if (e.key === "Escape") setEditing(false)
        }}
        maxLength={MAX}
        // field-sizing hugs the text instead of stretching to fill the row,
        // which is what pushed the toggle out to the far edge on every rename.
        className={cn(
          box,
          className,
          "max-w-full [field-sizing:content] border-foreground bg-transparent text-foreground outline-none",
        )}
      />
    )
  }
  return (
    <span
      onDoubleClick={() => setEditing(true)}
      className={cn(box, className, "cursor-text truncate border-transparent", display ? "block text-foreground" : "text-muted-foreground")}
    >
      {name}
    </span>
  )
}
