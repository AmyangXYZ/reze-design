"use client"

// Between the engine's copy of a clip and the editor's.
//
// Design's whole animation model is that the ENGINE owns the motion: React
// holds a file name, hands the bytes over and asks for a density strip back
// (use-lane-graphs). Editing breaks that, because you cannot move a keyframe
// you do not hold. So exactly one clip at a time is pulled out of the engine
// into the store, edited there, and pushed back — and this file is the whole
// of that crossing. Nothing else in the app should call getClip/loadClip.
//
// Headless, like reze-studio's EngineBridge, but a fraction of its size: that
// component also owned the playback rAF, and here AnimPlayer already does.
//
// The three jobs:
//
//   OPEN   — read the clip the engine is actually playing (not the name the
//            document uses for it: a bundled clip is registered under its
//            content hash, the mismatch use-lane-graphs documents) and clone it
//            in, so a drag mutating keyframes cannot reach the engine's copy.
//   COMMIT — on every revision bump, hand the edited clip back and re-seek so
//            the pose under the playhead is the pose that was just keyed.
//   SEEK   — the timeline's own scrub/step goes through the transport's Scrub
//            rather than model.seek, because seeking a scene means moving every
//            cast member together and settling physics on a big jump.

import { useEffect, useRef } from "react"
import type { AnimationClip, CameraKeyframe, Engine, Quat, Vec3 } from "reze-engine"
import type { ViewportHandlers } from "@/hooks/use-engine"
import type { RefObject } from "react"
import type { Scrub } from "@/components/scene/anim-player"
import {
  useClipActions,
  useClipEngineRegister,
  useClipSelector,
  usePlayheadActions,
  usePlayheadFrameRef,
  usePlayheadSelector,
  framesToSeconds,
  FPS,
} from "@/context/clip-editor"
import { cloneAnimationClip, interpolationTemplateForFrame, readLocalPoseAfterSeek } from "@/lib/clip"

/**
 * What the engine is holding, in one comparable string.
 *
 * Both directions need it. The watcher asks "is this a different clip from the
 * one I read in?"; a write-back has to answer "no" for the clip it just pushed,
 * or the very next frame reads our own write back in as an arrival — and an
 * arrival resets the editor's zoom, scroll and drafts. Adding the first
 * keyframe to a bone changes `boneTracks.size`, so that is not hypothetical: it
 * is what Insert does every time.
 *
 * NUL rather than a space, because a clip name can contain one.
 */
function stampOf(name: string, clip: AnimationClip): string {
  return `${name}\0${clip.boneTracks.size}\0${clip.morphTracks.size}\0${clip.frameCount}`
}

/**
 * Push the camera track WITHOUT changing whether the camera is VMD-driven.
 *
 * `loadCameraClip` calls `setVmdDriven(true)` for any non-empty track, so every
 * commit and every preview re-armed the shot — someone who had deliberately
 * toggled to free orbit got yanked back into the VMD the moment they touched a
 * camera keyframe, on their own edit. Editing a shot is not a request to watch
 * through it. The mode is the user's; this only replaces the data behind it.
 */
function loadCameraKeepingMode(engine: Engine | null, track: CameraKeyframe[]): void {
  if (!engine) return
  const wasDriven = engine.isCameraVmdEnabled()
  engine.loadCameraClip(track)
  if (!wasDriven) engine.setCameraVmdEnabled(false)
}

export function ClipBridge({
  engineRef,
  scrubRef,
  /** The engine's viewport callbacks, filled while editing. See ViewportHandlers. */
  viewportRef,
  /** Whose clip to edit, or null to edit nothing. One at a time — see the
   *  `modelId` note on ClipDocState. */
  editingModelId,
}: {
  engineRef: RefObject<Engine | null>
  scrubRef: RefObject<Scrub | null>
  viewportRef: RefObject<ViewportHandlers>
  editingModelId: string | null
}) {
  const { replaceClip, setRig, replaceCameraTrack, commit, setSelectedBone, setSelectedKeyframes, revealBone } =
    useClipActions()
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const frameRef = usePlayheadFrameRef()
  const registerEngine = useClipEngineRegister()
  const { setCurrentFrame } = usePlayheadActions()
  const clip = useClipSelector((s) => s.clip)
  const clipName = useClipSelector((s) => s.clipName)
  const modelId = useClipSelector((s) => s.modelId)
  const editRevision = useClipSelector((s) => s.editRevision)
  const cameraTrack = useClipSelector((s) => s.cameraTrack)
  const currentFrame = usePlayheadSelector((s) => s.currentFrame)

  // ─── OPEN, and STAY open ────────────────────────────────────────────────
  //
  // Watched rather than read once. The first version ran on `editingModelId`,
  // which is right for "the fold opened" and wrong for everything else that
  // changes what a model is playing: loading a new motion VMD, resetting the
  // scene, a bundle finishing its async load AFTER the fold was already open.
  // In all three the id never changes, so the store kept the previous clip and
  // the editor drew keyframes for a motion the engine was no longer playing.
  //
  // The engine's own `animationName` is the only honest trigger. The document's
  // filename is not: a bundled clip is registered under a content hash, so the
  // two disagree by design, and re-uploading the same filename would not change
  // it at all. A per-frame property read is cheap, and this loop only exists
  // while something is actually being edited.
  //
  // `loaded` tracks what we last pulled in, so pushing an edit BACK through
  // loadClip — which keeps the name — does not read our own write in again.
  const loaded = useRef<string | null>(null)
  const loadedCamera = useRef(-1)
  /** Which model's playhead has already been taken from the engine — see the
   *  adopt step in the watcher. */
  const adopted = useRef<string | null>(null)
  /** The editor's playhead, readable inside the watcher without re-running it. */
  const frameNow = useRef(currentFrame)
  useEffect(() => {
    frameNow.current = currentFrame
  })
  useEffect(() => {
    // A shut fold stops WATCHING; it does not throw the clip away.
    //
    // Clearing on close made every reopen a fresh load, and a fresh load is what
    // the editor resets its zoom and scroll on — so closing and reopening the
    // fold put you back at the top of a clip you had just scrolled into. The
    // clone costs memory the editor was holding anyway, and reopening is
    // instant. A different model, or a different clip, still re-reads: the
    // watcher restarts and its stamp will not match.
    if (editingModelId == null) {
      adopted.current = null
      return
    }
    let raf = 0
    const check = () => {
      raf = requestAnimationFrame(check)
      camera()
      const model = engineRef.current?.getModel(editingModelId)
      if (!model) return
      // The rig, every check: it is guarded by content inside the store, so a
      // model swap updates it and a steady frame costs one comparison.
      setRig(
        model.getSkeleton().bones.map((b) => b.name),
        model.getMorphing().morphs.map((m) => m.name),
      )
      const active = model.getAnimationProgress().animationName || null
      const source = active ? model.getClip(active) : null
      // The name alone is not enough to notice a morph VMD arriving.
      //
      // use-engine loads morphs with `loadVmd(motionClipName, …, { tracks:
      // "morphs" })` — they DRESS the motion clip rather than becoming a clip
      // of their own, so the engine's animationName does not change and a
      // name-only watcher never re-read. The editor sat on the clone it took
      // before the morphs landed and showed an empty morph track for a model
      // that plainly had one. Track sizes catch it, and cost two property
      // reads a frame.
      const stamp = active && source ? stampOf(active, source) : null
      if (stamp === loaded.current) return
      loaded.current = stamp
      if (!source || !active) {
        replaceClip(null, null, null)
        return
      }
      // Cloned, not referenced. Keyframe drags mutate in place (that is what
      // keeps a drag off React entirely), and mutating the engine's array would
      // edit the playing animation a frame at a time with no way back.
      replaceClip(cloneAnimationClip(source), editingModelId, active)
      // ADOPT the scene's position rather than imposing ours.
      //
      // The store opens at frame 0 and the scene is wherever the transport left
      // it, so without this the SEEK effect below sees a mismatch the instant a
      // clip lands and scrubs the whole cast back to 0 — after which the stored
      // playhead is restored on top and scrubs it forward again. That double
      // move is the frame "climbing from 0 to some value" every time the fold
      // opens, and the first half of it is a seek nobody asked for: it flushes
      // the audio decoder, which is the same cost the COMMIT note below is
      // careful to avoid paying twice.
      //
      // Once per MODEL, not once per clip — swapping the motion on a character
      // should leave the playhead where you are standing.
      if (adopted.current !== editingModelId) {
        adopted.current = editingModelId
        // Only when the scene has actually moved away from where the editor
        // left its playhead. Adopting unconditionally is right the first time
        // and wrong on every reopen: closing the fold stops the watcher, so
        // reopening runs this again, and a scene sitting exactly where you left
        // it would still have its frame re-asserted — which, with the restored
        // view arriving in the same breath, is the editor reopening somewhere
        // other than where you shut it. A frame of tolerance, because the
        // engine's clock is seconds and this is comparing it to integers.
        const at = model.getAnimationProgress().current * FPS
        if (Math.abs(at - frameNow.current) > 1) setCurrentFrame(at)
      }
    }
    // The camera shot belongs to the SCENE — reze-engine keeps it off the model
    // entirely, and VMD keeps it in its own file for the same reason — so it is
    // read from the engine rather than out of the clip, and it changes on its
    // own schedule. Copied on the way in like the clip is: a keyframe drag
    // mutates these objects in place.
    const camera = () => {
      const frames = engineRef.current?.getCameraClip() ?? []
      if (frames.length === loadedCamera.current) return
      loadedCamera.current = frames.length
      replaceCameraTrack(frames.map((k) => ({ ...k })))
    }
    raf = requestAnimationFrame(check)
    return () => cancelAnimationFrame(raf)
  }, [editingModelId, engineRef, replaceClip, setRig, replaceCameraTrack, setCurrentFrame])

  // ─── COMMIT ─────────────────────────────────────────────────────────────
  // Watches `editRevision`, which only a real edit bumps — NOT `revision`,
  // which a load bumps too.
  //
  // That distinction is the whole point. Loading a clip used to land here, so
  // opening the timeline wrote the clip straight back into the engine it had
  // just been read from and seeked the entire cast to do it. The upload was
  // merely wasted; the seek was audible — it flushes the audio decoder and
  // mutes the first beat, which is why the music came in late the first time
  // the fold opened.
  const lastEdit = useRef(editRevision)
  useEffect(() => {
    if (editRevision === lastEdit.current) return
    lastEdit.current = editRevision
    if (!clip || !clipName || !modelId) return
    const model = engineRef.current?.getModel(modelId)
    if (!model) return
    model.loadClip(clipName, clip)
    // Ours, not an arrival — see stampOf.
    loaded.current = stampOf(clipName, clip)
    // The camera half of the same commit. commitCamera and commit share one
    // editRevision because they are edits to one document, so both write back
    // here; loadCameraClip is a no-op against an unchanged track.
    if (cameraTrack.length > 0) loadCameraKeepingMode(engineRef.current, cameraTrack)
    // Re-seek, or the viewport keeps showing the pose it sampled before the
    // upload — a key you just moved appears not to have moved until something
    // else advances the clock, which reads as the edit having been dropped.
    scrubRef.current?.to(framesToSeconds(currentFrame))
    // currentFrame deliberately absent: this fires on COMMITS, and reading the
    // playhead's latest value at that moment is the point. Subscribing to it
    // would re-upload the clip on every scrub.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRevision, clip, clipName, modelId, engineRef, scrubRef, cameraTrack])

  // ─── SEEK ───────────────────────────────────────────────────────────────
  // The editor's ruler, its frame field and its step buttons all just move the
  // store's playhead. Something has to take that to the scene, and it is not
  // model.seek: seeking here means every cast member together, with physics
  // settled if the jump was big enough to be a teleport. That is what Scrub is.
  //
  // Guarded against the ENGINE's own position rather than against the store's,
  // because the store mirrors every write into its ref and comparing the two
  // would always agree. This asks the only question worth asking — is the scene
  // already where the playhead says it is — which also makes the flush on pause
  // a no-op instead of a redundant seek and physics reset.
  useEffect(() => {
    if (!modelId) return
    const model = engineRef.current?.getModel(modelId)
    if (!model) return
    const at = model.getAnimationProgress().current * FPS
    if (Math.abs(currentFrame - at) < 0.75) return
    scrubRef.current?.to(framesToSeconds(currentFrame))
  }, [currentFrame, modelId, engineRef, scrubRef])

  // The handlers below are registered once and live for as long as editing
  // does, so everything they read that changes goes through a ref.
  const clipRef = useRef(clip)
  const clipNameRef = useRef(clipName)
  useEffect(() => {
    clipRef.current = clip
    clipNameRef.current = clipName
  })

  // ─── THE GIZMO ──────────────────────────────────────────────────────────
  //
  // Which bone the engine is drawing a gizmo on. Only while an editor is open:
  // a gizmo in a scene nobody is editing is a handle for an edit that has
  // nowhere to go.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.setSelectedBone(editingModelId, editingModelId ? selectedBone : null)
    return () => {
      engine.setSelectedBone(null, null)
    }
  }, [engineRef, editingModelId, selectedBone])

  // ─── THE VIEWPORT ───────────────────────────────────────────────────────
  //
  // Picking a bone by double-clicking the model, and dragging its gizmo.
  //
  // Registered here rather than beside the canvas because both ends of it are
  // clip work: a pick sets the editor's selection, and a drag writes a
  // keyframe. Installed only while something is being edited, which is what
  // makes "editor mode" true by construction rather than by a flag.
  const dragDirty = useRef(false)
  useEffect(() => {
    if (editingModelId == null) {
      viewportRef.current = {}
      return
    }
    const modelNow = () => engineRef.current?.getModel(editingModelId) ?? null

    /** Write the dragged pose into the key at the playhead, creating one from
     *  the pose already showing if there is none — the same contract the
     *  inspector's sliders have. */
    const applyDrag = (boneName: string, kind: "rotate" | "translate", rotation: Quat, translation: Vec3) => {
      const clip = clipRef.current
      const name = clipNameRef.current
      const model = modelNow()
      if (!clip || !name || !model) return
      const frame = Math.round(Math.max(0, Math.min(clip.frameCount, frameRef.current)))
      const track = clip.boneTracks.get(boneName) ?? []
      const atKey = track.find((k) => k.frame === frame)
      if (atKey) {
        // In place: the engine shares these keyframe objects, and a drag that
        // cloned the clip per mousemove would put the whole document through
        // React sixty times a second.
        if (kind === "rotate") atKey.rotation = rotation
        else atKey.translation = translation
      } else {
        // The channel NOT being dragged comes from the interpolated pose, so a
        // key created by dragging one axis does not silently zero the other.
        model.seek(framesToSeconds(frame))
        const pose = readLocalPoseAfterSeek(model, boneName)
        if (!pose) return
        if (!clip.boneTracks.has(boneName)) clip.boneTracks.set(boneName, track)
        track.push({
          boneName,
          frame,
          rotation: kind === "rotate" ? rotation : pose.rotation,
          translation: kind === "translate" ? translation : pose.translation,
          interpolation: interpolationTemplateForFrame(track, frame),
        })
        track.sort((a, b) => a.frame - b.frame)
      }
      model.loadClip(name, clip)
      loaded.current = stampOf(name, clip)
      model.seek(framesToSeconds(frame))
      return clip
    }

    viewportRef.current = {
      onRaycast: (modelName, _material, bone) => {
        // A miss is a deselect. The gizmo goes with the selection rather than
        // having a visibility of its own — one thing to reason about, and the
        // properties dock leaves with it.
        if (!modelName || !bone) {
          setSelectedBone(null)
          setSelectedKeyframes([])
          return
        }
        // Through revealBone rather than setSelectedBone: a viewport pick has
        // to FIND the row as well as select it, and the bone may well be
        // filtered out of the picker's current group.
        revealBone(bone)
        setSelectedKeyframes([])
      },
      onGizmoDrag: (e) => {
        if (e.phase === "start") {
          dragDirty.current = false
          // Whatever you are dragging is what the editor is about.
          setSelectedBone(e.boneName)
          setSelectedKeyframes([])
          return
        }
        const clip = applyDrag(e.boneName, e.kind, e.localRotation, e.localTranslation)
        if (!clip) return
        if (e.phase === "end") {
          // One commit for the gesture: one history entry, one write-back.
          // Skipped when the drag never moved, so clicking a gizmo handle does
          // not record a step that changed nothing.
          if (dragDirty.current) commit({ ...clip, boneTracks: new Map(clip.boneTracks) })
          dragDirty.current = false
        } else {
          dragDirty.current = true
        }
      },
    }
    return () => {
      viewportRef.current = {}
    }
  }, [editingModelId, engineRef, viewportRef, frameRef, commit, setSelectedBone, setSelectedKeyframes, revealBone])

  // ─── THE DOOR ───────────────────────────────────────────────────────────
  //
  // The four engine operations an editor surface may call, and the reason the
  // rule at the top of this file survives a slider drag. See ClipEngine for why
  // the preview half cannot go through `commit` instead.
  //
  // Registered rather than exported: it closes over the model and clip name
  // being edited, so a caller cannot aim it at a model that is not open, and it
  // goes null the moment editing stops.
  useEffect(() => {
    if (editingModelId == null || clipName == null) {
      registerEngine(null)
      return
    }
    const modelNow = () => engineRef.current?.getModel(editingModelId) ?? null
    registerEngine({
      preview: (next, frame) => {
        const model = modelNow()
        if (!model) return
        model.loadClip(clipName, next)
        // Claimed, exactly as a commit claims its own write: a preview that
        // keys an unkeyed bone changes the track count, and the watcher would
        // otherwise read it back as a new clip mid-drag — resetting the zoom
        // and scroll under the pointer.
        loaded.current = stampOf(clipName, next)
        // This model only. A scene-wide Scrub here would settle physics for
        // every cast member on every tick of a drag.
        model.seek(framesToSeconds(Math.max(0, frame)))
      },
      samplePose: (bone, seekFrame) => {
        const model = modelNow()
        if (!model) return null
        if (seekFrame != null) model.seek(framesToSeconds(Math.max(0, seekFrame)))
        return readLocalPoseAfterSeek(model, bone)
      },
      previewCamera: (track) => {
        // Length is what the watcher compares, and a drag does not change it —
        // so pushing a preview here cannot be read back in as a new shot.
        loadCameraKeepingMode(engineRef.current, track)
      },
      morphWeight: (morph) => {
        const model = modelNow()
        if (!model) return null
        const idx = model.getMorphing().morphs.findIndex((m) => m.name === morph)
        if (idx < 0) return null
        return model.getMorphWeights()[idx] ?? null
      },
      prewarm: (next) => {
        const model = modelNow()
        if (!model) return
        model.loadClip(clipName, next)
        loaded.current = stampOf(clipName, next)
        // Walk the whole clip once so V8 JITs the freshly-fitted beziers and
        // the engine fills its per-segment caches up front. Without it the
        // first playback after a Simplify stutters while both happen lazily on
        // the rAF clock; replay is already fine.
        for (let f = 0; f <= next.frameCount; f++) model.seek(f / FPS)
        engineRef.current?.resetPhysics()
      },
    })
    return () => {
      registerEngine(null)
    }
  }, [editingModelId, clipName, engineRef, registerEngine])

  return null
}
