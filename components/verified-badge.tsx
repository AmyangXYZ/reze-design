"use client"

// The check beside a verified maker's name: someone we vouch for, whose effects,
// shaders and scenes are good to learn from and build on. Granted by hand from
// /admin. Reze's violet, so it reads as ours and not as one of the chrome's
// accents (blue is selection there).

import { BadgeCheck } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** lucide's badge-check, filled: the badge in Reze's violet, the tick in white. */
export function VerifiedBadge({ className }: { className?: string }) {
  const t = useT()
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={t.verified.label} className={cn("size-3 shrink-0 text-reze", className)}>
      <path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="m9 12 2 2 4-4" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The check with its words, where there is room to say it: the maker's own
 *  page and their account menu. A tinted chip, like the chrome's other tinted
 *  boxes: Reze's violet at an alpha, the words in the violet itself. */
export function VerifiedPill({ className }: { className?: string }) {
  const t = useT()
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full bg-reze/15 pr-1.5 pl-1 text-2xs leading-none font-medium whitespace-nowrap text-reze",
        className,
      )}
    >
      <BadgeCheck className="size-2.5" strokeWidth={2.5} />
      {t.verified.label}
    </span>
  )
}
