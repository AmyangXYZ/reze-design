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
import { useClipActions, useClipEngine, useClipSelector, usePlayheadFrameRef } from "@/context/clip-editor"
import { interpolationTemplateForFrame, simplifyBoneTrack, upsertMorphKeyframeAtFrame } from "@/lib/clip"

export type ClipOps = {
  insertKeyframeAtPlayhead: () => void
  deleteSelectedKeyframes: () => void
  simplifySelectedBoneTrack: () => void
  clearSelectedTrack: () => void
  clearCameraTrack: () => void
  /** Which of the above mean anything right now. The buttons go inert rather
   *  than vanishing — an Operations block that changes shape as you select
   *  things is a block you have to re-find every time. */
  canInsert: boolean
  canDelete: boolean
  canSimplify: boolean
  canClear: boolean
}

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
    if (!clip || selectedKeyframes.length === 0) return
    const sel = selectedKeyframes
    setSelectedKeyframes([])

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

      for (const s of sel) {
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
  }, [clip, selectedKeyframes, selectedMorph, commit, setSelectedKeyframes])

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
    simplifySelectedBoneTrack,
    clearSelectedTrack,
    clearCameraTrack,
    canInsert: !!(clip && (selectedBone || selectedMorph)),
    canDelete: !!(clip && selectedKeyframes.length > 0),
    canSimplify: !!(clip && selectedBone && boneTrackLen > 2),
    canClear: !!(clip && ((selectedBone && boneTrackLen > 0) || (selectedMorph && morphTrackLen > 0))),
  }
}
