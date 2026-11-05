// Tests for lib/lipsync-audio: lip sync from the music, alone and with lyrics.
//
//   npx esbuild lib/lipsync-audio.test.mts --bundle --platform=node --format=esm --tsconfig=tsconfig.json --outfile=/tmp/t.mjs && node /tmp/t.mjs
//
// The audio is synthesised, so every case knows to the sample when the voice
// sings. A "voice" is what the detector looks for: partials in the 300-3500 Hz
// band, centred in the stereo image, with vibrato moving their pitch. A held
// steady tone is what it must ignore.

import { FPS, type LyricLine, type MorphKeyframe } from "reze-engine"
import { lipSyncFromAudio, lipSyncFromLyricsAndAudio } from "@/lib/lipsync-audio"

let failed = 0
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`)
  if (!ok) failed++
}

type Part = { t0: number; t1: number; vibrato: boolean }

/** Seconds of audio with a voice (or a steady tone) in each part, silence elsewhere. */
function song(seconds: number, parts: Part[], rate = 48000, channels = 2): AudioBuffer {
  const n = Math.round(seconds * rate)
  const x = new Float32Array(n)
  for (const p of parts) {
    let phase = 0
    for (let i = Math.round(p.t0 * rate); i < Math.min(n, Math.round(p.t1 * rate)); i++) {
      const t = i / rate
      // 5.5 Hz vibrato of ±3%, as a singer holds a note; none for the steady tone.
      const f0 = 330 * (1 + (p.vibrato ? 0.03 * Math.sin(2 * Math.PI * 5.5 * t) : 0))
      phase += (2 * Math.PI * f0) / rate
      let s = 0
      for (let h = 1; h <= 8; h++) s += Math.sin(h * phase) / h
      x[i] = 0.2 * s
    }
  }
  return {
    sampleRate: rate,
    numberOfChannels: channels,
    length: n,
    duration: seconds,
    getChannelData: () => x,
  } as unknown as AudioBuffer
}

/** A track's weight per frame, linear between keys. */
function curve(keys: MorphKeyframe[] | undefined, frames: number): Float32Array {
  const c = new Float32Array(frames)
  if (!keys) return c
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    for (let f = a.frame; f < b.frame && f < frames; f++) c[f] = a.weight + ((b.weight - a.weight) * (f - a.frame)) / (b.frame - a.frame)
  }
  return c
}

/** How open the mouth is per frame: every vowel track, summed. */
function mouthOf(tracks: Map<string, MorphKeyframe[]>, frames: number): Float32Array {
  const m = new Float32Array(frames)
  for (const keys of tracks.values()) curve(keys, frames).forEach((w, f) => (m[f] += w))
  return m
}

/** The first and last frame the mouth is open. */
function openSpan(c: Float32Array): [number, number] | null {
  let first = -1
  let last = -1
  c.forEach((w, f) => {
    if (w > 0.02) {
      if (first < 0) first = f
      last = f
    }
  })
  return first < 0 ? null : [first, last]
}

// ── Lip sync from the music ──

{
  const { tracks, frameCount } = lipSyncFromAudio(song(5, [{ t0: 2, t1: 3, vibrato: true }]))
  const span = openSpan(mouthOf(tracks, frameCount))
  check("a sung second opens the mouth", span !== null)
  // The window is centred on each frame's time: the mouth opens ON the voice.
  // Before that fix it opened a frame and a half early.
  check("it opens on the frame the voice starts", !!span && Math.abs(span[0] - 2 * FPS) <= 1, `frame ${span?.[0]}, voice at ${2 * FPS}`)
  // It closes as a hand-keyed mouth does: over a fifth of a second once she stops.
  check("and is shut within 0.3 s of it stopping", !!span && span[1] >= 3 * FPS && span[1] - 3 * FPS <= 9, `frame ${span?.[1]}, voice ends ${3 * FPS}`)
  check("the track spans the song", frameCount === 5 * FPS, `${frameCount} frames`)
}

{
  const r48 = openSpan(mouthOf(lipSyncFromAudio(song(5, [{ t0: 2, t1: 3, vibrato: true }])).tracks, 150))
  const r44 = openSpan(mouthOf(lipSyncFromAudio(song(5, [{ t0: 2, t1: 3, vibrato: true }], 44100)).tracks, 150))
  check("44.1 kHz times it the same", !!r48 && !!r44 && Math.abs(r48[0] - r44[0]) <= 1, `${r44?.[0]} vs ${r48?.[0]}`)
  const mono = openSpan(mouthOf(lipSyncFromAudio(song(5, [{ t0: 2, t1: 3, vibrato: true }], 48000, 1)).tracks, 150))
  check("a mono file times it the same", !!r48 && !!mono && Math.abs(r48[0] - mono[0]) <= 1, `${mono?.[0]} vs ${r48?.[0]}`)
}

{
  const { tracks } = lipSyncFromAudio(song(4, []))
  check("silence opens nothing", tracks.size === 0)
  const steady = lipSyncFromAudio(song(4, [{ t0: 1, t1: 3, vibrato: false }])).tracks
  check("a held steady tone opens nothing", steady.size === 0, `${[...steady.keys()].join(", ")}`)
}

{
  // Syllables of one phrase, 0.2 s apart: the mouth sinks between them and does
  // not shut; a second phrase after a full second's rest starts from shut.
  const parts: Part[] = []
  for (let i = 0; i < 6; i++) parts.push({ t0: 1 + i * 0.4, t1: 1.2 + i * 0.4, vibrato: true })
  parts.push({ t0: 4.4, t1: 4.8, vibrato: true })
  const { tracks, frameCount } = lipSyncFromAudio(song(6, parts))
  const m = mouthOf(tracks, frameCount)
  const inside = m.slice(1.25 * FPS, 3.0 * FPS)
  check("inside a phrase the mouth stays open between syllables", inside.every((w) => w > 0.02), `lowest ${Math.min(...inside).toFixed(3)}`)
  check("between phrases it shuts", m.slice(3.6 * FPS, 4.2 * FPS).some((w) => w <= 0.02))
  check("syllables wear more than one vowel", tracks.size > 1, [...tracks.keys()].join(" "))
  const again = lipSyncFromAudio(song(6, parts)).tracks
  check("the same song gets the same mouth", JSON.stringify([...again]) === JSON.stringify([...tracks]))
}

// ── Lip sync from the lyrics and the music ──

{
  const lines: LyricLine[] = [{ start: 2, end: 3, text: "a" }]
  const { tracks, frameCount } = lipSyncFromLyricsAndAudio(lines, song(5, [{ t0: 2, t1: 3, vibrato: true }]))
  check("the lyric's vowel is the shape", tracks.has("あ") && !tracks.has("い"), [...tracks.keys()].join(", "))
  const span = openSpan(curve(tracks.get("あ"), frameCount))
  check("it opens on the voice", !!span && Math.abs(span[0] - 2 * FPS) <= 1, `frame ${span?.[0]}`)
}

{
  // The voice sings 1-4 s, the lyric line is one syllable at 2 s. The mouth may
  // open within 0.2 s of that syllable and is shut where the voice sings without one.
  const lines: LyricLine[] = [{ start: 2, end: 3, text: "i" }]
  const { tracks, frameCount } = lipSyncFromLyricsAndAudio(lines, song(6, [{ t0: 1, t1: 4, vibrato: true }]))
  const c = curve(tracks.get("い"), frameCount)
  const shut = (a: number, b: number) => c.slice(a * FPS, b * FPS).every((w) => w <= 0.02)
  check("the syllable opens the mouth", c.slice(2 * FPS, 2.3 * FPS).some((w) => w > 0.1))
  check("a voice before the lyrics keeps it shut", shut(1, 1.7), `open ${openSpan(c)?.join("-")}`)
  check("a voice after the syllable keeps it shut", shut(2.6, 4), `open ${openSpan(c)?.join("-")}`)
}

{
  const { tracks } = lipSyncFromLyricsAndAudio([], song(4, [{ t0: 1, t1: 2, vibrato: true }]))
  check("no lyric lines, no mouth", tracks.size === 0)
}

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nall passed")
