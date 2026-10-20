// Which side of PAPER (app/globals.css) an overlay opened from the cover takes:
// the sheet is the colour opposite the type it was opened from — read off the
// ink zone of its opener. The opener is the focused element, or, after a mouse
// click (Button drops focus), the last element pressed.

let lastPress: Element | null = null
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => (lastPress = e.target as Element), true)
}

/** The element the user last opened something from. */
export function opener(): Element | null {
  const focused = document.activeElement
  return focused && focused !== document.body ? focused : lastPress
}

/** The paper side under the type at `from`, or null off the cover. */
export function paperSide(from: Element | null): "light" | "dark" | null {
  const zone = from?.closest<HTMLElement>("[data-ink]")
  if (!zone) return null
  return zone.dataset.ink === "light" ? "dark" : "light"
}

/** Lays a small overlay opened from the cover (a menu, a popover, a list) as
 *  paper in its opener's ink. */
export function layPop(el: HTMLElement) {
  const side = paperSide(opener())
  if (!side) return
  el.dataset.paper = side
  el.dataset.paperAt = "pop"
}
