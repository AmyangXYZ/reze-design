"use client"

// The clip being edited, and where the playhead is in it.
//
// Two stores rather than one, for the reason reze-studio split them: the
// playhead moves sixty times a second and the document does not, so a single
// store would invalidate every keyframe consumer on every tick. Both are
// external stores read through `useSyncExternalStore`, which is already how
// this repo does derived-but-not-React state (use-lane-graphs, use-community).
//
// What is DIFFERENT from reze-studio, and why:
//
//   1. No clock of its own. reze-studio's <Playback> owns a rAF that reads the
//      engine and advances the frame. Design already has one — AnimPlayer's,
//      which drives the transport bar, the lane playhead and the follow toggle
//      off a single `getAnimationProgress()` read, and throttles itself to 4Hz
//      on touch because it lives inside a backdrop-blur pane. A second loop
//      reading the same engine would be duplicate work that can disagree by a
//      frame. So AnimPlayer stays the clock and pushes into `frameRef` here.
//
//   2. No past/future. reze-studio's store carries its own 100-entry history.
//      This repo has one undo, routed by DOM scope (hooks/use-undo-scope.ts),
//      and a second stack inside a store would be exactly the ad-hoc
//      coordination that hook exists to delete. `clipSnapshot` still exists —
//      it is what makes an undoable step out of a drag that mutates keyframes
//      in place — but the stack it feeds is useHistory's.
//
//   3. Seconds at the edges, frames inside. The scene clock is seconds and a
//      VMD is integer frames at 30fps. `FPS` and the two converters below are
//      the only places that crossing happens.

import {
  createContext,
  createElement,
  useContext,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react"
import type { AnimationClip, CameraKeyframe, Quat, Vec3 } from "reze-engine"
import { BONE_GROUPS } from "@/lib/animation"
import { clipAfterKeyframeEdit } from "@/lib/clip"

export { FPS, framesToSeconds, secondsToFrames } from "@/lib/clip"

/** Which of a cast member's three tracks the editor is pointed at. Motion and
 *  morphs belong to the character; the camera belongs to the scene but is edited
 *  on the same clock, so it rides the same target. */
export type ClipEditKind = "motion" | "morph" | "camera"

/**
 * The engine, as much of it as an editor surface is allowed to touch.
 *
 * clip-bridge states the rule this exists to keep: it is the ONLY crossing
 * between the engine's copy of a clip and the editor's, and nothing else may
 * call getClip/loadClip. But a slider drag genuinely needs the viewport to move
 * while the pointer is down, and routing that through `commit` instead would
 * clone the clip for the history snapshot and re-seek the whole cast on every
 * tick — a scene-wide physics settle per pixel of drag.
 *
 * So the bridge registers these four, and the inspector calls them. The
 * crossing stays in one file; what changes is that the file now exposes a door
 * rather than being the only room with a window.
 */
export type ClipEngine = {
  /** Push the edited clip and seek the edited model — that model only, not the
   *  scene. The preview half of a drag. */
  preview: (clip: AnimationClip, frame: number) => void
  /** The bone's local pose. `seekFrame` first when paused (React owns the clock
   *  then); null while playing, when the engine's own clock is ahead of us and
   *  seeking would fight playback. */
  samplePose: (bone: string, seekFrame: number | null) => { rotation: Quat; translation: Vec3 } | null
  /** The camera half of `preview`. The shot lives on the engine rather than on
   *  a model, so it is pushed whole. */
  previewCamera: (track: CameraKeyframe[]) => void
  /** The morph's live weight, interpolated — whatever the viewport is showing. */
  morphWeight: (morph: string) => number | null
  /** Walk the playhead through a freshly-fitted clip once so the first playback
   *  after a Simplify does not stutter while beziers JIT and caches fill. */
  prewarm: (clip: AnimationClip) => void
}

/** Dopesheet diamond vs curve-editor handle — shared by timeline hit-testing. */
export interface SelectedKeyframe {
  bone?: string
  morph?: string
  frame: number
  channel?: string
  /** Set when the entry names the camera track. A camera dope column is
   *  otherwise indistinguishable from a bone column — both are a bare frame —
   *  and delete/copy have to know which track a frame belongs to. */
  camera?: boolean
  type: "dope" | "curve"
}

function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function" ? (action as (p: T) => T)(prev) : action
}

// ─────────────────────────────────────────────────────────────────────────
// Playhead
// ─────────────────────────────────────────────────────────────────────────

export type PlayheadState = {
  /** Clip frames, fractional while scrubbing or playing. */
  currentFrame: number
  playing: boolean
}

export type PlayheadActions = {
  /** Notifies subscribers. For scrub ends and pauses — NOT for playback ticks,
   *  which must go through `frameRef` and the canvas's imperative draw. */
  setCurrentFrame: Dispatch<SetStateAction<number>>
  setPlaying: Dispatch<SetStateAction<boolean>>
}

type PlayheadStore = {
  getState: () => PlayheadState
  subscribe: (listener: () => void) => () => void
  actions: PlayheadActions
  /** The live frame, written by AnimPlayer's rAF without notifying anyone.
   *  Identity is stable for the provider's lifetime, so reading it never
   *  subscribes a component to the playhead. */
  frameRef: RefObject<number>
}

function createPlayheadStore(): PlayheadStore {
  let state: PlayheadState = { currentFrame: 0, playing: false }
  const listeners = new Set<() => void>()
  const frameRef: RefObject<number> = { current: 0 }

  const set = (next: PlayheadState) => {
    if (next === state) return
    // Mirror into the ref ONLY when this transition actually moved the frame.
    // During playback the rAF writes `frameRef.current` directly, and an
    // unrelated setPlaying(false) that copied `next.currentFrame` over it would
    // clobber the live position with the stale pre-playback one — the next play
    // would then resume from wherever the transport was before. Same hazard
    // reze-studio documents on its own store; same fix.
    if (next.currentFrame !== state.currentFrame) frameRef.current = next.currentFrame
    state = next
    listeners.forEach((l) => l())
  }

  const actions: PlayheadActions = {
    setCurrentFrame: (payload) => {
      const next = resolve(payload, state.currentFrame)
      if (next === state.currentFrame) return
      set({ ...state, currentFrame: next })
    },
    setPlaying: (payload) => {
      const next = resolve(payload, state.playing)
      if (next === state.playing) return
      set({ ...state, playing: next })
    },
  }

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    actions,
    frameRef,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────────

export type ClipDocState = {
  /** The clip under the playhead, read out of the engine when editing opens and
   *  written back on commit. Null when nothing is being edited — the collapsed
   *  timeline, or a cast member with no motion. */
  clip: AnimationClip | null
  /** Which cast member's clip `clip` is. The timeline edits ONE at a time —
   *  tweak mode, in Blender's sense: a scene has a cast, but keys belong to a
   *  character and a dopesheet showing two at once has no honest bone gutter. */
  modelId: string | null
  /** Engine's name for the loaded clip. Not the document's name for it: a clip
   *  out of a scene bundle is registered under the packed file's content hash,
   *  which is the mismatch use-lane-graphs already documents. Written back
   *  under whatever name it was read from. */
  clipName: string | null
  selectedBone: string | null
  selectedMorph: string | null
  selectedKeyframes: SelectedKeyframe[]
  cameraTrack: CameraKeyframe[]
  cameraSelected: boolean
  /** Whether the engine draws the transform gizmo on the selected bone.
   *  Decoupled from the selection, studio-style: once shown it follows the
   *  selection from bone to bone instead of needing to be re-summoned. Off by
   *  default — the gizmo stands between the camera and the model, and reading
   *  a bone's curves is not a reason to put arrows over the character's face.
   *  Persisted per browser: an editor preference, not a document fact. */
  gizmoVisible: boolean
  /** Every bone the MODEL has, not only the ones the clip keys. The dopesheet's
   *  rows are the keyed ones — that is what a channel list means — but keying a
   *  bone for the first time has to be able to name one that has no track yet,
   *  and that list only the engine has. */
  boneNames: string[]
  morphNames: string[]
  /** Which bone group the picker is narrowed to. Chrome, not document. */
  boneGroup: string
  /**
   * Which channel the curve half is showing — "allRot", "rx", "morph", a camera
   * tab. Chrome as well, and it lived in <Dopesheet> as local state until the
   * inspector needed it too: dragging a rotation slider points the timeline at
   * the curve being dragged, which is one surface writing another's view. Two
   * surfaces sharing a value is what this store is for; the persistence of it
   * stays in use-timeline-view, which is where the rest of the view lives.
   */
  tab: string
  /**
   * "Scroll the picker to this bone."
   *
   * An epoch rather than a bare name, so picking the SAME bone twice still
   * scrolls — a second double-click on a bone you already have selected is
   * someone asking where it is in the list, and a name-only signal would be a
   * no-op exactly then. Set by viewport picks only: a click in the list is
   * already where the user is pointing.
   */
  revealBone: { bone: string; epoch: number } | null
  /**
   * Which HALF moved, counted separately.
   *
   * `editRevision` says the document changed and is what the bridge writes back
   * on; these two say whether it was the clip or the shot. Undo needs it to diff
   * only the half that moved, and autosave needs it to avoid re-encoding a
   * two-hundred-key camera VMD because someone nudged a knee.
   *
   * Counters rather than the immutable clones that used to live here. Those were
   * for a history that stored whole clips: at fifteen thousand keyframes a clone
   * is ~12.7MB, so the stack ran to a gigabyte and every commit paid a deep copy
   * to fill it. The history diffs against one baseline of its own now, and a
   * commit costs nothing but a counter.
   */
  clipRevision: number
  cameraRevision: number
  /**
   * Bumped when a whole new clip ARRIVES — never by an edit.
   *
   * The editor resets its zoom, scroll and drafts on this, which is right for a
   * clip swap and catastrophic for an edit: it used to count both, so moving a
   * single keyframe threw away wherever you had scrolled to and whatever you
   * had zoomed in on. That also silently defeated the stored view, since the
   * first edit overwrote what had just been restored.
   */
  loadRevision: number
  /**
   * Bumped ONLY by a real edit, never by a load.
   *
   * Separate from `loadRevision` because the two answer different questions, and
   * conflating them cost an audible bug: the bridge writes the clip back to the
   * engine and re-seeks the scene on every bump, so loading a clip fired the
   * write-back path against the clip it had just READ — re-uploading it and
   * seeking the whole cast for nothing. A seek flushes the audio decoder and
   * mutes the first beat (see use-audio-clock), so expanding the timeline
   * delayed the music. "The document changed" and "the user changed the
   * document" are not the same event.
   */
  editRevision: number
}

export type ClipDocActions = {
  /** An undoable edit. Bumps `editRevision`; the bridge and the history stack
   *  both key off that. */
  commit: Dispatch<SetStateAction<AnimationClip | null>>
  /** Load without recording a step — opening a clip for editing, a VMD import,
   *  an undo restoring a snapshot. */
  replaceClip: (next: AnimationClip | null, modelId: string | null, clipName: string | null) => void
  setSelectedBone: Dispatch<SetStateAction<string | null>>
  setSelectedMorph: Dispatch<SetStateAction<string | null>>
  setSelectedKeyframes: Dispatch<SetStateAction<SelectedKeyframe[]>>
  commitCamera: Dispatch<SetStateAction<CameraKeyframe[]>>
  replaceCameraTrack: (next: CameraKeyframe[]) => void
  setCameraSelected: Dispatch<SetStateAction<boolean>>
  setGizmoVisible: Dispatch<SetStateAction<boolean>>
  /** Filled from the engine when a model opens for editing. Not undoable and
   *  not part of the document — it describes the RIG, not the clip. */
  setRig: (boneNames: string[], morphNames: string[]) => void
  setBoneGroup: Dispatch<SetStateAction<string>>
  setTab: Dispatch<SetStateAction<string>>
  /** Select a bone AND ask the picker to scroll to it. For viewport picks. */
  revealBone: (bone: string | null) => void
}

type ClipDocStore = {
  getState: () => ClipDocState
  subscribe: (listener: () => void) => () => void
  actions: ClipDocActions
}

const GIZMO_PREF_KEY = "reze-design:gizmo-visible"
const readGizmoPref = (): boolean => {
  try {
    return typeof window !== "undefined" && localStorage.getItem(GIZMO_PREF_KEY) === "1"
  } catch {
    return false
  }
}

const EMPTY_DOC: ClipDocState = {
  clip: null,
  modelId: null,
  clipName: null,
  selectedBone: null,
  selectedMorph: null,
  selectedKeyframes: [],
  cameraTrack: [],
  cameraSelected: false,
  gizmoVisible: readGizmoPref(),
  boneNames: [],
  morphNames: [],
  // A key BONE_GROUPS actually has — "all" matched nothing, so the picker
  // opened with every group shut.
  boneGroup: "All Bones",
  // A real tab key, matching the timeline's own TABS. It was "rotX" in the
  // dopesheet's initialiser, which is not one of them — so a first-ever open
  // showed a tab strip with nothing selected.
  tab: "allRot",
  revealBone: null,
  clipRevision: 0,
  cameraRevision: 0,
  loadRevision: 0,
  editRevision: 0,
}

function createClipDocStore(): ClipDocStore {
  let state = EMPTY_DOC
  const listeners = new Set<() => void>()

  const set = (next: ClipDocState) => {
    if (next === state) return
    state = next
    listeners.forEach((l) => l())
  }

  const update = <K extends keyof ClipDocState>(key: K, action: SetStateAction<ClipDocState[K]>) => {
    const next = resolve(action, state[key])
    if (next === state[key]) return
    set({ ...state, [key]: next })
  }

  const actions: ClipDocActions = {
    commit: (payload) => {
      const next = resolve(payload, state.clip)
      if (next == null) {
        set({
          ...state,
          clip: null,
          selectedBone: null,
          selectedMorph: null,
          selectedKeyframes: [],
          editRevision: state.editRevision + 1,
          clipRevision: state.clipRevision + 1,
        })
        return
      }
      const settled = clipAfterKeyframeEdit(next)
      set({
        ...state,
        clip: settled,
        editRevision: state.editRevision + 1,
        clipRevision: state.clipRevision + 1,
      })
    },
    replaceClip: (next, modelId, clipName) => {
      if (next == null) {
        // `tab` rides along for the same reason cameraTrack does: it is not
        // this clip's, so losing a clip must not reset it.
        set({
          ...EMPTY_DOC,
          loadRevision: state.loadRevision + 1,
          cameraTrack: state.cameraTrack,
          tab: state.tab,
          gizmoVisible: state.gizmoVisible,
        })
        return
      }
      const settled = clipAfterKeyframeEdit(next)
      set({
        ...state,
        clip: settled,
        modelId,
        clipName,
        selectedKeyframes: [],
        loadRevision: state.loadRevision + 1,
      })
    },
    setSelectedBone: (payload) => {
      const next = resolve(payload, state.selectedBone)
      if (next === state.selectedBone) return
      // Bone and morph are one selection with two shapes — a dopesheet row is
      // either, never both, and the inspector below reads whichever is set.
      set({ ...state, selectedBone: next, selectedMorph: next != null ? null : state.selectedMorph })
    },
    setSelectedMorph: (payload) => {
      const next = resolve(payload, state.selectedMorph)
      if (next === state.selectedMorph) return
      set({ ...state, selectedMorph: next, selectedBone: next != null ? null : state.selectedBone })
    },
    setSelectedKeyframes: (payload) => update("selectedKeyframes", payload),
    commitCamera: (payload) => {
      const next = resolve(payload, state.cameraTrack)
      const sorted = [...next].sort((a, b) => a.frame - b.frame)
      set({
        ...state,
        cameraTrack: sorted,
        editRevision: state.editRevision + 1,
        cameraRevision: state.cameraRevision + 1,
      })
    },
    replaceCameraTrack: (next) => {
      const sorted = [...next].sort((a, b) => a.frame - b.frame)
      set({ ...state, cameraTrack: sorted })
    },
    setCameraSelected: (payload) => update("cameraSelected", payload),
    setGizmoVisible: (payload) => {
      const next = resolve(payload, state.gizmoVisible)
      if (next === state.gizmoVisible) return
      try {
        localStorage.setItem(GIZMO_PREF_KEY, next ? "1" : "0")
      } catch {}
      set({ ...state, gizmoVisible: next })
    },
    setRig: (boneNames, morphNames) => {
      // Compared by content, not identity: this is refreshed from a per-frame
      // watcher, and a new array every frame would notify every subscriber
      // sixty times a second for a list that changes only on a model swap.
      const a = state.boneNames
      const b = state.morphNames
      const same =
        a.length === boneNames.length &&
        b.length === morphNames.length &&
        a.every((n, i) => n === boneNames[i]) &&
        b.every((n, i) => n === morphNames[i])
      if (same) return
      set({ ...state, boneNames, morphNames })
    },
    setBoneGroup: (payload) => update("boneGroup", payload),
    setTab: (payload) => update("tab", payload),
    revealBone: (bone) => {
      if (bone == null) {
        set({ ...state, selectedBone: null, selectedMorph: null, revealBone: null })
        return
      }
      // The group has to CONTAIN the bone, or its row is not rendered and the
      // scroll lands on nothing. Widening to All Bones is the honest fallback:
      // the pick came from the viewport, where every bone is reachable whatever
      // the list happens to be filtered to.
      const group = BONE_GROUPS[state.boneGroup]
      const boneGroup = group && !group.includes(bone) ? "All Bones" : state.boneGroup
      set({
        ...state,
        selectedBone: bone,
        selectedMorph: null,
        boneGroup,
        revealBone: { bone, epoch: (state.revealBone?.epoch ?? 0) + 1 },
      })
    },
  }

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    actions,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Provider + hooks
// ─────────────────────────────────────────────────────────────────────────

/**
 * The engine door's box, and the only way to fill it.
 *
 * Written through `set` rather than by assigning `.current` at the call site:
 * the compiler can only see that a value is safe to mutate when it came from
 * `useRef`, and this one comes from the provider's store object. Handing out a
 * setter moves the write into a plain closure, which is honest as well as
 * quiet — filling the slot is an action, like every other one on these stores.
 */
type EngineSlot = {
  ref: RefObject<ClipEngine | null>
  set: (ops: ClipEngine | null) => void
}

function createEngineSlot(): EngineSlot {
  const ref: RefObject<ClipEngine | null> = { current: null }
  return {
    ref,
    set: (ops) => {
      ref.current = ops
    },
  }
}

type Stores = { playhead: PlayheadStore; doc: ClipDocStore; engine: EngineSlot }
const StoresContext = createContext<Stores | null>(null)

export function ClipEditor({ children }: { children: ReactNode }) {
  // useState's lazy initialiser, not a ref written during render: the stores
  // are created exactly once either way, but a ref READ during render is what
  // this repo's lint forbids, and rightly — the value is being used to render.
  const [stores] = useState(() => ({
    playhead: createPlayheadStore(),
    doc: createClipDocStore(),
    // A plain box, like `frameRef`: filled by <ClipBridge/> on mount and read
    // inside callbacks, so nothing re-renders when the engine appears.
    engine: createEngineSlot(),
  }))
  return createElement(StoresContext.Provider, { value: stores }, children)
}

function useStores(): Stores {
  const stores = useContext(StoresContext)
  if (stores == null) throw new Error("useClipEditor* must be used within <ClipEditor>")
  return stores
}

/** Subscribe to one slice of the playhead. Re-renders only when that slice
 *  changes, which during playback is never — the rAF writes `frameRef`. */
export function usePlayheadSelector<T>(selector: (state: PlayheadState) => T): T {
  const { playhead } = useStores()
  const snapshot = () => selector(playhead.getState())
  return useSyncExternalStore(playhead.subscribe, snapshot, snapshot)
}

/** Stable actions bag — never re-renders its consumer. */
export function usePlayheadActions(): PlayheadActions {
  return useStores().playhead.actions
}

/** Non-subscribing read of the live playhead. Stable identity: consuming this
 *  will NOT re-render the component when the playhead moves. */
export function usePlayheadFrameRef(): RefObject<number> {
  return useStores().playhead.frameRef
}

/** Both playhead fields plus the actions. Convenience for the timeline, which
 *  needs all four; anything needing one field should take the selector instead
 *  so a play/pause does not re-render it. */
export function usePlayhead(): PlayheadState & PlayheadActions {
  const currentFrame = usePlayheadSelector((s) => s.currentFrame)
  const playing = usePlayheadSelector((s) => s.playing)
  return { currentFrame, playing, ...usePlayheadActions() }
}

/** Subscribe to one slice of the document. Prefer top-level fields — the
 *  snapshot is compared with Object.is, so a selector building an object
 *  re-renders on every notify. */
export function useClipSelector<T>(selector: (state: ClipDocState) => T): T {
  const { doc } = useStores()
  const snapshot = () => selector(doc.getState())
  return useSyncExternalStore(doc.subscribe, snapshot, snapshot)
}

export function useClipActions(): ClipDocActions {
  return useStores().doc.actions
}

/** The engine door described on ClipEngine. Written by <ClipBridge/>, read by
 *  the inspector; null whenever nothing is being edited. */
export function useClipEngine(): RefObject<ClipEngine | null> {
  return useStores().engine.ref
}

/** Fill the door, or empty it. <ClipBridge/> is the only caller. */
export function useClipEngineRegister(): (ops: ClipEngine | null) => void {
  return useStores().engine.set
}

/** Non-subscribing read of the whole document — for imperative paths (canvas
 *  hit-testing, export) that need the current clip without owning a render. */
export function useClipDocRef(): { getState: () => ClipDocState } {
  return useStores().doc
}
