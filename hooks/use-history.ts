"use client"

// Undo/redo over a piece of state the host already owns.

import { useCallback, useEffect, useRef, useState } from "react"
import { useUndoScope } from "@/hooks/use-undo-scope"

/** How long a burst of edits stays "the same step". Matches the graph editor. */
const SETTLE_MS = 300
const MAX_ENTRIES = 64

export function useHistory<T>(
  present: T,
  restoreState: (value: T) => void,
  opts?: {
    /** Undo-scope id. Spread the returned `scopeProps` onto the surface's root so
     *  the keystroke reaches this history only while the user is working in it. */
    scope?: string
    enabled?: boolean
    /** Receives undo when nothing else is focused. */
    fallback?: boolean
    /** Clears the timeline when it changes. Pass the identity of whatever the
     *  history is ABOUT (the active model, say) so switching subjects can't undo
     *  one subject's edit onto another. */
    resetKey?: string | number | null
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

  const resetKey = opts?.resetKey
  const seenKey = useRef(resetKey)

  useEffect(() => {
    // A new subject (a different model's groups, say) re-baselines rather than
    // recording — otherwise undo would apply one subject's edit onto another.
    if (seenKey.current !== resetKey) {
      seenKey.current = resetKey
      past.current = []
      future.current = []
      current.current = present
      return
    }
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
  }, [present, resetKey])

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

  const scopeProps = useUndoScope(opts?.scope ?? "page", { undo, redo }, {
    enabled: opts?.enabled ?? true,
    fallback: opts?.fallback,
  })

  return { undo, redo, canUndo: depth.undo > 0, canRedo: depth.redo > 0, scopeProps }
}
