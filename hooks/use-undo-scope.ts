"use client"

// Routes ⌘/Ctrl+Z and ⇧⌘/Ctrl+Z to whichever editor the user is actually working in.
//
// Every editor used to install its own window listener and coordinate with ad-hoc
// booleans ("not while the drawer is open"), which stops working the moment there
// are more than two of them. Instead each scope tags its root with
// `data-undo-scope` and ONE listener asks the DOM who should handle the key —
// focus first, then whatever the user last clicked into. The DOM already knows
// where the user is; nothing has to track it.

import { useEffect, useRef } from "react"

export type UndoHandlers = { undo: () => void; redo: () => void }

const REGISTRY = new Map<string, { current: UndoHandlers }>()
/** Where undo goes when nothing is focused — the page's own state. */
let fallbackScope: string | null = null
/** Last scope the user clicked into; `document.activeElement` is <body> for the
 *  non-focusable divs most of this UI is built from. */
let lastScope: string | null = null
let installed = false

const scopeOf = (el: Element | null): string | null =>
  (el?.closest?.("[data-undo-scope]") as HTMLElement | null)?.dataset.undoScope ?? null

function install() {
  if (installed || typeof window === "undefined") return
  installed = true

  document.addEventListener(
    "pointerdown",
    (e) => {
      const s = scopeOf(e.target as Element)
      if (s) lastScope = s
    },
    true,
  )

  window.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
    const el = e.target as HTMLElement
    // Text fields keep their native undo — the WGSL editor is a real <textarea>,
    // and hijacking it would make code editing worse, not better.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return
    const id = scopeOf(document.activeElement) ?? lastScope ?? fallbackScope
    const handlers = id ? REGISTRY.get(id) : undefined
    if (!handlers) return
    e.preventDefault()
    if (e.shiftKey) handlers.current.redo()
    else handlers.current.undo()
  })
}

/**
 * Register an undo scope. Spread the return value onto the scope's root element:
 * `<div {...useUndoScope("grade", { undo, redo })}>`.
 */
export function useUndoScope(
  id: string,
  handlers: UndoHandlers,
  opts?: { enabled?: boolean; fallback?: boolean },
): { "data-undo-scope"?: string } {
  const enabled = opts?.enabled ?? true
  const isFallback = opts?.fallback ?? false
  // Handlers change identity every render; the listener reads through this ref so
  // it never calls a stale closure.
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    if (!enabled) return
    install()
    REGISTRY.set(id, ref)
    if (isFallback) fallbackScope = id
    return () => {
      REGISTRY.delete(id)
      // A closed editor must not keep receiving undo.
      if (lastScope === id) lastScope = null
      if (fallbackScope === id) fallbackScope = null
    }
  }, [id, enabled, isFallback])

  return enabled ? { "data-undo-scope": id } : {}
}
