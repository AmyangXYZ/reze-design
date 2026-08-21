"use client";

// The timeline, its fold, and the two things it needs that only the store knows.
//
// It exists because <Home> is OUTSIDE <ClipEditor> — the provider wraps the
// transport, not the page — so nothing up there can read the clip. Rather than
// hoist a provider over six thousand lines to compute two values, the two
// values are computed here, one level inside it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CLIP_UNDO_SCOPE } from "@/components/scene/clip-history"
import { Timeline, defaultTabForSelection, tabsForSelection } from "@/components/scene/timeline"
import { TrackPicker } from "@/components/scene/track-picker";
import {
  useClipActions,
  useClipSelector,
  usePlayheadActions,
  usePlayheadFrameRef,
  usePlayheadSelector,
  type ClipEditKind,
} from "@/context/clip-editor";
import { BONE_GROUPS } from "@/lib/animation";
import { cn } from "@/lib/utils";
import { useTimelineView } from "@/hooks/use-timeline-view";
import { useT } from "@/lib/i18n";

/** The transport's fold curve, mirrored from page.tsx's FOLD. Keep the two in
 *  step: the panel's width and this height are one motion, and two curves that
 *  are nearly the same read as the box fighting its own contents. */
const FOLD = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]";

/**
 * How tall the editor is, open — the default, and the floor and ceiling a drag
 * is held between.
 *
 * A FIXED height at any given moment, which is the whole trick.
 *
 * The old lanes could animate to content height (grid-rows 0fr→1fr) because
 * they were DOM: the browser reflowed them and they looked right at every
 * intermediate height. A canvas cannot. Every one of its y-positions — ruler,
 * curve band, dope strip, audio — is computed from `clientHeight`, so a height
 * that animates makes the canvas re-lay-out and fully repaint its cached static
 * layer on every frame of the fold. That is expensive, and worse, it is what
 * the "scale up then down" flash actually WAS: the contents genuinely were
 * being redrawn at a different scale sixty times on the way open.
 *
 * Fixing the height means the canvas lays out ONCE, at its final size, and the
 * fold becomes a pure clip — the parent's grid row grows and reveals a picture
 * that was already correct. Which is also exactly what the iOS-style expand
 * looks like: content that was always there, uncovered, rather than content
 * that inflates into place.
 *
 * Being DRAGGABLE does not break that. What the fold must not do is animate
 * through heights on its own; a drag is the user asking for each of those sizes
 * one at a time, watching the result, and the canvas's ResizeObserver already
 * coalesces to one repaint per frame. The cost is the same per frame either
 * way — the difference is whether anyone asked for it.
 */
/**
 * The floor, and the height it opens at — one number, because the size this
 * shipped at is a size every band was laid out against: toolbar, ruler, curve
 * half, dope strip and the music lane all fit it. Anything shorter was reachable
 * by dragging and looked like the editor had been squashed rather than resized,
 * so the drag only goes UP from here.
 */
const MIN_H = 272;
const DEFAULT_H = MIN_H;

/** The ceiling, measured against the window at drag time rather than fixed.
 *
 *  It is really the question "how much canvas may this take", and the answer
 *  depends on the window: 180px is the transport bar, the insets under it and a
 *  strip of scene left visible above — below that the editor stops being a panel
 *  over a scene and becomes the whole page. Measured on every clamp so a height
 *  stored on a large monitor cannot open past the bottom of a laptop, and so a
 *  window that shrinks takes the room back. */
const roomFor = () => Math.max(MIN_H, window.innerHeight - 180);
const clampH = (h: number) => Math.min(Math.max(h, MIN_H), roomFor());

export function Dopesheet({
  playheadDrawRef,
  audioPeaks,
  audioDuration,
  open,
  /** Which track the editor was opened on. */
  kind,
  /** The transport's own chrome — camera follow, loop, the collapse toggle —
   *  handed down so it can sit at the end of the toolbar instead of in a row of
   *  its own above it. See AnimPlayer's `below`. */
  trailing,
  /** What the ENGINE is doing, and how to change it. See TransportSlot. */
  enginePlaying,
  onTogglePlay,
  /** Named group to narrow the gutter to, or null for every keyed bone. */
  group = null,
}: {
  playheadDrawRef: RefObject<((frame: number) => void) | null>;
  audioPeaks: readonly number[] | null;
  audioDuration: number;
  open: boolean;
  kind: ClipEditKind;
  trailing?: ReactNode;
  enginePlaying: boolean;
  onTogglePlay: () => void;
  group?: string | null;
}) {
  const clip = useClipSelector((s) => s.clip);
  const selectedMorph = useClipSelector((s) => s.selectedMorph);
  const cameraSelected = useClipSelector((s) => s.cameraSelected);
  const morphNames = useClipSelector((s) => s.morphNames);
  // Read by the open-on-morph effect without making it a dependency — it must
  // run when the editor opens, not every time a keyframe moves.
  const clipRef = useRef(clip);
  const morphNamesRef = useRef(morphNames);
  useEffect(() => {
    clipRef.current = clip;
    morphNamesRef.current = morphNames;
  });
  const modelId = useClipSelector((s) => s.modelId);
  const clipName = useClipSelector((s) => s.clipName);
  // Which curve you are looking at is not part of the document and does not
  // belong in undo, so it stays local — but it IS worth remembering between
  // sessions, along with the zoom, the scroll and the playhead. All of it is
  // chrome; see use-timeline-view.
  const dict = useT();
  const { restored, save } = useTimelineView();
  // Clamped on the way in: a height stored on a large monitor must not open
  // taller than the window it is reopened on.
  const [height, setHeight] = useState(() => (restored?.height ? clampH(restored.height) : DEFAULT_H));
  // SHARED chrome now, so it lives in the store rather than here.
  //
  // It was local state, which was right while the timeline was the only thing
  // that had a view. The inspector's sliders point the timeline at the channel
  // being dragged — one surface writing another's view — and a value two
  // surfaces both read is what the store is for. It sits beside `boneGroup`,
  // which is there on exactly the same argument. Persisting it stays here, with
  // the rest of the view.
  const tab = useClipSelector((s) => s.tab);

  // ─── Transport, both directions ─────────────────────────────────────────
  //
  // The editor's play button writes `playing` to the store, and the store is
  // the only thing that knew about it — the scene never heard. These two
  // effects are that missing wire, and they are two rather than one because the
  // two directions are not symmetric.
  const { setSelectedBone, setSelectedMorph, setCameraSelected, setTab } =
    useClipActions();
  // Last session's tab, applied once. It cannot be a lazy initialiser any more
  // now that the value outlives this component — and it must not re-apply, or
  // it would fight every tab press for the rest of the session.
  const restoredTab = useRef<string | null>(restored?.tab ?? null);
  useEffect(() => {
    const t = restoredTab.current;
    if (!t) return;
    restoredTab.current = null;
    setTab(t);
  }, [setTab]);
  // Point the editor at the track the edit button named. Selection is what
  // decides which channel tabs exist and what the curve half draws, so opening
  // on "morph" and landing on a rotation curve for a bone nobody picked is the
  // editor ignoring the button that opened it.
  useEffect(() => {
    if (!open) return;
    setCameraSelected(kind === "camera");
    if (kind === "camera") {
      setSelectedBone(null);
      setSelectedMorph(null);
    } else if (kind === "morph") {
      setSelectedBone(null);
      // Land on a morph the clip actually keys, so the curve half has something
      // to draw. Falls back to the first morph the model has: an empty weight
      // track you can key is a better arrival than no selection at all.
      setSelectedMorph((prev) => {
        if (prev) return prev;
        for (const [name, track] of clipRef.current?.morphTracks ?? []) {
          if (track.length > 0) return name;
        }
        return morphNamesRef.current[0] ?? null;
      });
    } else {
      setSelectedMorph(null);
    }
  }, [open, kind, setCameraSelected, setSelectedBone, setSelectedMorph]);

  // The tab must BELONG to the selection.
  //
  // Keying it to `kind` was wrong in both directions: picking a morph out of
  // the list left the toolbar on a rotation tab the morph has no channel for,
  // and picking a bone afterwards left it stuck on Weight. `kind` only changes
  // when an edit button is pressed; the selection changes every time you touch
  // the picker, and the selection is what decides which tabs exist at all.
  //
  // Asked as a QUESTION about the current tab rather than as a reaction to the
  // selection changing, which is the same rule stated once instead of twice and
  // fixes the case a change-watcher structurally cannot see: the tab restored
  // from last session. There is no change on the first open, so a stored camera
  // tab survived into a bone selection — and the canvas draws camera curves
  // whenever the tab is a camera tab, so the editor opened onto curves belonging
  // to nothing that was selected, showing a tab strip that did not contain the
  // tab it was drawing. "Charts from nowhere", and the strip agreed with the
  // selection while the canvas did not.
  const selectionKind: "bone" | "morph" | "camera" = cameraSelected
    ? "camera"
    : selectedMorph
      ? "morph"
      : "bone";
  useEffect(() => {
    if (tabsForSelection(selectionKind).some((t) => t.key === tab)) return;
    setTab(defaultTabForSelection(selectionKind));
  }, [selectionKind, tab, setTab]);

  // The channel is the EDITOR's, and it SURVIVES a collapse.
  //
  // Picking a second bone while reading Trans Y keeps Trans Y: you are looking
  // at a channel across the rig, and snapping back to Rotation on every pick
  // would make comparing one channel on two bones impossible. Closing the fold
  // does not forget it either — a fold is a way of looking, and reopening it
  // should return you to what you were doing, not to the start. The rule above
  // still handles the changes that genuinely invalidate a tab: a morph has no
  // rotation to show, and a camera's tabs are its own.

  const { setPlaying, setCurrentFrame } = usePlayheadActions();
  const currentFrame = usePlayheadSelector((s) => s.currentFrame);

  // Last session's playhead, applied ONCE and only once a clip exists to apply
  // it to — restoring it against an empty editor would clamp it to zero and
  // lose it, and the clip arrives a frame or two after the fold does.
  const restoredFrame = useRef<number | null>(restored?.frame ?? null);
  useEffect(() => {
    const f = restoredFrame.current;
    if (f == null || !clip) return;
    restoredFrame.current = null;
    setCurrentFrame(Math.max(0, Math.min(clip.frameCount, f)));
  }, [clip, setCurrentFrame]);

  // WHICH clip, not how many times one has loaded.
  //
  // The timeline resets its zoom, scroll and drafts whenever this changes, so
  // it has to mean "a different clip" — and a counter cannot, because it also
  // counted reopening the fold on the same one. A stable number derived from
  // the clip's identity gives the same value every time you come back to the
  // same clip, and a new one only when you genuinely switch.
  const clipVersion = useMemo(() => {
    const key = `${modelId ?? ""}\0${clipName ?? ""}`;
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }, [modelId, clipName]);

  const wantPlaying = usePlayheadSelector((s) => s.playing);
  const frameRef = usePlayheadFrameRef();

  // ENGINE → STORE. The engine is the authority on whether anything is moving:
  // space bar, the pill's own button and the end of a clip all change it
  // without asking. On STOP the live frame is flushed into the store as well —
  // during playback the rAF writes `frameRef` without notifying anyone, so
  // without this the store still holds wherever the playhead was when play
  // started, and the first render after pausing snaps the playhead back to it.
  useEffect(() => {
    setPlaying(enginePlaying);
    if (!enginePlaying) setCurrentFrame(frameRef.current);
  }, [enginePlaying, setPlaying, setCurrentFrame, frameRef]);

  // A shorter clip must not leave the playhead past its end. Replacing a motion
  // or resetting the scene both swap in a clip of a different length while the
  // playhead stays where it was, and a ruler that ends at frame 300 with the
  // playhead at 900 draws it off-canvas — the editor looking broken when it is
  // only pointed somewhere that no longer exists.
  const frameCount = clip?.frameCount ?? 0;
  useEffect(() => {
    if (frameCount <= 0) return;
    setCurrentFrame((f) => Math.min(f, frameCount));
  }, [frameCount, setCurrentFrame]);

  // STORE → ENGINE, on deliberate changes only. Refs for everything except the
  // trigger, so this fires when someone presses the editor's play button and
  // not when the effect above mirrors a state the engine is already in.
  const engineIsPlaying = useRef(enginePlaying);
  const toggleRef = useRef(onTogglePlay);
  useEffect(() => {
    engineIsPlaying.current = enginePlaying;
    toggleRef.current = onTogglePlay;
  });
  const lastWanted = useRef(wantPlaying);
  useEffect(() => {
    if (wantPlaying === lastWanted.current) return;
    lastWanted.current = wantPlaying;
    if (wantPlaying !== engineIsPlaying.current) toggleRef.current();
  }, [wantPlaying]);

  // Rows are the bones that HAVE keys, which is the whole difference between a
  // dopesheet and a bone browser: a channel list shows what the clip contains,
  // not what the model could hold. Keying a bone for the first time is the
  // viewport's job (double-click picks one) — a permanent list of two hundred
  // names to find the one you already clicked is the panel this replaces.
  const visibleBones = useMemo(() => {
    if (!clip) return [];
    const keyed = [...clip.boneTracks.keys()];
    const g = group ? BONE_GROUPS[group] : null;
    // Group order, not clip order: BONE_GROUPS is authored head-down, and a
    // gutter sorted by whatever order the VMD happened to store its tracks in
    // reads as unsorted even though it isn't.
    if (!g) return keyed;
    return g.filter((name) => keyed.includes(name));
  }, [clip, group]);

  // Reads the playhead through a ref rather than taking it as a dep: a view
  // change is a zoom or a scroll, and rebuilding this callback on every frame
  // of a scrub would make the timeline's own onViewChange effect re-run with it.
  // The whole stored view, assembled from the two halves that move
  // independently: the timeline reports zoom and scroll, the drag handle below
  // reports height, and either can be the one that changed. Refs, so a scrub
  // does not rebuild the callback the timeline is holding.
  const viewRef = useRef({ pxPerFrame: 0, yZoom: 0, scrollX: 0 });
  const tabForSave = useRef(tab);
  const heightForSave = useRef(height);
  const frameForSave = useRef(currentFrame);
  useEffect(() => {
    tabForSave.current = tab;
    heightForSave.current = height;
    frameForSave.current = currentFrame;
  });
  const persist = useCallback(() => {
    if (viewRef.current.pxPerFrame <= 0) return;
    save({
      ...viewRef.current,
      tab: tabForSave.current,
      height: heightForSave.current,
      frame: frameForSave.current,
    });
  }, [save]);

  // Scrubbing is a change to the view like any other. The 400ms settle in
  // use-timeline-view is what keeps a drag from being four hundred writes.
  useEffect(() => {
    persist();
  }, [currentFrame, persist]);
  const onViewChange = useCallback(
    (v: { pxPerFrame: number; yZoom: number; scrollX: number }) => {
      viewRef.current = v;
      persist();
    },
    [persist],
  );

  // ─── The drag ──────────────────────────────────────────────────────────
  //
  // Pointer capture, so a fast drag that leaves the 6px strip keeps resizing
  // rather than stopping wherever the pointer crossed the edge. Written on
  // every move — the canvas is what the user is judging, and a preview line
  // would show them a number instead of the thing the number does — and stored
  // once, on release.
  const drag = useRef<{ y: number; h: number } | null>(null);
  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { y: e.clientY, h: heightForSave.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // UP is taller: the editor is anchored to the bottom of the window and
    // grows into the canvas.
    setHeight(clampH(d.h - (e.clientY - d.y)));
  }, []);
  const onResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      drag.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Capture can already be gone (pointercancel); nothing to release.
      }
      persist();
    },
    [persist],
  );

  // A window that shrinks under a tall editor takes the room back.
  useEffect(() => {
    const onResize = () => setHeight((h) => clampH(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    // grid-rows 0fr→1fr animates to the inner element's height without anyone
    // measuring it. The inner element owns overflow-hidden; the row animates.
    <div
      data-undo-scope={CLIP_UNDO_SCOPE}
      className={cn(
        "grid min-w-0 transition-[grid-template-rows]",
        FOLD,
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      {/* w-0 min-w-full is what stops the editor sizing the PANEL.
          The pill's open/closed width transitions out of `max-w-fit`, and
          fit-content is resolved against the widest thing inside — which, once
          this subtree exists, is a toolbar of nowrap shrink-0 controls and a
          canvas. So the transition began at that intrinsic width and travelled
          DOWN to the cap: the panel flashing to full screen and then pulling
          back. Zero base width means this contributes nothing to the parent's
          intrinsic size while min-w-full still makes it fill the row, so
          fit-content stays what it always was — the collapsed pill. */}
      <div className="w-0 min-w-full overflow-hidden" inert={!open}>
        {/* Border on the INNER element, so it folds away with the editor rather
            than drawing a line under a closed pill.

            The fade is asymmetric on purpose. The fold only CLIPS — the content
            stays fully opaque under the shrinking edge, so the last visible
            strip used to vanish in one frame, a flash right at the end of the
            close. Fading out over half the fold means the fold closes over
            something already gone; opening gets the full duration, since content
            arriving with the fold is what a fold should look like. */}
        <div
          // An inline height, not a class: Tailwind scans source for whole class
          // names, so a computed `h-[${n}px]` produces no CSS at all.
          style={{ height }}
          className={cn(
            "relative border-t border-line transition-opacity ease-out",
            open ? "opacity-100 duration-300" : "opacity-0 duration-150",
          )}
        >
          {/* The top edge, which is already a line — so the handle is a hit area
              over it rather than another piece of furniture. It brightens on
              hover and while dragging, which is the whole affordance: a grip
              texture on a 6px strip is decoration at this size. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={dict.lab.timeline.resize}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            className="group absolute inset-x-0 -top-[3px] z-10 h-1.5 cursor-ns-resize touch-none"
          >
            <div className="mt-[2px] h-px w-full bg-transparent transition-colors group-hover:bg-blue-400/60 group-active:bg-blue-400" />
          </div>
          {/* Picker beside the editor, not above it: both are about the same
              clip and reading across is how you work — pick a bone on the left,
              read its curve on the right. */}
          <div className="flex h-full w-full">
            <TrackPicker kind={kind} />
            <div className="min-w-0 flex-1">
              <Timeline
                visibleBones={visibleBones}
                // Baselined, so the FIRST clip to arrive does not count as a
                // swap. The timeline resets its zoom and scroll whenever this
                // changes, and the first change is the clip loading into an
                // editor that has just restored last session's view — counting
                // it would wipe the restore every time the fold opened.
                clipVersion={clipVersion}
                open={open}
                tab={tab}
                setTab={setTab}
                playheadDrawRef={playheadDrawRef}
                audioPeaks={audioPeaks}
                audioDuration={audioDuration}
                trailing={trailing}
                initialView={
                  restored
                    ? {
                        pxPerFrame: restored.pxPerFrame,
                        yZoom: restored.yZoom,
                        scrollX: restored.scrollX,
                      }
                    : undefined
                }
                onViewChange={onViewChange}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
