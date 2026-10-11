"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

/**
 * The slow-connection line the boot guard (components/boot-guard) reveals,
 * and the mark that tells it the app has started.
 *
 * Server-rendered hidden, so it is in the HTML before any code runs. Both
 * languages are in the markup because no i18n code has run yet when the guard
 * shows it — the guard unhides the one the app would pick, and its own click
 * handler makes Reload work before React does. suppressHydrationWarning,
 * because the guard may have changed `hidden` on these before React hydrates.
 *
 * Once React runs, every chunk the page needed has arrived: mark the page
 * started, which ends the guard, and hide the line if it was showing.
 */
export function BootSlowNote() {
  useEffect(() => {
    document.documentElement.setAttribute("data-booted", "")
    const note = document.getElementById("boot-slow")
    if (note) note.hidden = true
  }, [])
  return (
    <div id="boot-slow" hidden suppressHydrationWarning className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="flex items-center gap-2.5 rounded-full border border-line-strong bg-surface-raised py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
        <span data-lang="en" suppressHydrationWarning>
          Slow connection — still loading the app.
        </span>
        <span data-lang="zh" hidden suppressHydrationWarning>
          网络较慢，应用仍在加载。
        </span>
        <Button id="boot-reload" size="xs" variant="secondary" onClick={() => window.location.reload()}>
          <span data-lang="en" suppressHydrationWarning>
            Reload
          </span>
          <span data-lang="zh" hidden suppressHydrationWarning>
            重新加载
          </span>
        </Button>
      </div>
    </div>
  )
}
