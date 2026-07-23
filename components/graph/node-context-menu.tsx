"use client"

// Right-click-a-node actions menu (Blender's node context menu). Same floating
// surface + viewport clamp + capture-phase outside-close as the Add-node palette,
// so the two read as one system. Actions are supplied by the editor; picking one
// runs it and closes.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type MenuAction = {
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  /** Shows a leading check (e.g. the current output node). */
  checked?: boolean
  onSelect: () => void
}

export function NodeContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: (MenuAction | "separator")[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(x, window.innerWidth - width - pad))
    const top = Math.max(pad, Math.min(y, window.innerHeight - height - pad))
    setPos({ left, top, ready: true })
  }, [x, y])

  // Capture phase — React Flow's pane stops bubbling pointer events (d3-zoom).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? 1 : 0 }}
      className="fixed z-50 w-44 rounded-xl border border-white/10 bg-zinc-950/90 p-1 shadow-float backdrop-blur-xs"
      onContextMenu={(e) => e.preventDefault()}
    >
      {actions.map((a, i) =>
        a === "separator" ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-white/10" />
        ) : (
          <button
            key={a.label}
            disabled={a.disabled}
            onClick={() => {
              a.onSelect()
              onClose()
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
              a.disabled
                ? "cursor-default text-muted-foreground/40"
                : a.danger
                  ? "text-red-400 hover:bg-red-400/10"
                  : "text-foreground/90 hover:bg-white/5",
            )}
          >
            {a.checked ? <Check className="size-3 shrink-0 text-blue-400" /> : <span className="size-3 shrink-0" />}
            <span className="flex-1">{a.label}</span>
            {a.shortcut && <span className="text-[10px] text-muted-foreground/50">{a.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
