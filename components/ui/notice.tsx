// A warning or an error, as the chrome says one: the words in the ink, like
// all its type, and the accent as a mark before them. On the cover and on
// paper the ground is whatever the scene is, and amber or red words over a
// pale picture wash into it; a solid dot of the accent beside ink words reads
// on any ground. See AGENTS.md, "Three accents".

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type NoticeTone = "warning" | "error"

/** The accent's mark: amber for a warning, red for an error. */
export function Mark({ tone, className }: { tone: NoticeTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", tone === "warning" ? "bg-amber-400" : "bg-red-400", className)}
    />
  )
}

/** A line (or a few) of warning or error, marked. The mark sits on the first
 *  line's middle, however the words wrap. */
export function Notice({ tone, className, children }: { tone: NoticeTone; className?: string; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-1.5 text-foreground", className)}>
      <span className="flex h-[1lh] shrink-0 items-center">
        <Mark tone={tone} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
