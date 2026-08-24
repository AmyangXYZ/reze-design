// Making a media element agree with the clip's clock — the one policy, shared.
//
// It was written once for the backdrop and is wanted again for every moving
// card, and two copies of a rule this fiddly would diverge on the first fix.
// What it is:
//
//   PLAYING   free-run. Stamped at the start and on a discrete jump, then LEFT
//             ALONE. Continuous correction — a seek every frame, or bending
//             playbackRate toward the clip — is what this project measured as
//             the cause of stutter on Safari, and real drift over a dance is
//             milliseconds nobody sees.
//   STOPPED   pause, and seek ONLY if the scene time moved. Stopping is not a
//             reason to move the picture: an element free-running against the
//             clip sits within a frame of it, and correcting that on the way
//             into a pause is a picture that visibly changes after the
//             character has stopped. Only a scrub is, and a moving picture is
//             the point of a scrub.
//
// The cost of that last rule is that a paused preview can be one frame from
// what an offline render would write for the same moment. Invisible, and it
// never reaches a file: an export decodes its own frames from the source.

/** A backward step this small is a loop wrapping rather than a seek. */
const WRAP_EPS = 1e-4
/** Past this the two are not describing the same moment — stamp, do not drift. */
const JUMP = 0.35

export type MediaFollower = (video: HTMLVideoElement, time: number, playing: boolean) => void

/** One follower per element: the state is per-element and sharing it would make
 *  two cards each think the other's seek was their own. */
export function createMediaFollower(): MediaFollower {
  let wasPlaying = false
  let lastWant: number | null = null
  let lastTime = -1

  return (video, time, playing) => {
    // Metadata decides the wrap and the seek target; before it, duration is NaN
    // and every number below is nonsense.
    if (!video.src || video.readyState < 1) return

    const jumped = lastTime >= 0 && Math.abs(time - lastTime) > JUMP
    lastTime = time
    const span = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    // Wrapped into the media's own length, so a clip longer than the video
    // seeks somewhere inside it rather than past its end — which clamps, and
    // then nothing plays again for the rest of the take.
    const want = span ? ((time % span) + span) % span : time

    if (playing) {
      if (!wasPlaying || (!video.seeking && jumped)) video.currentTime = want
      if (video.paused) void video.play().catch(() => {})
      lastWant = null
    } else {
      if (!video.paused) video.pause()
      if (lastWant !== null && Math.abs(want - lastWant) > WRAP_EPS) video.currentTime = want
      lastWant = want
    }
    wasPlaying = playing
  }
}
