"use client"

// The expanded timeline: three kinds of lane, one axis, one playhead.
//
// Its own component, and not only for tidiness. Inlined in page.tsx this sat
// about ten elements deep inside AnimPlayer's `below`, and that last level of
// nesting was enough to make the React Compiler skip optimising the whole Lab
// component — it reported losing the manual memoization on three unrelated
// useCallbacks far above. A view this self-contained had no business being
// welded into a 5,000-line component anyway.
//
// It is a VIEW. Clips are dropped in from the assets panel; nothing here uploads,
// trims or reorders. What it answers is "how long is each of these, and where am
// I in them" — which nothing else in the editor answers at all.

import { useMemo, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import type { Engine } from "reze-engine"
import type { Scrub } from "@/components/scene/anim-player"
import { useLaneDurations } from "@/hooks/use-lane-durations"
import { useAudioPeaks, useCameraDensity, useClipDensity } from "@/hooks/use-lane-graphs"
import { LaneGraph } from "@/components/scene/lane-graph"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const displayName = (file: string) => file.replace(/\.pmx$/i, "")

/** The transport's fold curve. Mirrored here because the fold's chrome moved in
 *  with the lanes it folds; keep the two in step if either changes. */
const FOLD = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"


/** One row of the timeline. Fixed height and a fixed label column, so lanes of
 *  different kinds still read as one grid. */
function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative h-10">
      {/* Mono, uppercase and tracked — the study's lane key. It names the KIND of
          thing the lane holds, so it must not look like content. */}
      <span
        className="absolute top-1/2 left-4 -translate-y-1/2 truncate font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase"
        style={{ width: "calc(var(--track-left, 7.5rem) - 1.5rem)" }}
      >
        {label}
      </span>
      {/* Pinned to the transport's own track, measured and published by
          AnimPlayer. A lane that starts where the scrub bar starts and ends
          where it ends is the whole reason the playhead above it means
          anything; inset by a guessed constant it is decoration that happens to
          sit near the truth. */}
      <span
        className="absolute top-1/2 h-7 -translate-y-1/2"
        style={{ left: "var(--track-left, 7.5rem)", right: "var(--track-right, 1rem)" }}
      >
        {children}
      </span>
    </div>
  )
}

/**
 * What a lane holds, drawn as long as the clip actually runs.
 *
 * `span` is this clip's share of the longest lane in the scene. Without one the
 * block fills its row, which is what every block did before there was a shared
 * time axis to measure against — a block sized like a measurement that is not
 * one is worse than one that plainly fills its lane.
 *
 * Being proportional is the point: a camera VMD that stops before the dance
 * ends, or music that outruns it, is invisible everywhere else in the editor
 * and obvious here at a glance.
 *
 * The floor stops a very short clip collapsing to a hairline — a lie about
 * duration at the extreme, where the truthful alternative is a block too small
 * to see or to hit.
 */
function LaneBlock({
  children,
  span,
  graph,
  mirrored,
  empty,
}: {
  children?: ReactNode
  span?: number
  /** One value per column, 0..1 — density for a motion, peaks for music. */
  graph?: number[] | null
  mirrored?: boolean
  /**
   * Nothing loaded in this lane.
   *
   * The SAME element, not a separate placeholder: identical box, border, radius
   * and vertical position, so a lane does not change shape when its clip
   * arrives. Static, because a pulse says "loading" and an absent camera is not
   * on its way — it is simply not there.
   */
  empty?: boolean
}) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 left-0 flex items-center overflow-hidden rounded-interior border text-xs whitespace-nowrap",
        empty ? "border-line bg-white/[0.06]" : "border-blue-400/50 bg-blue-400/25 text-foreground",
      )}
      style={{ width: span && span > 0 ? `max(0.75rem, ${Math.min(1, span) * 100}%)` : "100%" }}
    >
      {/* Behind the name, dimmer than it. The graph is the shape of the clip and
          the name is what it IS — a graph that competes with the label makes the
          block harder to identify to show something you can read at a glance
          anyway. */}
      {graph && graph.length > 0 && (
        <span className="absolute inset-0 text-blue-300/45">
          <LaneGraph values={graph} mirrored={mirrored} />
        </span>
      )}
      <span className="relative truncate px-2.5">{children}</span>
    </span>
  )
}

/**
 * One cast member's motion lane.
 *
 * Its own component only so it can own its own density hook — one per model, and
 * hooks cannot be called from inside a map. Everything else about it is a Lane
 * with a LaneBlock in it.
 */
function MotionLane({
  engineRef,
  modelId,
  clipName,
  label,
  span,
}: {
  engineRef: RefObject<Engine | null>
  modelId: string
  clipName: string | null
  label: string
  span?: number
}) {
  const density = useClipDensity({ engineRef, modelId, clipName })
  return (
    <Lane label={label}>
      {clipName ? (
        <LaneBlock span={span} graph={density}>
          {clipName}
        </LaneBlock>
      ) : (
        <LaneBlock empty />
      )}
    </Lane>
  )
}

/**
 * The whole stack: a lane per cast member, then the camera and the music.
 *
 * Camera and music always show, even with an empty cast — the timeline's shape
 * should not depend on what happens to be loaded into it.
 */
export function TimelineLanes({
  engineRef,
  models,
  clipByModel,
  cameraClip,
  music,
  audioRef,
  playableDuration,
  scrubRef,
  open,
}: {
  engineRef: RefObject<Engine | null>
  /** The CAST — stages excluded. A stage never carries a motion, and giving one
   *  an animation lane is the same mistake that once had the camera VMD tracking
   *  scenery. */
  models: { id: string; file: string }[]
  clipByModel: Record<string, string | undefined>
  cameraClip: string | null
  music: { name: string; url: string } | null
  audioRef: RefObject<HTMLAudioElement | null>
  /** How far the scene actually PLAYS — the master clip, which can be shorter
   *  than the axis when the music outruns it. */
  playableDuration: number
  scrubRef: RefObject<Scrub | null>
  open: boolean
}) {
  const t = useT()
  // Owned here rather than by the page: nothing above this component reads a
  // lane's length any more, now that the axis is the scene's own clock.
  const signature = useMemo(
    () =>
      [
        ...models.map((m) => `${m.id}\u0000${clipByModel[m.id] ?? ""}`),
        `camera\u0000${cameraClip ?? ""}`,
        `music\u0000${music?.name ?? ""}`,
      ].join("\u0001"),
    [models, clipByModel, cameraClip, music],
  )
  const durations = useLaneDurations({
    engineRef,
    audioRef,
    modelIds: models.filter((m) => clipByModel[m.id]).map((m) => m.id),
    hasCamera: cameraClip !== null,
    hasAudio: music !== null,
    signature,
    enabled: open,
  })
  /**
   * The axis is what PLAYS, which is the master clip — not the longest asset.
   *
   * It spanned the longest of everything at first, so that music outrunning the
   * dance would be visible. That cost more than it bought: the transport's bar
   * spans the master, so the two ran at different scales and the playhead sat
   * somewhere the thumb above it was not. A timeline whose playhead disagrees
   * with its own transport is wrong before it is informative. A clip longer than
   * the scene now simply fills its lane; the part past the end is time that
   * never plays.
   *
   * Falls back to the longest known length while no clip has reported one, so an
   * audio-only scene still draws something.
   */
  const axis = playableDuration > 0 ? playableDuration : durations.axis
  const peaks = useAudioPeaks({ url: music?.url ?? null })
  const cameraGraph = useCameraDensity({ engineRef, clipName: cameraClip })
  /** A clip's share of the longest lane, or undefined while nothing has answered. */
  const span = (seconds: number) => (axis > 0 && seconds > 0 ? seconds / axis : undefined)

  const seek = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    // One scale with the bar above, so a click lands where it looks like it will.
    scrubRef.current?.to(ratio * axis)
  }

  return (
    // grid-rows 0fr→1fr is the one way to animate to CONTENT height without
    // measuring it. The inner element owns overflow-hidden; the row animates.
    //
    // The fold's own wrappers live here rather than at the call site, and not
    // only for tidiness: three more levels of nesting around this at the call
    // site was enough to push the React Compiler past what it will optimise,
    // and it responded by skipping the entire 5,000-line page component.
    <div className={cn("grid transition-[grid-template-rows]", FOLD, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="overflow-hidden" inert={!open}>
        {/* Border on the INNER element, so it folds away with the lanes instead
          of drawing a line under a closed pill.

          The fade is asymmetric on purpose. The fold only CLIPS the lanes — they
          stay fully opaque under the shrinking edge, so the last visible strip
          vanished in one frame, a flash right at the end of the close. Fading
          out at half the fold's duration means the fold closes over content that
          is already gone; opening gets the full duration, since content arriving
          with the fold is what a fold should look like. */}
        <div
          className={cn(
            "relative border-t border-line pt-3 pb-4 transition-opacity ease-out",
            open ? "opacity-100 duration-300" : "opacity-0 duration-150",
          )}
        >
      {/* A motion lane even with no cast.
        The stack is three rows from the moment it opens and stays three rows —
        a panel that grows a row when the models finish loading moves everything
        under it, and the fold's own height animation makes that read as a
        glitch rather than as arrival. */}
      {models.length === 0 && (
        <Lane label={t.lab.lanes.animation}>
          <LaneBlock empty />
        </Lane>
      )}
      {models.map((m) => (
        <MotionLane
          key={m.id}
          engineRef={engineRef}
          modelId={m.id}
          clipName={clipByModel[m.id] ?? null}
          label={models.length > 1 ? displayName(m.file) : t.lab.lanes.animation}
          span={span(durations.byModel[m.id] ?? 0)}
        />
      ))}
      <Lane label={t.lab.lanes.camera}>
        {cameraClip ? (
          <LaneBlock span={span(durations.camera)} graph={cameraGraph}>
            {cameraClip}
          </LaneBlock>
        ) : (
          <LaneBlock empty />
        )}
      </Lane>
      <Lane label={t.lab.lanes.music}>
        {music ? (
          <LaneBlock span={span(durations.audio)} graph={peaks} mirrored>
            {music.name}
          </LaneBlock>
        ) : (
          <LaneBlock empty />
        )}
      </Lane>
      {/* Spanning the transport's own track, so 0% and 100% are the scrub bar's
        ends and not the panel's. Positioned from --playhead, which AnimPlayer's
        rAF writes on the same throttled tick as the bar — no React render, and
        no second clock to drift against.

        Hidden until something has reported a length: a playhead pinned at 0
        across full-width blocks measures nothing. */}
      {axis > 0 && (
        <div
          role="slider"
          tabIndex={-1}
          aria-label={t.transport.scrub}
          aria-valuemin={0}
          aria-valuemax={Math.round(axis)}
          aria-valuenow={Math.round(playableDuration)}
          className="absolute inset-y-0 cursor-pointer touch-none select-none"
          style={{ left: "var(--track-left, 7.5rem)", right: "var(--track-right, 1rem)" }}
          onPointerDown={(e) => {
            scrubRef.current?.begin()
            e.currentTarget.setPointerCapture(e.pointerId)
            seek(e)
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 0) seek(e)
          }}
          onPointerUp={() => scrubRef.current?.end()}
          onPointerCancel={() => scrubRef.current?.end()}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-blue-400"
            style={{ left: "calc(var(--playhead, 0) * 100%)" }}
          >
            {/* reze-studio's head, 10 wide and 7 tall, pointing down at the top
              of the line — the shape a playhead has in every editor, so it needs
              no explaining. Blue, not studio's red: here red is reserved for
              destructive, and a red line across the clips would read as a
              warning about them rather than a position in them. */}
            <div className="absolute -top-px left-1/2 size-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-blue-400" />
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
