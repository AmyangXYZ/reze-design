// Matching for the command palette.
//
// The rule the whole thing rests on: NEVER search the string you display, never
// display the string you search. A command shows its label in the active locale
// and matches against ALL of them plus hand-written keywords — because a Chinese
// UI user who knows the feature as "shader graph" should still find it, and for
// an MMD audience reading Japanese model names, English menus and Chinese
// tutorials in one sitting that is the common case, not the edge.

import type { ComponentType } from "react"

export type CommandSection = "command" | "goto" | "setting"

const SUGGESTION_COUNT = 4

export type PaletteItem = {
  id: string
  /** Says what KIND of thing this is at a glance. Per-item, never a uniform
   *  glyph: one repeated icon down the left is decoration, and a chevron in
   *  particular reads as "expand into" rather than "run". */
  icon: ComponentType<{ className?: string }>
  /** Shown to the user — active locale only. */
  label: string
  /** Every other locale's label. Matched, never shown. */
  altLabels?: string[]
  /** Synonyms and jargon translation cannot give: mp4, bgm, 4k, vmd, romaji. */
  keywords?: string[]
  section: CommandSection
  /**
   * What this row acts on, shown right-aligned and muted: the selected group for
   * "Edit shader graph", the author for a library item, the filename for an
   * asset. Omitted when there is nothing true to say — a navigation row needs no
   * annotation, and filling the column with filler is worse than leaving it
   * empty. Matched as well as shown, so "by amyang" finds their grades.
   */
  hint?: string
  /** Opens a deep surface (shader graph, WGSL, studio) — tinted in the list. */
  deep?: boolean
  /**
   * Offered under Suggestions before this user has a history of their own.
   * `"key"` is the stronger tier: a headline feature with no other door in the
   * chrome, which must stay one keystroke away even once history fills the
   * list. Use it sparingly — everything cannot be the exception.
   */
  suggested?: boolean | "key"
  /**
   * Worth doing again soon. Tweaking a graph or a setting is; exporting the
   * video you just exported is not — the default is false, so a command drops
   * out of Suggestions right after you run it instead of sitting at the top
   * offering to repeat itself.
   */
  repeatable?: boolean
  /**
   * What tends to come NEXT after this one. Hand-authored, because the sequences
   * are short, well known and few — you finish a look and publish it, you load a
   * model and give it a motion. A learned model would need traffic we do not
   * have to rediscover what we already know.
   */
  nextLikely?: string[]
  run?: () => void
}

/** Weights. Recency dominates, as it should — what you did last is the best
 *  single predictor — but it cannot be the only signal, or the list just replays
 *  your history back at you including the parts you have finished with. */
const W = {
  /** Per step down the history, most recent first. */
  recencyTop: 6,
  recencyDecay: 1.5,
  /** The previous command names this one as a likely follow-up. */
  successor: 5,
  /** Hand-picked as a good first thing to see. */
  curated: 2,
  /** A headline feature the palette is the ONLY door to (materials). Sits above
   *  every recency step but the freshest, so it stays in the list for good
   *  rather than aging out behind whatever you happen to have run lately. */
  keyFeature: 5,
} as const

/**
 * What to offer when the query is empty.
 *
 * Recency carries the most weight — what you did last is the best single
 * predictor — but on its own it just replays your history, including the parts
 * you have finished with. Two corrections:
 *
 *   - a non-repeatable command you JUST ran is dropped outright. Having exported
 *     is the strongest possible evidence you are not about to export again.
 *   - whatever the last command says usually follows it gets a large bump, so
 *     the palette leads you forward through a sequence instead of backward
 *     through a log.
 *
 * Deterministic and inspectable: no model, no training, and you can read why any
 * row is where it is.
 */
export function suggestionsFor(items: PaletteItem[], history: string[]): PaletteItem[] {
  const last = history[0] ? items.find((i) => i.id === history[0]) : undefined
  const scored = items
    .map((item) => {
      const i = history.indexOf(item.id)
      let score = 0
      if (i >= 0) score += Math.max(0, W.recencyTop - i * W.recencyDecay)
      if (last?.nextLikely?.includes(item.id)) score += W.successor
      if (item.suggested) score += item.suggested === "key" ? W.keyFeature : W.curated
      // The one you just ran, and it is not the repeating kind.
      if (item.id === last?.id && !item.repeatable) score = -1
      return { item, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, SUGGESTION_COUNT).map((s) => s.item)
}

/**
 * Fold both sides of a comparison into one comparable form.
 *
 * NFKC collapses full-width to half (ＡＢＣ → ABC, ｶﾀｶﾅ → カタカナ), and the
 * range shift maps hiragana onto katakana. Without the latter, typing しぇーだー
 * misses シェーダー and half-width katakana from an IME misses everything — which
 * is the difference between Japanese search working and looking broken.
 */
export function fold(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

/** Precomputed once per item — the bag never changes, not even on a locale switch,
 *  because it already contains every locale. */
export function searchKey(item: PaletteItem): string {
  return fold([item.label, item.hint ?? "", ...(item.altLabels ?? []), ...(item.keywords ?? [])].join(" "))
}

/** Where the hit landed, best first. A prefix match on the DISPLAYED label has to
 *  outrank a hit buried in the keyword bag, or typing "ex" surfaces whatever
 *  happens to list "ex" as a synonym above Export video. */
const enum Rank {
  LabelPrefix = 0,
  LabelSubstring = 1,
  Elsewhere = 2,
  Miss = 3,
}

function rank(item: PaletteItem, needle: string): Rank {
  const label = fold(item.label)
  if (label.startsWith(needle)) return Rank.LabelPrefix
  if (label.includes(needle)) return Rank.LabelSubstring
  return searchKey(item).includes(needle) ? Rank.Elsewhere : Rank.Miss
}

/**
 * Filter and order. One list, no modes — VS Code's ">" prefix is muscle memory
 * this audience does not have, and a hidden mode you must know about is worse
 * than no mode at all. Sections do the grouping instead, visibly.
 *
 * With no query the palette shows recents first, then everything — recency
 * breaks ties but never beats a better text match, or the list starts arguing
 * with what you typed.
 */
export function searchPalette(items: PaletteItem[], raw: string, recentIds: string[] = []) {
  const needle = fold(raw.trim())

  if (!needle) {
    // "Suggestions", not "Recent" — the slot is a ranking, not a log. See
    // suggestionsFor: recency dominates, but a command you just finished with
    // drops out and whatever usually follows it moves up.
    const suggested = suggestionsFor(items, recentIds)
    const shownIds = new Set(suggested.map((i) => i.id))
    return { suggested, results: items.filter((i) => !shownIds.has(i.id)) }
  }

  const scored = items
    .map((item) => ({ item, r: rank(item, needle) }))
    .filter(({ r }) => r !== Rank.Miss)
    .sort((a, b) => a.r - b.r || recentBias(a.item, b.item, recentIds))
  return { suggested: [], results: scored.map((s) => s.item) }
}

/** Only consulted when two items rank identically. */
function recentBias(a: PaletteItem, b: PaletteItem, recentIds: string[]): number {
  const ia = recentIds.indexOf(a.id)
  const ib = recentIds.indexOf(b.id)
  if (ia === ib) return 0
  if (ia === -1) return 1
  if (ib === -1) return -1
  return ia - ib
}
