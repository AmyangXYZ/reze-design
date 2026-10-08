"use client"

// The AI's working mark: Lucide's Astroid, turning a quarter and breathing.
//
// A quarter turn is the whole loop — the astroid has four-fold symmetry, so
// 90° lands exactly where 0° began and the spin never visibly restarts. The
// scale swells mid-turn and settles at each cusp, which is what makes it read
// as alive rather than as a loading wheel. CSS only (astroid-turn in
// globals.css); still when the person asks for reduced motion.

import { Astroid } from "lucide-react"
import { cn } from "@/lib/utils"

export function AstroidSpinner({ className, still = false }: { className?: string; still?: boolean }) {
  return (
    <Astroid
      aria-hidden
      className={cn("size-3.5 shrink-0", !still && "animate-[astroid-turn_1.4s_cubic-bezier(0.32,0.72,0,1)_infinite] motion-reduce:animate-none", className)}
    />
  )
}
