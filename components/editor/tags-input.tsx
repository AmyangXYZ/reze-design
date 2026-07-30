"use client"

// Tags as chips. Enter or comma commits the word being typed; backspace on an
// empty field takes back the last chip. A comma-separated string in a plain text
// field left people guessing whether the separator counted — a chip is proof it
// did.

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export function TagsInput({
  value,
  onChange,
  max,
  placeholder,
  className,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  max: number
  placeholder?: string
  className?: string
}) {
  const [draft, setDraft] = useState("")

  const commit = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/,+$/, "")
    setDraft("")
    if (!tag || value.includes(tag) || value.length >= max) return
    onChange([...value, tag])
  }

  return (
    <div
      className={cn(
        "mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 focus-within:border-blue-400/50",
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded bg-white/10 py-0.5 pr-1 pl-1.5 text-xs text-foreground"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((x) => x !== tag))}
            className="cursor-pointer text-muted-foreground transition-colors hover:text-red-400"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          // Typing a comma is the same gesture as Enter.
          if (e.target.value.includes(",")) commit(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Never lets Enter reach the form — publishing is a deliberate click.
            e.preventDefault()
            commit(draft)
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        // A committed chip on blur, so a typed-but-unconfirmed word isn't lost.
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="min-w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
      />
    </div>
  )
}
