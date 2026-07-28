"use client"

// Undo/redo over a piece of state the host already owns.

import { useCallback, useEffect, useRef, useState } from "react"

/** How long a burst of edits stays "the same step". Matches the graph editor. */
const SETTLE_MS = 300
const MAX_ENTRIES = 64

export function useHistory<T>(
  present: T,
  restoreState: (value: T) => void,
  opts?: {
    /** False while another surface owns undo — see the graph editor's `open` gate. */
    shortcutsEnabled?: boolean
  },
) {
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const current = useRef<T>(present)
  const restoring = useRef(false)
  // Mirrors the ref lengths into render so buttons can disable themselves.
  const [depth, setDepth] = useState({ undo: 0, redo: 0 })
  const sync = () => setDepth({ undo: past.current.length, redo: future.current.length })

  const restoreRef = useRef(restoreState)
  useEffect(() => {
    restoreRef.current = restoreState
  })

  useEffect(() => {
    if (restoring.current) {
      restoring.current = false
      return
    }
    const timer = setTimeout(() => {
      // Content compare: a re-render that didn't actually change the value (a new object
      if (JSON.stringify(present) === JSON.stringify(current.current)) return
      past.current.push(current.current)
      if (past.current.length > MAX_ENTRIES) past.current.shift()
      current.current = present
      future.current = [] // a fresh edit forks the timeline
      sync()
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [present])

  const restore = useCallback((value: T) => {
    restoring.current = true
    current.current = value
    restoreRef.current(value)
    sync()
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (prev === undefined) return
    future.current.push(current.current)
    restore(prev)
  }, [restore])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (next === undefined) return
    past.current.push(current.current)
    restore(next)
  }, [restore])

  const enabled = opts?.shortcutsEnabled ?? true
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return
      const el = e.target as HTMLElement
      // Text fields keep their native undo.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled, undo, redo])

  return { undo, redo, canUndo: depth.undo > 0, canRedo: depth.redo > 0 }
}
