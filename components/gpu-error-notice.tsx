"use client"

// What the GPU refused, where someone can read it.
//
// A WebGPU validation error does not break a render — the pass that failed
// draws nothing, the next frame arrives, and the crash screen never appears.
// So until now the message existed in two places the person hitting it usually
// is not looking: the browser console, and a report that only assembles itself
// after a React error. A stage that loads with one wall missing is a bug report
// that says "one wall is missing".
//
// This is the third place: the message itself, on screen, selectable, with the
// whole set one press away. It never replaces the app — the scene is still
// running and often still usable — and it is dismissible, because a device that
// disagrees about one thing will say so again on the next frame and nobody
// needs a modal for that.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { logSerial, recentLogs, subscribeLogs } from "@/lib/crash-log"

/** What counts as a GPU complaint rather than an ordinary error. The engine
 *  prefixes its own; the browser's own wording covers the rest. */
const GPU_PATTERNS = [/WebGPU validation/i, /\[Invalid \w+\]/i, /GPUBuffer|GPUTexture|createBuffer|createTexture|Device lost/i]

const isGpu = (text: string) => GPU_PATTERNS.some((p) => p.test(text))

export function GpuErrorNotice() {
  // Through useSyncExternalStore: the ring is a mutable module-level buffer, and
  // this is what reads one from React without tearing between renders.
  const serial = useSyncExternalStore(subscribeLogs, logSerial, () => 0)
  const [dismissed, setDismissed] = useState(0)
  const [copied, setCopied] = useState(false)

  const errors = useMemo(() => {
    void serial
    const seen = new Map<string, { text: string; at: number; count: number }>()
    for (const entry of recentLogs()) {
      if (entry.level !== "error" || !isGpu(entry.text)) continue
      const had = seen.get(entry.text)
      if (had) had.count++
      else seen.set(entry.text, { text: entry.text, at: entry.at, count: 1 })
    }
    return [...seen.values()]
  }, [serial])

  const copy = useCallback(() => {
    const report = errors.map((e) => (e.count > 1 ? `${e.text}  (x${e.count})` : e.text)).join("\n\n")
    void navigator.clipboard?.writeText(report).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => setCopied(false),
    )
  }, [errors])

  // Dismissal is by COUNT rather than by a boolean: a later error is a new
  // thing to say, and a flag would swallow it.
  if (errors.length <= dismissed) return null

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-50 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2">
      <div className="rounded-surface border border-line-strong bg-surface shadow-lg">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="size-1.5 rounded-full bg-red-400" />
          <span className="text-sm text-foreground">
            {errors.length === 1 ? "The GPU refused a command" : `The GPU refused ${errors.length} commands`}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(errors.length)}>
              Dismiss
            </Button>
          </span>
        </div>
        {/* SELECTABLE, and scrollable rather than truncated: a validation
            message names the buffer, the size and the limit it broke, and the
            useful half is usually the end of it. */}
        <div className="max-h-40 overflow-auto px-3 py-2">
          {errors.map((e) => (
            <p key={e.text} className="font-mono text-xs leading-relaxed text-muted-foreground select-text">
              {e.text}
              {e.count > 1 ? ` (x${e.count})` : ""}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
