"use client"

// The picture behind a scene — a still, a drawn animation, or a video — as one
// layer every page that shows a scene renders. Where it sits (the letterbox, the
// export frame) is the page's business and arrives as className/style; what
// element carries each kind of picture is not, and lives here once.

import type { CSSProperties, RefObject } from "react"
import type { BackdropMedia } from "@/lib/backdrop"

export function SceneBackdrop({
  media,
  moving,
  canvasRef,
  videoRef,
  className,
  style,
}: {
  /** The flat backdrop or plate in the shot, or null. Never the dome — that one
   *  is the engine's, drawn in-canvas. */
  media: BackdropMedia | null
  /** useMediaBackdrop's answer: the picture is an animation it draws… */
  moving: boolean
  /** …onto this canvas, per frame, by the clip's clock. */
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** The video element, which the audio clock keeps on the scene's time. */
  videoRef: RefObject<HTMLVideoElement | null>
  className?: string
  style?: CSSProperties
}) {
  if (!media) return null
  if (media.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={media.url} alt="" className={className} style={style} />
  // A gif/webp/apng, painted per frame by the clip's clock — an <img> would
  // animate on the browser's clock instead, and an export would freeze it.
  if (moving) return <canvas ref={canvasRef} className={className} style={style} />
  if (media.kind === "video")
    return (
      // Played natively — the compositor handles the frames, which is what holds
      // 4K60. muted is not a preference: a backdrop is picture, its own
      // soundtrack would play under the scene's music, and muted is also what
      // lets it start without a user gesture. playsInline keeps iOS from taking
      // it fullscreen. loop matches the follower's wrap: a clip longer than the
      // video seeks INSIDE it, never past its end.
      <video
        key={media.url}
        ref={videoRef}
        src={media.url}
        muted
        loop
        playsInline
        preload="auto"
        className={className}
        style={style}
      />
    )
  return null
}
