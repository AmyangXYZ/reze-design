"use client"

// An edit becomes one of the scene's own files.
//
// reze-studio keeps its draft in a database of its own, because a clip there is
// the whole document. Here the scene IS the document, and a motion is already a
// slot in it — an AssetRef backed by a File, collected by scene-collect, written
// to IndexedDB by the same debounced effect that persists every other asset, and
// packed into the zip on export or publish.
//
// So this writes no store of its own. It re-encodes the edited clip as a VMD and
// hands it back as a File, and the pipeline that already carries an uploaded
// motion carries an edited one — which is also what makes an edit survive
// publishing rather than only surviving a reload. The viewer wears the motion
// the editor authored, for the same reason it wears the face.
//
// Three files, because the document has three slots: the motion, the expression
// VMD laid over it, and the camera. Whether the first two are one file or two is
// NOT this component's decision — it follows the scene. A scene whose morphs
// live inside its motion keeps them there; one that carries a separate
// expression file keeps that, or the morphs would be written twice and play
// twice.

import { useEffect, useRef } from "react"
import { VMDWriter } from "reze-engine"
import { useClipSelector } from "@/context/clip-editor"

/** Small, as asked. Long enough that a drag's worth of commits is one encode,
 *  short enough that closing the tab straight after an edit still keeps it.
 *  The asset pipeline downstream has its own 150ms settle, so the real cost of
 *  being wrong here is one extra encode, not one extra database write. */
const SETTLE_MS = 250

export type ClipSlotNames = {
  /** What to call the motion file. */
  motion: string
  /** What to call the expression file, or null when this scene keeps its morphs
   *  inside the motion — in which case the motion file carries them. */
  morph: string | null
}

export function ClipAutosave({
  slotNames,
  cameraName,
  onSaveMotion,
  onSaveCamera,
}: {
  slotNames: (modelId: string) => ClipSlotNames
  cameraName: string | null
  /** `morphs` is null when the scene keeps morphs in the motion file. */
  onSaveMotion: (modelId: string, motion: File, morphs: File | null) => void
  onSaveCamera: (file: File) => void
}) {
  const editRevision = useClipSelector((s) => s.editRevision)
  const clipSnapshot = useClipSelector((s) => s.clipSnapshot)
  const cameraSnapshot = useClipSelector((s) => s.cameraSnapshot)
  const modelId = useClipSelector((s) => s.modelId)

  // Everything the write needs but must not re-trigger on.
  const latest = useRef({ slotNames, cameraName, onSaveMotion, onSaveCamera })
  useEffect(() => {
    latest.current = { slotNames, cameraName, onSaveMotion, onSaveCamera }
  })

  // What has already been written. Identity, not content: both snapshots are
  // replaced wholesale on commit and never mutated, so a reference that has not
  // changed is a half that has not been edited — which is what keeps a bone
  // tweak from re-encoding a two-hundred-key camera track.
  const wroteClip = useRef(clipSnapshot)
  const wroteCamera = useRef(cameraSnapshot)

  useEffect(() => {
    // Only a real edit. `editRevision` is bumped by commits and never by loads,
    // which is the whole reason the store keeps two counters — writing on load
    // would hand the scene back a re-encoded copy of the file it just read.
    if (editRevision === 0) return
    const timer = setTimeout(() => {
      const { slotNames, cameraName, onSaveMotion, onSaveCamera } = latest.current
      const writer = new VMDWriter()

      if (clipSnapshot !== wroteClip.current) {
        wroteClip.current = clipSnapshot
        if (clipSnapshot && modelId) {
          const names = slotNames(modelId)
          // "all" when the scene has no separate expression slot — one file
          // holding bone and morph tracks, which is what MMD itself exports.
          const motion = new File(
            [writer.write(clipSnapshot, { tracks: names.morph ? "motion" : "all" })],
            names.motion,
            { type: "application/octet-stream" },
          )
          const morphs = names.morph
            ? new File([writer.write(clipSnapshot, { tracks: "morphs" })], names.morph, {
                type: "application/octet-stream",
              })
            : null
          onSaveMotion(modelId, motion, morphs)
        }
      }

      if (cameraSnapshot !== wroteCamera.current) {
        wroteCamera.current = cameraSnapshot
        // An empty track is a camera that was cleared, and writing a zero-key
        // VMD would leave the scene carrying a file that drives nothing. The
        // slot is cleared by the Clear operation itself, not from here.
        if (cameraSnapshot.length > 0) {
          onSaveCamera(
            new File([writer.writeCamera(cameraSnapshot)], cameraName ?? "camera.vmd", {
              type: "application/octet-stream",
            }),
          )
        }
      }
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [editRevision, clipSnapshot, cameraSnapshot, modelId])

  return null
}
