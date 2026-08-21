"use client"

// Undo and redo for keyframe edits.
//
// Headless, like ClipBridge. It owns no UI; what it installs is a handler in the
// undo registry, and the two surfaces that answer to it tag their roots with
// CLIP_UNDO_SCOPE. That is how this repo routes undo — one listener asking the
// DOM who the user is working in — rather than each editor adding a window
// listener and coordinating with booleans.
//
// ─── What a step is ───────────────────────────────────────────────────────
//
// A PATCH LIST: the keyframes that changed, each with the value it had and the
// value it got. Not a copy of the clip.
//
// It was copies first, and the arithmetic is why it is not any more. The bundled
// dance is 15,584 keyframes; a keyframe clones into sixteen objects, so one copy
// is 12.7MB and a hundred-step stack is 1.27GB — for edits that are usually a
// single keyframe. Now a step costs what the edit cost: about a kilobyte for a
// nudge, and the budget below is in megabytes rather than gigabytes.
//
// The patches are DERIVED, by diffing one baseline this component keeps, rather
// than reported by the code that made the edit. A dozen sites mutate a clip —
// two slider paths, the gizmo, four timeline drags, five operations — and a
// history that needs each of them to remember to file a report is one that goes
// quietly wrong when the thirteenth arrives. See lib/clip-diff.
//
// ─── Why not useHistory ───────────────────────────────────────────────────
//
// It holds one invariant this state cannot: that after `restoreState(value)` the
// host's present IS `value`. A clip cannot be handed back that way. Restoring
// goes through `commit`, which produces a new clip under a new revision — the
// revision is what the bridge watches to write back to the engine, so a restore
// that reused the old identity would restore the editor and not the viewport.
// The present after an undo therefore never equalled the entry that produced it,
// and the second undo pushed the just-restored state back, cleared the redo
// future, and popped what it had pushed. Undo worked once and stopped.

import { useCallback, useEffect, useRef } from "react"
import type { AnimationClip, CameraKeyframe } from "reze-engine"
import { useClipActions, useClipDocRef, useClipSelector } from "@/context/clip-editor"
import { cloneAnimationClip } from "@/lib/clip"
import {
  applyCameraPatches,
  applyClipPatches,
  diffCamera,
  diffClip,
  patchBytes,
  type ClipPatch,
} from "@/lib/clip-diff"
import { useUndoScope } from "@/hooks/use-undo-scope"

/** Tag the timeline and the properties dock with this so ⌘Z reaches them. */
export const CLIP_UNDO_SCOPE = "clip-editor"

/** How long a burst of commits stays one step. A slider drag commits once, on
 *  release, and needs none of this — the camera's sliders commit on every tick,
 *  and without coalescing one camera drag would be a hundred steps to undo. */
const SETTLE_MS = 300

/**
 * How far back it goes, and what it may spend getting there.
 *
 * Two limits because a step is no longer a fixed size. The count is what a
 * person expects of an undo stack; the budget is the backstop for the rare step
 * that is enormous — Simplify can drop fourteen thousand keyframes, and one of
 * those is worth more than a hundred nudges. Whichever is reached first evicts
 * from the far end.
 */
const MAX_ENTRIES = 200
const MAX_BYTES = 64 * 1024 * 1024

type Step = { patches: ClipPatch[]; bytes: number }

export function ClipHistory() {
  const editRevision = useClipSelector((s) => s.editRevision)
  const clipRevision = useClipSelector((s) => s.clipRevision)
  const cameraRevision = useClipSelector((s) => s.cameraRevision)
  const loadRevision = useClipSelector((s) => s.loadRevision)
  const clip = useClipSelector((s) => s.clip)
  const cameraTrack = useClipSelector((s) => s.cameraTrack)
  const modelId = useClipSelector((s) => s.modelId)
  const clipName = useClipSelector((s) => s.clipName)
  const { commit, commitCamera } = useClipActions()
  const doc = useClipDocRef()

  const past = useRef<Step[]>([])
  const future = useRef<Step[]>([])
  const bytes = useRef(0)

  /**
   * The document as of the last recorded step — what the next diff is taken
   * against.
   *
   * One copy, held for the session rather than per step, and kept current by
   * applying each step's patches to it instead of being re-cloned. That is the
   * whole memory argument: the baseline is the only full copy in here.
   */
  const base = useRef<{ clip: AnimationClip | null; camera: CameraKeyframe[] }>({ clip: null, camera: [] })

  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The revision a restore in flight will land at, or 0. Not a flag, which the
   *  second of two commits would outlive, and not a count, which React's
   *  batching of two synchronous store writes into one effect run would leave
   *  standing. A revision is monotonic and +1 per commit, so "everything up to R
   *  is mine" holds however those commits arrive. */
  const restoreUntil = useRef(0)

  const rebase = useCallback(() => {
    const st = doc.getState()
    base.current = {
      clip: st.clip ? cloneAnimationClip(st.clip) : null,
      camera: st.cameraTrack.map((kf) => ({ ...kf })),
    }
  }, [doc])

  /** Close the open step: diff what the document is now against the baseline. */
  const record = useCallback(() => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    const st = doc.getState()
    const patches = [...diffClip(base.current.clip, st.clip), ...diffCamera(base.current.camera, st.cameraTrack)]
    if (patches.length === 0) return
    past.current.push({ patches, bytes: patchBytes(patches) })
    bytes.current += patchBytes(patches)
    while (past.current.length > MAX_ENTRIES || (bytes.current > MAX_BYTES && past.current.length > 1)) {
      const dropped = past.current.shift()
      if (dropped) bytes.current -= dropped.bytes
    }
    // A fresh edit forks the timeline.
    future.current = []
    rebase()
  }, [doc, rebase])

  // A clip ARRIVING is not an edit. Reset against it — undoing one character's
  // motion onto another's is the failure this prevents.
  const clipKey = `${modelId ?? ""}\0${clipName ?? ""}`
  const seenKey = useRef<string | null>(null)
  useEffect(() => {
    if (seenKey.current === clipKey && loadRevision === 0) return
    seenKey.current = clipKey
    past.current = []
    future.current = []
    bytes.current = 0
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    rebase()
    // loadRevision so a re-read of the same clip (a motion swap under the same
    // name) also re-baselines; clipKey so a different clip always does.
  }, [clipKey, loadRevision, rebase])

  useEffect(() => {
    // Only a real edit. `editRevision` is bumped by commits and never by loads,
    // which is why the store keeps the two counters apart.
    if (editRevision === 0) return
    // Our own restore landing — the baseline was already moved to match it.
    if (restoreUntil.current > 0 && editRevision <= restoreUntil.current) {
      if (editRevision === restoreUntil.current) restoreUntil.current = 0
      return
    }
    settle.current = setTimeout(record, SETTLE_MS)
    return () => {
      if (settle.current) clearTimeout(settle.current)
      settle.current = null
    }
    // clip/cameraTrack identities are what a commit changes; the revisions are
    // what says a commit happened at all.
  }, [editRevision, clipRevision, cameraRevision, clip, cameraTrack, record])

  const applyStep = useCallback(
    (step: Step, dir: "undo" | "redo") => {
      const st = doc.getState()
      const hasClip = step.patches.some((p) => p.kind !== "camera")
      const hasCamera = step.patches.some((p) => p.kind === "camera")
      restoreUntil.current = st.editRevision + (hasClip && st.clip ? 1 : 0) + (hasCamera ? 1 : 0)
      // Through `commit`, not `replaceClip`: the latter bumps `loadRevision`,
      // which the editor resets its zoom, scroll and drafts on — undoing a
      // keyframe move would throw away where you were looking in order to show
      // you the result.
      if (hasClip && st.clip) commit(applyClipPatches(st.clip, step.patches, dir))
      if (hasCamera) commitCamera(applyCameraPatches(st.cameraTrack, step.patches, dir))
      // The baseline moves with the document, so the next diff is against what
      // is actually there rather than against the state we just left.
      rebase()
    },
    [doc, commit, commitCamera, rebase],
  )

  const undo = useCallback(() => {
    // Close the open step first: an edit taken back inside the settle window is
    // the case the debounce would otherwise swallow whole — the keystroke would
    // find nothing to undo, and the edit would be recorded a moment later.
    record()
    const step = past.current.pop()
    if (!step) return
    bytes.current -= step.bytes
    future.current.push(step)
    applyStep(step, "undo")
  }, [record, applyStep])

  const redo = useCallback(() => {
    const step = future.current.pop()
    if (!step) return
    past.current.push(step)
    bytes.current += step.bytes
    applyStep(step, "redo")
  }, [applyStep])

  useUndoScope(CLIP_UNDO_SCOPE, { undo, redo }, {
    // Nothing loaded, nothing to take back — and an enabled scope with an empty
    // stack would swallow ⌘Z from whatever the user is actually in.
    enabled: clip != null || cameraTrack.length > 0,
  })

  return null
}
