"use client"

// Undo and redo for keyframe edits.
//
// The store has been keeping `clipSnapshot` and `cameraSnapshot` since the
// timeline landed, for exactly this: a keyframe drag mutates the live clip in
// place — that is what keeps a drag off React entirely — so the clean copy for
// a history stack has to be taken at commit time rather than derived afterwards.
//
// Headless, like ClipBridge. It owns no UI; what it installs is a handler in the
// undo registry, and the two surfaces that answer to it tag their roots with
// CLIP_UNDO_SCOPE. That is how this repo routes undo — one listener asking the
// DOM who the user is working in — rather than each editor adding a window
// listener and coordinating with booleans.
//
// ─── Why not useHistory ───────────────────────────────────────────────────
//
// It was built on useHistory first, and useHistory holds one invariant this
// state cannot: that after `restoreState(value)` the host's present IS `value`.
// A clip cannot be handed back that way. Restoring goes through `commit`, which
// mints a fresh clone and a new revision — the revision is what the bridge
// watches to write the clip back to the engine, so a restore that reused the old
// identity would restore the editor and not the viewport.
//
// So the present after an undo never equalled the entry that produced it. The
// next undo compared them, decided an edit had happened, pushed the just-
// restored state back onto the stack, cleared the redo future, and then popped
// the very entry it had pushed — restoring the same state again. From the
// outside: undo works once and then stops, and redo never works at all. The
// stack was fine; the equality test underneath it was answering a question about
// a different kind of state.
//
// Here the stack is ours, so identity is the test — snapshots are replaced
// wholesale by the store and never mutated, so two references being equal IS
// two states being the same one — and a restore simply declares itself.

import { useCallback, useEffect, useRef } from "react"
import type { AnimationClip, CameraKeyframe } from "reze-engine"
import { useClipActions, useClipDocRef, useClipSelector } from "@/context/clip-editor"
import { cloneAnimationClip } from "@/lib/clip"
import { useUndoScope } from "@/hooks/use-undo-scope"

/** Tag the timeline and the properties dock with this so ⌘Z reaches them. */
export const CLIP_UNDO_SCOPE = "clip-editor"

/** How long a burst of commits stays one step. A slider drag commits once, on
 *  release, and needs none of this — the camera's sliders commit on every tick,
 *  and without coalescing one camera drag would be a hundred steps to undo. */
const SETTLE_MS = 300

/**
 * How far back it goes.
 *
 * Not unbounded, and the reason is size rather than taste: every entry holds a
 * whole clip, and a dense three-minute dance clones into megabytes. A hundred of
 * those is already hundreds of megabytes held against a session that may never
 * ask for the oldest of them. reze-studio's own stack stopped at the same
 * number.
 */
const MAX_ENTRIES = 100

type Snapshot = { clip: AnimationClip | null; camera: CameraKeyframe[] }

export function ClipHistory() {
  const editRevision = useClipSelector((s) => s.editRevision)
  const clipSnapshot = useClipSelector((s) => s.clipSnapshot)
  const cameraSnapshot = useClipSelector((s) => s.cameraSnapshot)
  const modelId = useClipSelector((s) => s.modelId)
  const clipName = useClipSelector((s) => s.clipName)
  const { commit, commitCamera } = useClipActions()
  const doc = useClipDocRef()

  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const current = useRef<Snapshot>({ clip: clipSnapshot, camera: cameraSnapshot })
  /** What the store holds right now, which during a settle is ahead of `current`.
   *  Its own literal rather than a read of `current` — a ref read during render
   *  is what this repo's lint forbids, and the two are compared field by field
   *  anyway, never by object identity. */
  const latest = useRef<Snapshot>({ clip: clipSnapshot, camera: cameraSnapshot })
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The revision a restore in flight will have landed at, or 0.
   *
   * Not a flag and not a count. A flag is spent on the first of the two commits
   * a step that moved both a bone and the camera issues — the second would then
   * be recorded as a fresh edit, clearing the redo future. A count fails the
   * other way: React batches two synchronous store writes into ONE effect run,
   * so the count would be left standing and would swallow the next genuine edit.
   *
   * The revision is immune to both. It is monotonic and each commit bumps it by
   * exactly one, so "everything up to R belongs to the restore" is true whether
   * those commits arrive as two effect runs or one.
   */
  const restoreUntil = useRef(0)

  // WHICH clip. Switching model or motion starts a fresh stack — undoing one
  // character's edit onto another is the failure this prevents.
  const resetKey = `${modelId ?? ""}\0${clipName ?? ""}`
  const seenKey = useRef(resetKey)

  /** Close the open step. */
  const record = useCallback(() => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    const value = latest.current
    // Identity, because snapshots are replaced wholesale and never mutated.
    if (value.clip === current.current.clip && value.camera === current.current.camera) return
    past.current.push(current.current)
    if (past.current.length > MAX_ENTRIES) past.current.shift()
    current.current = value
    // A fresh edit forks the timeline.
    future.current = []
  }, [])

  useEffect(() => {
    const snap: Snapshot = { clip: clipSnapshot, camera: cameraSnapshot }
    latest.current = snap

    if (seenKey.current !== resetKey) {
      seenKey.current = resetKey
      past.current = []
      future.current = []
      current.current = snap
      return
    }
    // Our own restore landing. The store's copy — a fresh clone under a new
    // revision — becomes the state the next comparison is made against, which
    // is the whole repair: comparing against the ENTRY instead is what made the
    // second undo push the state it had just restored.
    if (restoreUntil.current > 0 && editRevision <= restoreUntil.current) {
      if (editRevision === restoreUntil.current) restoreUntil.current = 0
      current.current = snap
      return
    }
    // A load, not an edit: `editRevision` is bumped by commits and never by
    // loads, which is why the store keeps two counters.
    if (editRevision === 0) {
      current.current = snap
      return
    }
    settle.current = setTimeout(record, SETTLE_MS)
    return () => {
      if (settle.current) clearTimeout(settle.current)
      settle.current = null
    }
  }, [clipSnapshot, cameraSnapshot, editRevision, resetKey, record])

  const applyRestore = useCallback(
    (snap: Snapshot) => {
      const state = doc.getState()
      const clipMoved = snap.clip !== state.clipSnapshot
      const cameraMoved = snap.camera !== state.cameraSnapshot
      // Nothing to put back — keep the pointer honest anyway, or the next
      // comparison is made against a state that is no longer current.
      if (!clipMoved && !cameraMoved) {
        current.current = snap
        return
      }
      restoreUntil.current = state.editRevision + (clipMoved ? 1 : 0) + (cameraMoved ? 1 : 0)
      // Through `commit`, not `replaceClip`. Both put a clip in the store, but
      // replaceClip bumps `loadRevision` — which the editor treats as a NEW clip
      // arriving and resets its zoom, scroll and drafts on. Undoing a keyframe
      // move would throw away where you were looking in order to show you the
      // result.
      //
      // Cloned on the way out: `commit` hands the object to the store, where the
      // next drag mutates it in place, and an uncloned restore would let that
      // drag edit the history entry it came from.
      if (clipMoved) commit(snap.clip ? cloneAnimationClip(snap.clip) : null)
      if (cameraMoved) commitCamera(snap.camera.map((kf) => ({ ...kf })))
    },
    [commit, commitCamera, doc],
  )

  const undo = useCallback(() => {
    // Close the open step first: an edit taken back inside the settle window is
    // the case the debounce would otherwise swallow whole — the keystroke would
    // find nothing to undo, and the edit would be recorded a moment later.
    record()
    const prev = past.current.pop()
    if (prev === undefined) return
    future.current.push(current.current)
    applyRestore(prev)
  }, [record, applyRestore])

  const redo = useCallback(() => {
    record()
    const next = future.current.pop()
    if (next === undefined) return
    past.current.push(current.current)
    applyRestore(next)
  }, [record, applyRestore])

  useUndoScope(CLIP_UNDO_SCOPE, { undo, redo }, {
    // Nothing loaded, nothing to take back — and an enabled scope with an empty
    // stack would swallow ⌘Z from whatever the user is actually in.
    enabled: clipSnapshot != null || cameraSnapshot.length > 0,
  })

  return null
}
