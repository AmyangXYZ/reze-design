"use client"

// Blender-style "Add node" search palette, opened by right-clicking the graph canvas.
// A search box filters the curated NODE_CATALOG; picking an item (click, or ↑↓ + ⏎)
// drops that node at the cursor. Portaled to <body> so the bottom drawer's clipping
// doesn't cut it off, and clamped to stay on-screen (right-clicks land low, near the
// drawer's bottom edge, so it usually opens upward).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NODE_CATALOG, type CatalogItem } from "@/lib/node-catalog"
import { cn } from "@/lib/utils"

export function AddNodeMenu({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number
  y: number
  onPick: (type: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  // When searching, collapse to a single flat, filtered list (no headers); otherwise
  // show the curated groups. `flat` is the keyboard-navigable order either way.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return NODE_CATALOG
    const items = NODE_CATALOG.flatMap((g) => g.items).filter(
      (i) => i.label.toLowerCase().includes(q) || i.type.toLowerCase().includes(q),
    )
    return [{ category: "", items }]
  }, [query])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Reset the highlight to the top whenever the filtered set changes.
  useEffect(() => setActive(0), [query])
  useEffect(() => inputRef.current?.focus(), [])

  // Clamp into the viewport after measuring (menu height varies with the filter).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(x, window.innerWidth - width - pad))
    const top = Math.max(pad, Math.min(y, window.innerHeight - height - pad))
    setPos({ left, top, ready: true })
  }, [x, y, flat.length])

  // Dismiss on outside pointer-down or Escape (Escape is also handled by the input).
  // Capture phase: React Flow's pane stops pointer events from bubbling (d3-zoom),
  // so a bubble-phase listener never sees clicks on the canvas — capture runs first.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [onClose])

  const pick = (item: CatalogItem | undefined) => item && onPick(item.type)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      pick(flat[active])
    } else if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    }
  }

  if (typeof document === "undefined") return null

  let idx = -1 // running flat index, to mark the active row across groups
  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}
      className="fixed z-50 flex max-h-[360px] w-56 flex-col overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-float backdrop-blur-xs"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="shrink-0 border-b border-white/10 p-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Add node…"
          className="h-7 w-full rounded-md bg-white/5 px-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/40"
        />
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1">
        {flat.length === 0 && (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground/60">No matching nodes</div>
        )}
        {groups.map((g) => (
          <div key={g.category || "results"}>
            {g.category && (
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/50 uppercase">
                {g.category}
              </div>
            )}
            {g.items.map((item) => {
              idx++
              const on = idx === active
              return (
                <button
                  key={item.type}
                  data-active={on}
                  onMouseEnter={() => setActive(flat.indexOf(item))}
                  onClick={() => pick(item)}
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1 text-left text-xs transition-colors",
                    on ? "bg-blue-400/[0.12] text-blue-400" : "text-foreground/90 hover:bg-white/5",
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}
