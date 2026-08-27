"use client"

// What the inspector's Operations block does to a track.
//
// Ported from reze-studio, where these five sit in <Studio> and are handed to
// the properties panel as props. There is no equivalent host here — <Home> is
// outside the clip provider and six thousand lines long — so they are a hook
// instead, which is also the honest shape: every one of them is a function of
// the clip and the selection, and both live in the store.
//
// All five go through `commit`, never through the engine directly. That is what
// puts them in the write-back path (clip-bridge's COMMIT effect) and what makes
// each one a single undoable step rather than a mutation nobody recorded.

import { useCallback } from "react"
import type { BoneKeyframe, CameraKeyframe, MorphKeyframe } from "reze-engine"
import { Vec3 } from "reze-engine"
import { useClipActions, useClipEngine, useClipSelector, usePlayheadFrameRef } from "@/context/clip-editor"
import { cloneBoneInterpolation, interpolationTemplateForFrame, simplifyBoneTrack, upsertMorphKeyframeAtFrame } from "@/lib/clip"

export type ClipOps = {
  insertKeyframeAtPlayhead: () => void
  deleteSelectedKeyframes: () => void
  /** Snapshot the selected keyframes (frames kept relative to the earliest). */
  copySelectedKeyframes: () => void
  /** Insert the snapshot with its earliest frame at the playhead, replacing
   *  any keyframe already on a landing frame. */
  pasteAtPlayhead: () => void
  /** Copy, then delete — one undoable step (the copy touches no history). */
  cutSelectedKeyframes: () => void
  simplifySelectedBoneTrack: () => void
  clearSelectedTrack: () => void
  clearCameraTrack: () => void
  /** Which of the above mean anything right now. The buttons go inert rather
   *  than vanishing — an Operations block that changes shape as you select
   *  things is a block you have to re-find every time. */
  canInsert: boolean
  canDelete: boolean
  canCopy: boolean
  canPaste: boolean
  canSimplify: boolean
  canClear: boolean
}

// Module-level, deliberately: the clipboard outlives the panel that copied
// into it, so a copy survives closing the editor or switching models. Frames
// are stored relative to the earliest copied frame; paste re-bases at the
// playhead. Everything is deep-cloned on the way in AND out — the live drag
// path mutates keyframes in place, and a clipboard that shares objects with
// the track would be silently rewritten by the next drag.
type ClipClipboard = {
  bones: Array<{ bone: string; rel: number; kf: BoneKeyframe }>
  morphs: Array<{ morph: string; rel: number; kf: MorphKeyframe }>
  camera: Array<{ rel: number; kf: CameraKeyframe }>
}
let clipboard: ClipClipboard | null = null

const cloneBoneKf = (k: BoneKeyframe): BoneKeyframe => ({
  boneName: k.boneName,
  frame: k.frame,
  rotation: k.rotation.clone(),
  translation: new Vec3(k.translation.x, k.translation.y, k.translation.z),
  interpolation: cloneBoneInterpolation(k.interpolation),
})
const cloneMorphKf = (k: MorphKeyframe): MorphKeyframe => ({ morphName: k.morphName, frame: k.frame, weight: k.weight })
const cloneCameraKf = (k: CameraKeyframe): CameraKeyframe => ({
  frame: k.frame,
  distance: k.distance,
  target: new Vec3(k.target.x, k.target.y, k.target.z),
  rotation: new Vec3(k.rotation.x, k.rotation.y, k.rotation.z),
  fov: k.fov,
  interpolation: k.interpolation ? new Uint8Array(k.interpolation) : undefined,
})

export function useClipOps(): ClipOps {
  const clip = useClipSelector((s) => s.clip)
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const selectedMorph = useClipSelector((s) => s.selectedMorph)
  const selectedKeyframes = useClipSelector((s) => s.selectedKeyframes)
  const cameraTrack = useClipSelector((s) => s.cameraTrack)
  const { commit, commitCamera, setSelectedKeyframes } = useClipActions()
  const engine = useClipEngine()
  // Read inside the callbacks, never subscribed to: an Operations block that
  // re-rendered on every frame of playback would be sixty renders a second for
  // four buttons whose labels never change.
  const frameRef = usePlayheadFrameRef()

  const frameNow = useCallback(
    () => Math.round(Math.max(0, Math.min(clip?.frameCount ?? 0, frameRef.current))),
    [clip, frameRef],
  )

  /** Key the pose that is already showing. Inserting therefore changes nothing
   *  on its own — that is the point: it pins this moment so an edit elsewhere
   *  cannot drag it along. */
  const insertKeyframeAtPlayhead = useCallback(() => {
    if (!clip) return
    const frame = frameNow()

    if (selectedMorph && !selectedBone) {
      // The live interpolated weight, whatever the viewport is showing.
      const w = engine.current?.morphWeight(selectedMorph) ?? 0
      commit(upsertMorphKeyframeAtFrame(clip, selectedMorph, frame, w))
      setSelectedKeyframes([{ type: "curve", morph: selectedMorph, frame }])
      return
    }
    if (!selectedBone) return
    // Seeked first: the runtime skeleton is only at this frame if something put
    // it there, and while paused nothing has.
    const pose = engine.current?.samplePose(selectedBone, frame)
    if (!pose) return

    // Not upsertBoneKeyframeAtFrame, though it exists and does almost this: the
    // interpolation of a NEW key has to be templated from its neighbours (an
    // abrupt linear key in the middle of an eased track is a visible hitch),
    // and replacing an existing one has to keep the curve already authored on
    // it. That helper keeps the existing curve but templates from the track
    // rather than from the surrounding pair, which is the same thing everywhere
    // except at the ends.
    const prevTrack = clip.boneTracks.get(selectedBone)
    const nextTrack = [...(prevTrack ?? [])].filter((k) => k.frame !== frame)
    nextTrack.push({
      boneName: selectedBone,
      frame,
      rotation: pose.rotation,
      translation: pose.translation,
      interpolation: interpolationTemplateForFrame(prevTrack, frame),
    })
    nextTrack.sort((a, b) => a.frame - b.frame)
    const boneTracks = new Map(clip.boneTracks)
    boneTracks.set(selectedBone, nextTrack)
    commit({ ...clip, boneTracks })
    setSelectedKeyframes([{ type: "curve", bone: selectedBone, frame, channel: "rx" }])
  }, [clip, selectedBone, selectedMorph, commit, setSelectedKeyframes, engine, frameNow])

  /**
   * Delete every selected keyframe.
   *
   * The selection carries what it is: a curve handle names its bone or its
   * morph, a dopesheet diamond names only a frame — because a dope row IS every
   * track at that frame, and deleting one there means deleting the column.
   * reze-studio reads the timeline's tab to tell those apart; the selection
   * already says, so this asks it instead.
   */
  const deleteSelectedKeyframes = useCallback(() => {
    if (selectedKeyframes.length === 0) return
    const sel = selectedKeyframes
    setSelectedKeyframes([])

    // Camera entries live in their own track with their own commit; a mixed
    // selection cannot happen from the UI (the tab decides what is clickable),
    // but each half is handled on its own terms anyway.
    const camFrames = new Set(sel.filter((s) => s.camera).map((s) => s.frame))
    if (camFrames.size > 0) commitCamera((t) => t.filter((k) => !camFrames.has(k.frame)))

    const rest = sel.filter((s) => !s.camera)
    if (!clip || rest.length === 0) return
    commit((prev) => {
      if (!prev) return prev
      const boneTracks = new Map(prev.boneTracks)
      const morphTracks = new Map(prev.morphTracks)

      const dropBone = (bone: string, frame: number) => {
        const track = boneTracks.get(bone)
        if (!track) return
        const next = track.filter((k) => k.frame !== frame)
        if (next.length === track.length) return
        if (next.length === 0) boneTracks.delete(bone)
        else boneTracks.set(bone, next)
      }
      const dropMorph = (morph: string, frame: number) => {
        const track = morphTracks.get(morph)
        if (!track) return
        const next = track.filter((k) => k.frame !== frame)
        if (next.length === track.length) return
        if (next.length === 0) morphTracks.delete(morph)
        else morphTracks.set(morph, next)
      }

      for (const s of rest) {
        if (s.morph) {
          dropMorph(s.morph, s.frame)
        } else if (s.bone) {
          dropBone(s.bone, s.frame)
        } else if (s.type === "dope") {
          // The column. A morph row is selected on its own, so a dope hit while
          // a morph is what you are editing means that morph's key.
          if (selectedMorph) dropMorph(selectedMorph, s.frame)
          else for (const name of [...boneTracks.keys()]) dropBone(name, s.frame)
        }
      }
      return { ...prev, boneTracks, morphTracks }
    })
  }, [clip, selectedKeyframes, selectedMorph, commit, commitCamera, setSelectedKeyframes])

  /**
   * Copy the selection. The selection carries what it is, same as delete: a
   * curve handle names its bone or morph, a dope diamond means the whole
   * column at that frame — every track that keys there.
   */
  const copySelectedKeyframes = useCallback(() => {
    if (selectedKeyframes.length === 0) return
    const next: ClipClipboard = { bones: [], morphs: [], camera: [] }

    for (const s of selectedKeyframes) {
      if (s.camera) {
        const kf = cameraTrack.find((k) => k.frame === s.frame)
        if (kf) next.camera.push({ rel: kf.frame, kf: cloneCameraKf(kf) })
      } else if (s.morph) {
        const kf = clip?.morphTracks.get(s.morph)?.find((k) => k.frame === s.frame)
        if (kf) next.morphs.push({ morph: s.morph, rel: kf.frame, kf: cloneMorphKf(kf) })
      } else if (s.bone) {
        const kf = clip?.boneTracks.get(s.bone)?.find((k) => k.frame === s.frame)
        if (kf) next.bones.push({ bone: s.bone, rel: kf.frame, kf: cloneBoneKf(kf) })
      } else if (s.type === "dope" && clip) {
        if (selectedMorph) {
          const kf = clip.morphTracks.get(selectedMorph)?.find((k) => k.frame === s.frame)
          if (kf) next.morphs.push({ morph: selectedMorph, rel: kf.frame, kf: cloneMorphKf(kf) })
        } else {
          for (const [bone, track] of clip.boneTracks) {
            const kf = track.find((k) => k.frame === s.frame)
            if (kf) next.bones.push({ bone, rel: kf.frame, kf: cloneBoneKf(kf) })
          }
        }
      }
    }

    const frames = [...next.bones, ...next.morphs, ...next.camera].map((e) => e.rel)
    if (frames.length === 0) return
    const base = Math.min(...frames)
    for (const e of next.bones) e.rel -= base
    for (const e of next.morphs) e.rel -= base
    for (const e of next.camera) e.rel -= base
    clipboard = next
  }, [clip, cameraTrack, selectedKeyframes, selectedMorph])

  const pasteAtPlayhead = useCallback(() => {
    if (!clipboard) return
    const cb = clipboard
    const base = frameNow()

    if (cb.camera.length > 0) {
      commitCamera((prev) => {
        const landing = new Set(cb.camera.map((e) => base + e.rel))
        const next = prev.filter((k) => !landing.has(k.frame))
        for (const e of cb.camera) next.push({ ...cloneCameraKf(e.kf), frame: base + e.rel })
        return next
      })
    }

    if (cb.bones.length > 0 || cb.morphs.length > 0) {
      if (!clip) return
      commit((prev) => {
        if (!prev) return prev
        const boneTracks = new Map(prev.boneTracks)
        const morphTracks = new Map(prev.morphTracks)
        for (const e of cb.bones) {
          const frame = base + e.rel
          const track = (boneTracks.get(e.bone) ?? []).filter((k) => k.frame !== frame)
          track.push({ ...cloneBoneKf(e.kf), frame })
          track.sort((a, b) => a.frame - b.frame)
          boneTracks.set(e.bone, track)
        }
        for (const e of cb.morphs) {
          const frame = base + e.rel
          const track = (morphTracks.get(e.morph) ?? []).filter((k) => k.frame !== frame)
          track.push({ ...cloneMorphKf(e.kf), frame })
          track.sort((a, b) => a.frame - b.frame)
          morphTracks.set(e.morph, track)
        }
        return { ...prev, boneTracks, morphTracks }
      })
    }

    // Land selected: the natural next gesture is dragging what was pasted.
    const isCam = cb.camera.length > 0
    const landed = [...new Set((isCam ? cb.camera : [...cb.bones, ...cb.morphs]).map((e) => base + e.rel))]
    setSelectedKeyframes(landed.map((frame) => ({ type: "dope", frame, ...(isCam ? { camera: true } : {}) })))
  }, [clip, commit, commitCamera, frameNow, setSelectedKeyframes])

  const cutSelectedKeyframes = useCallback(() => {
    copySelectedKeyframes()
    deleteSelectedKeyframes()
  }, [copySelectedKeyframes, deleteSelectedKeyframes])

  /** Fit a curve through a dense track and keep only the keys it needs. What
   *  makes a captured or retargeted motion editable at all — a key on every
   *  frame is a track you cannot meaningfully move. */
  const simplifySelectedBoneTrack = useCallback(() => {
    if (!clip || !selectedBone) return
    const prev = clip.boneTracks.get(selectedBone)
    if (!prev || prev.length <= 2) return
    const reduced = simplifyBoneTrack(prev)
    if (reduced.length === prev.length) return
    const boneTracks = new Map(clip.boneTracks)
    boneTracks.set(selectedBone, reduced)
    setSelectedKeyframes([])
    const next = { ...clip, boneTracks }
    commit(next)
    engine.current?.prewarm(next)
  }, [clip, selectedBone, commit, setSelectedKeyframes, engine])

  /** Clears whichever track is selected. Bone takes priority since the two are
   *  mutually exclusive in the store, but both are checked in case a selection
   *  ever drifts out of step with what is on screen. */
  const clearSelectedTrack = useCallback(() => {
    if (!clip) return
    if (selectedBone && clip.boneTracks.has(selectedBone)) {
      const boneTracks = new Map(clip.boneTracks)
      boneTracks.delete(selectedBone)
      setSelectedKeyframes([])
      commit({ ...clip, boneTracks })
      return
    }
    if (selectedMorph && clip.morphTracks.has(selectedMorph)) {
      const morphTracks = new Map(clip.morphTracks)
      morphTracks.delete(selectedMorph)
      setSelectedKeyframes([])
      commit({ ...clip, morphTracks })
    }
  }, [clip, selectedBone, selectedMorph, commit, setSelectedKeyframes])

  const clearCameraTrack = useCallback(() => {
    if (cameraTrack.length === 0) return
    setSelectedKeyframes([])
    commitCamera([])
  }, [cameraTrack, commitCamera, setSelectedKeyframes])

  const boneTrackLen = selectedBone && clip ? (clip.boneTracks.get(selectedBone)?.length ?? 0) : 0
  const morphTrackLen = selectedMorph && clip ? (clip.morphTracks.get(selectedMorph)?.length ?? 0) : 0

  return {
    insertKeyframeAtPlayhead,
    deleteSelectedKeyframes,
    copySelectedKeyframes,
    pasteAtPlayhead,
    cutSelectedKeyframes,
    simplifySelectedBoneTrack,
    clearSelectedTrack,
    clearCameraTrack,
    canInsert: !!(clip && (selectedBone || selectedMorph)),
    canDelete: selectedKeyframes.length > 0,
    canCopy: selectedKeyframes.length > 0,
    canPaste: clipboard !== null,
    canSimplify: !!(clip && selectedBone && boneTrackLen > 2),
    canClear: !!(clip && ((selectedBone && boneTrackLen > 0) || (selectedMorph && morphTrackLen > 0))),
  }
}
