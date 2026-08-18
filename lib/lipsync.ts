// Lip sync from lyrics — a rule table, not a model.
//
// A scene that carries an .lrc already knows what an audio-analysis pipeline
// would spend a 50MB speech model trying to recover: which syllables are sung,
// and when. Speech recognition is also at its worst on exactly our content —
// sung vocals over music — so the ground truth beats the reconstruction twice.
// This module walks the lyric text instead: script-classified per CHARACTER
// (mixed lines are normal — kana verses, a romaji chorus, a loanword), each
// script reduced to a mora stream by its own rules, and the stream laid onto
// the line's timing as keyframes for the five MMD mouth morphs あ/い/う/え/お.
//
// Where each script's rules stand:
//   kana      exact — a syllabary is already the answer
//   hangul    exact — a syllable block decomposes by ARITHMETIC (that is the
//             script's design), vowel jamo → nearest of the five
//   latin     exact for romaji and pinyin, where vowel letters ARE the visemes;
//             fair for English, whose spelling lies — a plausible wrong vowel
//             still beats a closed mouth
//   kanji     the honest gap: readings are not recoverable by rule. A soft
//             generic vowel at reduced weight, so the mouth moves rather than
//             freezes. MIDI lyric events or a furigana .lrc are the real fix.
//
// The output is an ordinary morph VMD written with the engine's VMDWriter —
// a real, standard file. It attaches through the same door as an uploaded one
// and persists as a plain scene asset: a published scene never knows its lips
// came from lyrics.

import { FPS, VMDWriter, type AnimationClip, type LyricLine, type MorphKeyframe } from "reze-engine"
import { hanziViseme } from "./hanzi-visemes"

/** One mouth event: a vowel to show, or a closure (bilabial / ん / coda-m). */
type Mora = {
  viseme: "a" | "i" | "u" | "e" | "o" | null // null = mouth closed
  /** Peak morph weight, per vowel (see VOWEL_WEIGHT); kanji less. */
  weight: number
  /** A bilabial onset (m/b/p, ま-row…) closes the lips BEFORE the vowel. */
  bilabial: boolean
  /** ー: lengthen the previous vowel's pulse instead of striking a new one. */
  extend?: boolean
}

/**
 * Peak weight PER VOWEL, read off a hand-made reference lipsync rather than
 * chosen: あ half-strength, the rest near full. The wide-open shape at 0.8
 * gaped; the naturally small shapes (い is a slit, う a pucker) need full
 * weight to read at all. One global constant was wrong in both directions.
 */
const VOWEL_WEIGHT: Record<NonNullable<Mora["viseme"]>, number> = {
  a: 0.45,
  i: 0.8,
  u: 0.65,
  e: 0.7,
  o: 0.55,
}
/** Kanji fallback: the mouth moves, but does not overclaim a reading. */
const KANJI_WEIGHT = 0.3
/** Seconds of anticipation before a mora's nominal start — a mouth that opens
 *  exactly on the beat reads late, like bad dubbing. */
const ATTACK = 0.07
/** Seconds to fall closed after a vowel ends unfollowed. */
const RELEASE = 0.09
/** Floor on mora length — a dense rap line squeezes, never inverts. */
const MIN_MORA = 0.04
/**
 * Ceiling on mora length, because a line's window is not its singing. parseLRC
 * ends a line at the NEXT line's start when the file says no better, so the
 * last phrase before an instrumental break owns the whole gap — and dividing
 * morae across it held the final vowel open through the interlude. Sung morae
 * rarely average past ~0.45s; apparent steps of seconds are silence, not song.
 * The mouth closes when the capped content ends. A held note is still an
 * author's call: ー mints a mora per beat held, which is the .lrc way to say so.
 */
const MAX_MORA = 0.45
/**
 * How long a syllable's mouth stays OPEN, as a fraction of its slot, capped.
 * The reference articulates: each syllable is a pulse — up in two frames, back
 * near closed before the next — even for ああ. A mouth held flat across a mora
 * is the frozen look; a held NOTE is different, and ー expresses it by
 * EXTENDING the previous pulse rather than re-striking it.
 */
const PULSE_FRACTION = 0.45
const PULSE_MAX = 0.18

const MORPH_NAME: Record<NonNullable<Mora["viseme"]>, string> = {
  a: "あ",
  i: "い",
  u: "う",
  e: "え",
  o: "お",
}

// ─── Kana ───────────────────────────────────────────────────────────
// The vowel of every lead kana. Digraphs (きゃ…) resolve to the SMALL kana's
// vowel; ー repeats the previous vowel; っ is a beat of silence; ん closes.

const KANA_VOWEL: Record<string, Mora["viseme"]> = {}
const KANA_BILABIAL = new Set<string>()
{
  const rows: [string, Mora["viseme"][]][] = [
    ["あいうえお", ["a", "i", "u", "e", "o"]],
    ["かきくけこ", ["a", "i", "u", "e", "o"]],
    ["がぎぐげご", ["a", "i", "u", "e", "o"]],
    ["さしすせそ", ["a", "i", "u", "e", "o"]],
    ["ざじずぜぞ", ["a", "i", "u", "e", "o"]],
    ["たちつてと", ["a", "i", "u", "e", "o"]],
    ["だぢづでど", ["a", "i", "u", "e", "o"]],
    ["なにぬねの", ["a", "i", "u", "e", "o"]],
    ["はひふへほ", ["a", "i", "u", "e", "o"]],
    ["ばびぶべぼ", ["a", "i", "u", "e", "o"]],
    ["ぱぴぷぺぽ", ["a", "i", "u", "e", "o"]],
    ["まみむめも", ["a", "i", "u", "e", "o"]],
    ["らりるれろ", ["a", "i", "u", "e", "o"]],
    ["やゆよ", ["a", "u", "o"]],
    ["わを", ["a", "o"]],
    // Small vowels stand alone after a vowel (ふぁ…) — same five shapes.
    ["ぁぃぅぇぉ", ["a", "i", "u", "e", "o"]],
    ["ゃゅょ", ["a", "u", "o"]],
  ]
  for (const [kana, vowels] of rows) {
    ;[...kana].forEach((ch, i) => {
      KANA_VOWEL[ch] = vowels[i]
      // Katakana is hiragana + 0x60, contiguous across the whole syllabary.
      KANA_VOWEL[String.fromCharCode(ch.charCodeAt(0) + 0x60)] = vowels[i]
    })
  }
  for (const ch of "まみむめもばびぶべぼぱぴぷぺぽ") {
    KANA_BILABIAL.add(ch)
    KANA_BILABIAL.add(String.fromCharCode(ch.charCodeAt(0) + 0x60))
  }
}

const SMALL_YAYUYO = new Set([..."ゃゅょャュョ"])

// ─── Hangul ─────────────────────────────────────────────────────────
// (code − 0xAC00) = onset·21·28 + vowel·28 + coda. The 21 vowel jamo in their
// canonical order, each to the nearest of the five shapes; onset ㅁㅂㅃㅍ close
// the lips first, coda ㅁㅂㅍ close them after.

const HANGUL_VOWEL: Mora["viseme"][] = [
  "a", // ㅏ
  "e", // ㅐ
  "a", // ㅑ
  "e", // ㅒ
  "a", // ㅓ
  "e", // ㅔ
  "a", // ㅕ
  "e", // ㅖ
  "o", // ㅗ
  "a", // ㅘ
  "e", // ㅙ
  "e", // ㅚ
  "o", // ㅛ
  "u", // ㅜ
  "a", // ㅝ
  "e", // ㅞ
  "i", // ㅟ
  "u", // ㅠ
  "u", // ㅡ
  "i", // ㅢ
  "i", // ㅣ
]
const HANGUL_BILABIAL_ONSET = new Set([6, 7, 8, 17]) // ㅁ ㅂ ㅃ ㅍ
const HANGUL_BILABIAL_CODA = new Set([16, 17, 26]) // ㅁ ㅂ ㅍ

// ─── Latin ──────────────────────────────────────────────────────────
// Vowel letters are the visemes — exact for romaji and pinyin, where the
// orthography is phonemic. Macrons fold to doubled vowels (ō → oo: two morae,
// which is what a long vowel is). English rides the same scan with one
// concession to its spelling: a silent final e.

const LATIN_FOLD: Record<string, string> = { ā: "aa", ī: "ii", ū: "uu", ē: "ee", ō: "oo" }
const LATIN_VOWEL: Record<string, Mora["viseme"]> = { a: "a", i: "i", u: "u", e: "e", o: "o", y: "i" }

// ─── The walk ───────────────────────────────────────────────────────

function morasOfLine(text: string): Mora[] {
  const out: Mora[] = []
  const push = (viseme: Mora["viseme"], bilabial = false, weight?: number) =>
    out.push({ viseme, weight: weight ?? (viseme ? VOWEL_WEIGHT[viseme] : 0), bilabial })

  // Normalise once: lowercase latin, macrons unfolded, so the scan below never
  // branches on case or diacritics.
  let s = text.toLowerCase()
  for (const [m, r] of Object.entries(LATIN_FOLD)) s = s.split(m).join(r)

  const chars = [...s]
  // Kana anywhere makes the LINE Japanese: its kanji are 漢字 with Japanese
  // readings, which the Mandarin table would get wrong more often than right.
  // A line with none is Chinese, where the table is the truth.
  const lineIsJapanese = /[\u3041-\u30ff]/.test(s)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const code = ch.charCodeAt(0)

    // Kana — digraphs consume their small partner.
    if (KANA_VOWEL[ch] !== undefined) {
      const next = chars[i + 1]
      if (next && SMALL_YAYUYO.has(next)) {
        push(KANA_VOWEL[next], KANA_BILABIAL.has(ch))
        i++
      } else {
        push(KANA_VOWEL[ch], KANA_BILABIAL.has(ch))
      }
      continue
    }
    if (ch === "ん" || ch === "ン") {
      push(null)
      continue
    }
    if (ch === "っ" || ch === "ッ") {
      push(null)
      continue
    }
    if (ch === "ー") {
      const prev = out.filter((m) => m.viseme).at(-1)
      if (prev) out.push({ viseme: prev.viseme, weight: prev.weight, bilabial: false, extend: true })
      continue
    }

    // Hangul — pure arithmetic.
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = code - 0xac00
      const onset = Math.floor(idx / (21 * 28))
      const vowel = Math.floor(idx / 28) % 21
      const coda = idx % 28
      push(HANGUL_VOWEL[vowel], HANGUL_BILABIAL_ONSET.has(onset))
      if (HANGUL_BILABIAL_CODA.has(coda)) push(null)
      continue
    }

    // Latin — one mora per vowel letter; y only where it works as a vowel.
    if (LATIN_VOWEL[ch] !== undefined) {
      if (ch === "y") {
        const prev = chars[i - 1] ?? " "
        const next = chars[i + 1] ?? " "
        // A vowel only between consonants ("rhythm", "try") — never beside a
        // real vowel ("you", "day"), where it is a glide.
        if (LATIN_VOWEL[prev] !== undefined || LATIN_VOWEL[next] !== undefined) continue
      }
      // Silent final e: "time", "love" — consonant + e at a word's end, with a
      // vowel earlier in the word to carry it.
      if (ch === "e") {
        const prev = chars[i - 1] ?? " "
        const next = chars[i + 1] ?? " "
        const prevIsConsonant = /[a-z]/.test(prev) && LATIN_VOWEL[prev] === undefined
        const wordEnds = !/[a-zāīūēō]/.test(next)
        if (prevIsConsonant && wordEnds) {
          let hasEarlier = false
          for (let j = i - 1; j >= 0 && /[a-z]/.test(chars[j]); j--) {
            if (LATIN_VOWEL[chars[j]] !== undefined) hasEarlier = true
          }
          if (hasEarlier) continue
        }
      }
      const prev = chars[i - 1] ?? ""
      push(LATIN_VOWEL[ch], prev === "m" || prev === "b" || prev === "p")
      continue
    }

    // Han characters. In a Chinese line the Unihan table answers exactly; in
    // a Japanese line the reading is not recoverable by rule, so the mouth
    // moves without overclaiming which way.
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      const v = lineIsJapanese ? null : hanziViseme(ch)
      if (v) push(v)
      else push("a", false, KANJI_WEIGHT)
      continue
    }

    // Everything else — punctuation, spaces, digits — separates; it does not sing.
  }
  return out
}

// ─── Keyframes ──────────────────────────────────────────────────────

/** A span of one morph held at one weight, in seconds. */
type Span = {
  viseme: NonNullable<Mora["viseme"]>
  t0: number
  t1: number
  weight: number
  /** When this span's fall reaches zero — the next strike's apex when one
   *  follows closely (a crossfade), a plain release into silence otherwise. */
  relEnd?: number
}

/**
 * Lyric lines → the five mouth-morph tracks.
 *
 * Each line's morae divide its own [start, end] evenly — an .lrc has no
 * per-syllable timing, and even division at singing pace lands within a beat of
 * true, which is what a mouth needs. Long notes fall out naturally: fewer morae
 * over more seconds is a held vowel. Closures (ん, bilabial codas) and the gaps
 * between lines are simply spans nothing claims, where every track sits at 0.
 */
export function lipSyncMorphTracks(lines: LyricLine[]): {
  tracks: Map<string, MorphKeyframe[]>
  frameCount: number
} {
  // The title card is not sung. A karaoke .lrc conventionally opens with a
  // credits line at [00:00.xx], and syncing it mouths the song title through
  // the silent intro. parseLRC ends every line at the NEXT line's start, so
  // the tell is not a gap between lines — it is a first line whose WINDOW
  // vastly outlives its content: after its morae are sung at the slowest
  // plausible pace, seconds of window remain before the lyrics begin.
  const sung = lines.filter((line, i) => {
    if (i !== 0 || line.start >= 2) return true
    const content = morasOfLine(line.text).length * MAX_MORA
    return line.end - line.start - content < 3
  })

  const spans: Span[] = []
  for (const line of sung) {
    const moras = morasOfLine(line.text)
    if (moras.length === 0) continue
    const dur = Math.max(line.end - line.start, MIN_MORA * moras.length)
    const step = Math.min(dur / moras.length, MAX_MORA)
    // Articulation follows time-to-articulate. Morph weights are continuous,
    // and a mouth given 100ms genuinely does not reach the aperture it
    // reaches given 300 — so quick syllables in a run under-articulate toward
    // 60% and anything at singing pace opens fully. This is what breaks the
    // metronomic sameness of every strike peaking at exactly its vowel's
    // weight: fast passages ripple, held notes bloom, and none of it needs
    // the audio — the .lrc's own timing carries the dynamics.
    const artic = Math.min(Math.max(step / 0.3, 0.6), 1)
    for (let i = 0; i < moras.length; i++) {
      const m = moras[i]
      if (!m.viseme || m.weight === 0) continue
      // ー lengthens the previous pulse to the end of its own slot — a held
      // NOTE holds the mouth. A repeated vowel (ああ) does NOT: it re-pulses,
      // which is what the reference does and what articulation looks like.
      if (m.extend) {
        const prev = spans.at(-1)
        if (prev && prev.viseme === m.viseme) {
          prev.t1 = line.start + (i + 1) * step
          continue
        }
      }
      let t0 = line.start + i * step
      // A PULSE, not a hold: open for part of the slot, back toward closed
      // before the next syllable strikes. The slot's remainder is the
      // articulation gap the reference showed on every syllable.
      const t1 = Math.min(line.start + (i + 1) * step, t0 + Math.max(Math.min(step * PULSE_FRACTION, PULSE_MAX), MIN_MORA))
      // The lips must close BEFORE a bilabial vowel opens — steal the front of
      // the slot for the closure by delaying the vowel's onset.
      if (m.bilabial) t0 = Math.min(t0 + Math.max(step * 0.3, 0.03), t1 - MIN_MORA * 0.5)
      spans.push({ viseme: m.viseme, t0, t1, weight: m.weight * artic })
    }
  }

  spans.sort((x, y) => x.t0 - y.t0)

  // Subtle co-articulation. A syllable followed closely by another — ANY
  // vowel, its own track or a different one — releases INTO the successor's
  // apex instead of slamming shut first: the outgoing shape falls exactly
  // while the incoming rises, linear against linear, so the blend sums to
  // about one shape and the mouth flows between shapes instead of chattering
  // through closed. This is the bounded crossfade — only the short ramp
  // window overlaps, never the sustains, which is the difference between
  // this and the continuously-open mistake this module has already retired.
  // A syllable followed by silence keeps its plain release and closes.
  for (let i = 0; i < spans.length; i++) {
    const next = spans[i + 1]
    const sp = spans[i]
    sp.relEnd =
      next && next.t0 - sp.t1 <= 0.25
        ? Math.max(next.t0 + Math.min(ATTACK, Math.max(next.t1 - next.t0, MIN_MORA)), sp.t1 + MIN_MORA)
        : sp.t1 + RELEASE
  }

  const tracks = new Map<string, MorphKeyframe[]>()
  let frameCount = 0
  for (const v of ["a", "i", "u", "e", "o"] as const) {
    const name = MORPH_NAME[v]
    const mine = spans.filter((sp) => sp.viseme === v)
    if (mine.length === 0) continue
    // Overlaps only — pulses that genuinely collide (rounding, bilabial
    // shifts) fuse; everything else stays its own strike. The old gap-merge
    // welded consecutive same-vowel syllables into one long hold, which is
    // exactly the frozen mouth the reference never shows.
    const merged: Span[] = []
    for (const sp of mine) {
      const last = merged.at(-1)
      if (last && sp.t0 <= last.t1 && sp.weight === last.weight) last.t1 = Math.max(last.t1, sp.t1)
      else merged.push({ ...sp })
    }
    const keys: MorphKeyframe[] = []
    const frame = (t: number) => Math.max(0, Math.round(t * FPS))
    for (const sp of merged) {
      // STRIKE-ON-BEAT: the zero anchor sits ON the timestamp and the apex
      // lands a ramp later. Two reasons, both learned the hard way. A karaoke
      // .lrc already leads the vocal, so anticipating on top of it ran the
      // lips ahead of the audio. And with anticipation, a vowel boundary put
      // the outgoing apex and the incoming apex on the SAME instant — morphs
      // are additive, the sum crested past the sculpted range, and the lower
      // lip folded out over the gums. Rising while the neighbour falls keeps
      // the sum near one shape.
      const open = frame(sp.t0)
      const prev = keys.at(-1)
      // Anchor at zero on the strike — unless the previous release IS that
      // anchor, or overlaps it (fast lines), in which case ride through.
      if (!prev || prev.frame < open) keys.push({ morphName: name, frame: open, weight: 0 })
      const apex = Math.min(sp.t0 + ATTACK, sp.t1)
      keys.push({ morphName: name, frame: frame(apex), weight: sp.weight })
      if (sp.t1 > apex) keys.push({ morphName: name, frame: frame(sp.t1), weight: sp.weight })
      keys.push({ morphName: name, frame: frame(sp.relEnd ?? sp.t1 + RELEASE), weight: 0 })
    }
    // Strictly increasing frames — collapse any rounding ties, last value wins.
    const clean: MorphKeyframe[] = []
    for (const k of keys) {
      const last = clean.at(-1)
      if (last && k.frame <= last.frame) {
        last.weight = k.weight
        continue
      }
      clean.push(k)
    }
    tracks.set(name, clean)
    frameCount = Math.max(frameCount, clean.at(-1)?.frame ?? 0)
  }
  return { tracks, frameCount }
}

/** The tracks as a real .vmd, named after the lyrics that produced it. */
export function lipSyncVmdFile(lines: LyricLine[], lyricsName: string): File | null {
  const { tracks, frameCount } = lipSyncMorphTracks(lines)
  if (tracks.size === 0) return null
  const clip: AnimationClip = { boneTracks: new Map(), morphTracks: tracks, frameCount }
  const bytes = new VMDWriter().write(clip)
  // The VMD model-name field: 20 bytes of Shift-JIS at offset 30, and where a
  // file says who made it — MMD shows it when the motion is loaded. ASCII is
  // single-byte Shift-JIS, so the stamp needs no encoder.
  const stamped = new Uint8Array(bytes)
  const brand = "reze-design"
  for (let i = 0; i < 20; i++) stamped[30 + i] = i < brand.length ? brand.charCodeAt(i) : 0
  const base = lyricsName.replace(/\.lrc$/i, "")
  return new File([stamped], `${base}.reze-design-lipsync.vmd`)
}
