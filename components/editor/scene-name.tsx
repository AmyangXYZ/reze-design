"use client"

// The scene's name, and the gesture for changing it.
//
// Label and input share ONE box — same padding, same border, same line height —
// so entering rename cannot shift the text or change the row's height. The
// border is present in BOTH states and merely transparent on the label; without
// it the text jumps by a pixel the moment it becomes editable.
//
// Double-click, the same gesture as renaming a style group or a node and as
// typing a slider's value, so it needs no affordance of its own.
//
// The raw <input> is deliberate. components/ui/input is h-9, w-full, px-3,
// text-base and carries a focus ring — every one of which would have to be
// overridden here, and a primitive you override everywhere is not a primitive
// you are using. This is the extension instead: one box, owned in one place.
// editor-chrome.tsx still has its own copy of this (NAME_BOX); it should adopt
// this component when the shipped chrome is retired.

import { useState } from "react"
import { cn } from "@/lib/utils"

/** Both states, so neither can drift from the other. */
const NAME_BOX = "min-w-0 rounded-chip border px-1 text-xs leading-4"

const MAX = 60

export function SceneName({
  name,
  onRename,
  className,
}: {
  name: string
  onRename: (name: string) => void
  className?: string
}) {
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
      <input
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
          NAME_BOX,
          className,
          "max-w-full [field-sizing:content] border-blue-400/50 bg-white/5 text-foreground outline-none",
        )}
      />
    )
  }
  return (
    <span
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
      className={cn(NAME_BOX, className, "cursor-text truncate border-transparent text-muted-foreground")}
    >
      {name}
    </span>
  )
}
