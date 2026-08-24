"use client"

// A gif, animated webp or APNG backdrop, drawn frame by frame from the clip's
// clock.
//
// AN <img> ANIMATES ON THE BROWSER'S CLOCK. It starts when the bytes arrive,
// never stops, and knows nothing about the transport — so pausing the scene left
// the background looping, scrubbing did nothing to it, and the frame on screen
// had no relationship to the frame the export would write at that time. It
// looked animated and was simply unrelated. There is no element to tell what
// time it is, so the picture comes off the <img> and onto a canvas this draws.
//
// Video does NOT come through here. It keeps a real <video>, because a decoded
// frame costs a full-resolution copy per frame on the thread the 3D render is
// already using — survivable at 1080p60, not at 4K60 — while an element hands
// its frames to the compositor with no copy at all. See use-audio-clock.
//
// FRAMES ARE NOT HELD. One decoded frame at a time: an output-sized frame is
// 33 MB at 4K, and a few hundred is the whole GPU budget for something behind
// everything else. A decode is only requested when the wanted frame CHANGES,
// which at a gif's ~10 fps against a 60 Hz tick is five ticks in six doing
// nothing at all.

import { useCallback, useEffect, useRef } from "react"
import { openAnimatedImage, type BackdropMedia } from "@/lib/backdrop"

type Source = {
  /**
   * Paint the frame for a time inside the media, if it is not already up.
   *
   * The SOURCE draws, rather than handing a frame back to be drawn, because the
   * cheapest way there differs by kind and the copies are the cost — a decoded
   * video frame goes straight onto the destination, where returning it would
   * mean landing it somewhere first.
   *
   * Synchronous by contract: it may start work, never wait for it.
   */
  paint(t: number, canvas: HTMLCanvasElement): void
  /** Total run time, for the wrap. */
  span: number
  close(): void
}

/** Resize only when it changes: assigning width or height CLEARS the canvas,
 *  and doing that per frame blanks the picture between clear and draw. */
function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

/**
 * A gif / animated webp / APNG, through WebCodecs' ImageDecoder.
 *
 * Random access is genuinely cheap here — these are small, intra-coded and
 * already fully buffered — so this keeps one decoded frame and replaces it when
 * the index changes. At a gif's ~10 fps against a 60 Hz tick, five ticks in six
 * ask for the frame already on screen and do nothing.
 */
async function imageSource(file: File): Promise<Source | null> {
  const opened = await openAnimatedImage(file)
  if (!opened) return null
  const { dec, frames } = opened
  // WHEN each frame ends. These formats carry a per-frame delay rather than a
  // frame rate, so there is no arithmetic that skips this walk — but the frames
  // themselves are closed as they are counted.
  const ends: number[] = []
  let acc = 0
  for (let i = 0; i < frames; i++) {
    const { image } = await dec.decode({ frameIndex: i })
    // Microseconds. A frame with no stated delay runs at the 100 ms every
    // decoder substitutes for one.
    acc += (image.duration ?? 100_000) / 1e6
    image.close()
    ends.push(acc)
  }

  let shown = -1
  let current: VideoFrame | null = null
  let busy = false
  let closed = false

  let painted = -1

  return {
    span: Math.max(acc, 1 / 1000),
    paint(t, canvas) {
      let want = 0
      while (want < ends.length - 1 && t >= ends[want]) want++
      if (want !== shown && !busy && !closed) {
        busy = true
        void dec
          .decode({ frameIndex: want })
          .then(({ image }) => {
            if (closed) {
              image.close()
              return
            }
            current?.close()
            current = image
            shown = want
          })
          .catch(() => {})
          .finally(() => {
            busy = false
          })
      }
      if (!current || shown === painted) return
      const cx = canvas.getContext("2d")
      if (!cx) return
      fit(canvas, current.displayWidth, current.displayHeight)
      cx.clearRect(0, 0, canvas.width, canvas.height)
      cx.drawImage(current, 0, 0)
      painted = shown
    },
    close() {
      closed = true
      current?.close()
      current = null
      dec.close()
    },
  }
}

export function useMediaBackdrop(media: BackdropMedia | null) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const source = useRef<Source | null>(null)

  const moving = media !== null && media.kind === "animated"
  const file = moving ? media.file : null

  useEffect(() => {
    source.current = null
    if (!media || !moving) return

    let dead = false
    void (async () => {
      const opened = await imageSource(media.file).catch(() => null)
      if (!opened) return
      if (dead) {
        opened.close()
        return
      }
      source.current = opened
    })()

    return () => {
      dead = true
      source.current?.close()
      source.current = null
    }
    // `file` rather than `media`: the object is rebuilt on unrelated edits, and
    // reopening a decoder mid-scrub drops the picture for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, moving])

  /** Paint the frame for a scene time, wrapping into the media's own length. */
  const draw = useCallback((time: number) => {
    const src = source.current
    const canvas = canvasRef.current
    if (!src || !canvas) return
    // Modulo twice: a negative scene time would otherwise index off the front.
    src.paint(((time % src.span) + src.span) % src.span, canvas)
  }, [])

  return { canvasRef, draw, moving }
}
