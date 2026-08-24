// What sits behind the cast — shared by the exporter, the render panel and the
// LIVE scene sync.
//
// Its own module, and it has to stay that way: the scene sync needs the type
// and the predicate, and taking them from lib/video-export pulled mediabunny
// into every module graph that syncs a scene. The viewer page syncs scenes and
// never exports one, so a shared link was downloading a muxer to play a dance.
// Nothing here may import anything heavier than itself.

/**
 * `green` and `alpha` are both handoffs to a compositor, and the scene is torn
 * down the same way for both (no skybox, ground surface off) — they differ in
 * what fills the hole. `alpha` fills it with nothing, which is strictly more
 * information: a key has to be pulled from green, and it cannot recover the
 * soft edge of hair that the alpha channel already carries exactly.
 */
export type ExportBackground = "scene" | "green" | "alpha"

/** The chroma key, in one place rather than three. */
export const GREEN = "#00ff00"

/** Compositing handoffs tear the scene down the same way; only the fill differs. */
export const isCompositingBackground = (b: ExportBackground) => b !== "scene"
