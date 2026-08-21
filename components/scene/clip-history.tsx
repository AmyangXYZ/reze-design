"use client"

// Undo and redo for keyframe edits.
//
// The store has been keeping `clipSnapshot` and `cameraSnapshot` since the
// timeline landed, for exactly this and nothing else: a keyframe drag mutates
// the live clip in place — that is what keeps a drag off React entirely — so
// the clean copy for a history stack has to be taken at commit time rather than
// derived afterwards. This is the stack they were waiting for.
//
// Headless, like ClipBridge. It owns no UI; what it installs is a handler in
// the undo registry, and the two surfaces that should answer to it tag their
// roots with CLIP_UNDO_SCOPE. That is how this repo routes undo — one listener
// asking the DOM who the user is working in — rather than each editor adding a
// window listener and coordinating with booleans.

import { useCallback, useMemo } from "react"
import type { AnimationClip, CameraKeyframe } from "reze-engine"
import { useClipActions, useClipDocRef, useClipSelector } from "@/context/clip-editor"
import { cloneAnimationClip } from "@/lib/clip"
import { useHistory } from "@/hooks/use-history"

/** Tag the timeline and the properties dock with this so ⌘Z reaches them. */
export const CLIP_UNDO_SCOPE = "clip-editor"

/**
 * One undoable state.
 *
 * `rev` is first and it is load-bearing: useHistory compares entries with
 * JSON.stringify, and an AnimationClip keeps its tracks in Maps, which
 * stringify to `{}`. Two completely different clips would compare equal and
 * nothing would ever be recorded. The revision counter is the identity the
 * store already maintains for "the document changed", so it is what makes the
 * comparison mean anything.
 */
type Snapshot = { rev: number; clip: AnimationClip | null; camera: CameraKeyframe[] }

export function ClipHistory() {
  const editRevision = useClipSelector((s) => s.editRevision)
  const clipSnapshot = useClipSelector((s) => s.clipSnapshot)
  const cameraSnapshot = useClipSelector((s) => s.cameraSnapshot)
  const modelId = useClipSelector((s) => s.modelId)
  const clipName = useClipSelector((s) => s.clipName)
  const { commit, commitCamera } = useClipActions()
  const doc = useClipDocRef()

  const present = useMemo<Snapshot>(
    () => ({ rev: editRevision, clip: clipSnapshot, camera: cameraSnapshot }),
    [editRevision, clipSnapshot, cameraSnapshot],
  )

  const restore = useCallback(
    (snap: Snapshot) => {
      // Through `commit`, not `replaceClip`. Both put a clip in the store, but
      // replaceClip bumps `loadRevision` — which the editor treats as a NEW
      // clip arriving and resets its zoom, scroll and drafts on. Undoing a
      // keyframe move would throw away where you were looking to show you the
      // result. commit bumps `editRevision` instead, which is what the bridge
      // watches, so the engine gets the restored clip and the view stays put.
      //
      // Only the half that actually moved: a bone edit and a camera edit share
      // one revision counter, and committing both would write the clip back
      // twice and re-seek the scene for the half that had not changed.
      const state = doc.getState()
      if (snap.clip !== state.clipSnapshot) {
        // Cloned on the way out. `commit` hands the object straight to the
        // store, where the next drag mutates it in place — an uncloned restore
        // would let that drag edit the history entry it came from, and undoing
        // twice would land on a state that had been quietly rewritten.
        commit(snap.clip ? cloneAnimationClip(snap.clip) : null)
      }
      if (snap.camera !== state.cameraSnapshot) {
        commitCamera(snap.camera.map((kf) => ({ ...kf })))
      }
    },
    [commit, commitCamera, doc],
  )

  useHistory(present, restore, {
    scope: CLIP_UNDO_SCOPE,
    // Nothing loaded, nothing to take back — and an enabled scope with an empty
    // stack would swallow ⌘Z from whatever the user is actually in.
    enabled: clipSnapshot != null || cameraSnapshot.length > 0,
    // WHICH clip, so switching model or motion starts a fresh stack. Undoing
    // one character's edit onto another is the failure this prevents.
    resetKey: `${modelId ?? ""}\0${clipName ?? ""}`,
  })

  return null
}
