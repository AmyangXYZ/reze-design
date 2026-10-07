"use client"

// The premium seal: a scalloped rosette with a check, right after a premium
// account's name, sized to the text it follows. The colour is --color-premium.

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Twelve soft scallops on a 24-unit box: radius `r`, scallop depth `a`. */
function rosette(r: number, a: number): string {
  const pts: string[] = []
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2
    const rr = r + a * Math.cos(12 * t)
    pts.push(`${(12 + rr * Math.cos(t)).toFixed(2)} ${(12 + rr * Math.sin(t)).toFixed(2)}`)
  }
  return `M${pts.join("L")}Z`
}
const ROSETTE = rosette(10.6, 0.8)
/** Fuller and shallower, so the frame clears the avatar all the way round. */
const FRAME = rosette(11.3, 0.7)

/** The rosette with a check. */
export function PremiumSeal({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-[1.1em] shrink-0", className)}>
      <path d={ROSETTE} fill="var(--color-premium)" />
      <path
        d="M7.6 12.3l3 3 5.8-6.2"
        fill="none"
        stroke="#fff"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The rosette as a frame around a round avatar: the scallops wrap the picture,
 * past a thin open gap. It fills a box 3.5px past the avatar on every side — the
 * hole is cut for that ratio (a 26px avatar in a 33px frame).
 */
export function PremiumFrame({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("pointer-events-none", className)}>
      {/* The scallops with a round hole: the gap shows whatever is behind. */}
      <path d={`${FRAME}M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0Z`} fillRule="evenodd" fill="var(--color-premium)" />
    </svg>
  )
}

/** The seal beside a handle, explaining itself on hover. */
export function PremiumMark({ className }: { className?: string }) {
  const t = useT()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex shrink-0 items-center", className)} aria-label={t.premium.label}>
          <PremiumSeal />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="flex items-center gap-2 px-2.5 py-2">
        <PremiumSeal className="size-5" />
        <span className="font-semibold">{t.premium.label}</span>
      </TooltipContent>
    </Tooltip>
  )
}
