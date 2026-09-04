// Reading the light out of a plate.
//
// WHAT IS ACTUALLY RECOVERABLE, and what is not. A single frame carries a great
// deal about the light in it and almost nothing about one thing:
//
//   * The COLOUR of the ambient is in the shadows. Whatever is not lit directly
//     is lit by everything else in the room, so the darker half of the picture
//     is a fair sample of it — the oldest approximation there is, and the reason
//     a figure lit magenta can never belong in a brown hall.
//   * The COLOUR of the key is in the highlights, once brightness is divided out
//     so what is left is a hue rather than an exposure.
//   * HOW DIRECTIONAL the light is comes out of the spread between the bright
//     and dark ends. A hard sun separates a scene into lit and unlit; an
//     overcast sky or a ceiling full of diffusers does not. This is what decides
//     whether a shadow should have an edge at all, and a razor edge under a soft
//     light is the loudest thing wrong in a composite after the feet.
//   * The AZIMUTH is guessed, honestly, from which side of the frame is
//     brighter. A window on the left really does make the left brighter, and it
//     is right more often than a stock value is — but it is a guess, and it is
//     reported as one so the caller can leave the slider alone if it looks wrong.
//
// The ELEVATION is not recoverable at all and is not attempted. Nothing in a
// picture of a room says how high its lights hang; the vertical brightness of
// the frame is a fact about the ceiling and the floor, not about the lamp. It is
// left where the author had it.
//
// No learning, and nothing iterative: one pass over a sample of the pixels, the
// same answer every time.

/** A frame to read, as RGBA — an ImageData, or anything shaped like one. */
export type LightFrame = { data: Uint8ClampedArray; width: number; height: number }

export type PlateLight = {
  /** Ambient colour, `#rrggbb`, from what the picture leaves unlit. */
  ambient: string
  /** Key colour, `#rrggbb` — a hue, normalised away from its own brightness so
   *  it tints the sun without also setting how strong it is. */
  key: string
  /**
   * How directional the light is, 0–1. 1 is a hard sun that splits the room into
   * lit and unlit; 0 is an overcast sky or a ceiling of diffusers, which throws
   * no edge at all.
   */
  directionality: number
  /** What the shadow's edge should be, which is simply the other side of that. */
  softness: number
  /** Which way the key comes from, degrees, in the same convention the sun's own
   *  slider uses. A GUESS from the brighter side of the frame — see `azimuthGuess`. */
  azimuth: number
  /** Always true, and named so a caller cannot forget: the azimuth is the one
   *  number here the picture does not really answer. */
  azimuthGuess: true
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`

/**
 * Read the light.
 *
 * `cameraAzimuth` is where the camera is looking, degrees, so the answer can be
 * given in world terms rather than relative to the frame — the sun's slider means
 * a compass bearing, not "to the left of the shot".
 */
export function estimatePlateLight(frame: LightFrame, cameraAzimuth = 0): PlateLight {
  const px: { l: number; r: number; g: number; b: number; x: number }[] = []
  // Coarse and prime-strided, so the sample cannot fall in step with the row
  // width and read one column of the picture as the whole of it.
  const stride = 4 * 37
  for (let i = 0; i < frame.data.length; i += stride) {
    const r = frame.data[i]
    const g = frame.data[i + 1]
    const b = frame.data[i + 2]
    const p = (i / 4) % frame.width
    px.push({ l: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b, x: p / Math.max(1, frame.width - 1) })
  }
  if (px.length < 16) {
    return { ambient: "#808080", key: "#ffffff", directionality: 0.5, softness: 0.5, azimuth: 0, azimuthGuess: true }
  }
  const byL = [...px].sort((a, b) => a.l - b.l)
  const at = (q: number) => byL[Math.min(byL.length - 1, Math.floor(q * byL.length))]
  const p10 = at(0.1).l
  const p90 = at(0.9).l

  // The darker half is the ambient's sample; the brightest fifth is the key's.
  const dark = byL.slice(0, Math.floor(byL.length * 0.5))
  const lit = byL.slice(Math.floor(byL.length * 0.8))
  const mean = (set: typeof px) =>
    set.reduce((a, p) => [a[0] + p.r, a[1] + p.g, a[2] + p.b], [0, 0, 0]).map((v) => v / Math.max(1, set.length))
  const [ar, ag, ab] = mean(dark)
  const [kr, kg, kb] = mean(lit)
  // The key's HUE: divided through by its own brightness and put back at white's,
  // so it tints the sun without also deciding how strong the sun is. That is the
  // strength dial's job, and a key sampled straight from a bright window would
  // quietly take it over.
  const kl = Math.max(1, (kr + kg + kb) / 3)
  const keyHue = [kr, kg, kb].map((v) => (v / kl) * 235)

  // Directionality: how far apart the ends are. A hard sun drives them apart; a
  // room under diffusers holds them together. Scaled so a normal indoor picture
  // lands mid-range rather than pinned at either stop.
  const directionality = Math.min(1, Math.max(0, (p90 - p10) / 160))

  // The azimuth guess: which side is brighter, weighted by how much brighter.
  // Turned into a bearing about the camera's own heading, since a light that is
  // "to the left of the shot" is a different statement in every shot.
  let wl = 0
  let wr = 0
  for (const p of px) {
    if (p.x < 0.45) wl += p.l
    else if (p.x > 0.55) wr += p.l
  }
  const bias = (wr - wl) / Math.max(1, wr + wl)
  // ±70° off the camera's heading at full bias. Beyond that the light would be
  // behind the shot, which the brightness of the frame cannot tell us.
  const azimuth = (((cameraAzimuth + bias * 70) % 360) + 360) % 360

  return {
    ambient: hex(ar, ag, ab),
    key: hex(keyHue[0], keyHue[1], keyHue[2]),
    directionality,
    softness: 1 - directionality,
    azimuth,
    azimuthGuess: true,
  }
}
