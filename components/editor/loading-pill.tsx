"use client"

// The app's one loading indicator.
//
// Every wait in this product is "the scene isn't ready yet" — booting the engine,
// fetching a bundle, resolving a route. Showing a different shape for each would
// suggest they are different kinds of wait, which they are not.

import { useT } from "@/lib/i18n"

export function LoadingPill({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xs">
        <span className="size-2 animate-pulse rounded-full bg-blue-400" />
        {label ?? t.editor.loadingModel}
      </div>
    </div>
  )
}
