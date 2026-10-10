"use client"

// One date, in the reader's own timezone. The server cannot know the reader's
// zone, so the first render shows the UTC value and the browser replaces it
// before anyone reads it.

import { useSyncExternalStore } from "react"
import { localMinute, wordedMinute } from "@/lib/time"

const never = () => () => {}

export function Stamp({
  iso,
  show = "minute",
  locale,
  className,
}: {
  iso: string | null | undefined
  /** `minute` for a column or a fact; `words` for a line of prose. */
  show?: "minute" | "words"
  locale?: string
  className?: string
}) {
  const inBrowser = useSyncExternalStore(never, () => true, () => false)
  if (!iso) return <span className={className}>—</span>
  const text = !inBrowser
    ? iso.slice(0, 16).replace("T", " ")
    : show === "minute"
      ? localMinute(iso)
      : wordedMinute(iso, locale)
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  )
}
