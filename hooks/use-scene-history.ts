"use client"

// The editor's side of lib/scene-history: feeds it the scene as it changes,
// puts a step back when asked, and gives ⌘Z to it when no editor holds the key.
//
// Recording is by OBSERVATION, the way autosave already watches the same slice:
// every edit path — a slider, a palette command, a library pick, the AI — lands
// in the same state, so watching it catches them all without each one having to
// remember to commit.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { SceneHistory, changedParts, type HistoryStep, type SceneSnapshot } from "@/lib/scene-history"
import { useUndoScope } from "@/hooks/use-undo-scope"

/** How long after a scene opens, or a model or stage arrives, changes count as
 *  setup rather than edits: a stage sets its own sun and lamps as it lands. */
const SETTLE_MS = 1500
/** Give up waiting for a restore to land after this long — a part that cannot
 *  be put back (a model removed since) must not freeze recording. */
const RESTORE_MS = 1500

export function useSceneHistory({
  scene,
  active,
  snapshot,
  castKey,
  modelName,
  restore,
}: {
  /** The open scene's identity: a new one starts a fresh history. */
  scene: unknown
  /** Whether the scene is loaded enough to edit; nothing records before. */
  active: boolean
  snapshot: SceneSnapshot
  /** The cast and stages present, as one string: a change opens a settle window. */
  castKey: string
  modelName: (id: string) => string
  /** Put the editor back to `target` from `current`, through the usual paths. */
  restore: (target: SceneSnapshot, current: SceneSnapshot) => void
}) {
  const [history] = useState(() => new SceneHistory())
  const settleUntil = useRef(0)
  const restoring = useRef<{ target: SceneSnapshot; until: number } | null>(null)
  // Read by undo and redo, which run from a key press — never during render.
  const current = useRef(snapshot)
  const restoreRef = useRef(restore)
  useEffect(() => {
    current.current = snapshot
    restoreRef.current = restore
    history.setModelName(modelName)
  })

  // A different scene: nothing from the last one can be undone into this one.
  useEffect(() => {
    history.reset()
    settleUntil.current = Date.now() + SETTLE_MS
  }, [scene, history])

  useEffect(() => {
    settleUntil.current = Date.now() + SETTLE_MS
  }, [castKey, active])

  useEffect(() => {
    if (!active) return
    const now = Date.now()
    const r = restoring.current
    if (r) {
      // Mid-restore: the parts land over several renders. Track them without
      // recording, and stop once the editor matches the step (or time runs out).
      history.rebase(snapshot)
      if (changedParts(snapshot, r.target).length === 0 || now > r.until) restoring.current = null
      return
    }
    if (now < settleUntil.current || !history.baseline) {
      history.rebase(snapshot)
      return
    }
    history.observe(snapshot, now)
  }, [snapshot, active, history])

  const apply = useCallback((target: SceneSnapshot | null) => {
    if (!target) return
    restoring.current = { target, until: Date.now() + RESTORE_MS }
    restoreRef.current(target, current.current)
  }, [])

  const undo = useCallback(() => apply(history.undo()), [apply, history])
  const redo = useCallback(() => apply(history.redo()), [apply, history])

  // The fallback scope: ⌘Z lands here whenever no open editor holds it.
  useUndoScope("scene", { undo, redo }, { enabled: active, fallback: true })

  const version = useSyncExternalStore(
    useCallback((fn: () => void) => history.subscribe(fn), [history]),
    () => stamp(history.peekUndo(), history.peekRedo()),
    () => "",
  )

  return {
    history,
    undo,
    redo,
    /** "Sun", "Kaguya materials"… — what undo and redo would take back. */
    undoLabel: history.peekUndo()?.label ?? null,
    redoLabel: history.peekRedo()?.label ?? null,
    /** Several changes as one step, for a caller that makes them in a batch. */
    begin: (label?: string) => history.begin(label ?? null),
    end: () => history.end(),
    version,
  }
}

const stamp = (u: HistoryStep | null, r: HistoryStep | null) => `${u?.at ?? ""}|${u?.label ?? ""}|${r?.at ?? ""}|${r?.label ?? ""}`
