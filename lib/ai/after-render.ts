// Wait for the editor to catch up with a change — in a tab that is showing, or
// one that is not.
//
// A tool's change reaches the next tool only after React renders and the
// handles are refreshed (hooks/use-scene-tools), and a seek lands only after a
// frame has posed the cast. Two animation frames cover both while the tab is
// showing. A HIDDEN tab — switched away from, minimised — gets no animation
// frames at all, so a run waiting on one would sit there until the person came
// back. React still renders in a hidden tab (its scheduler is not
// frame-driven), so there a short timer stands in. The browser slows timers
// in the background to about once a second, which costs a run that much per
// step and keeps it going.

export function afterRender(): Promise<void> {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return new Promise((r) => setTimeout(() => setTimeout(r, 16), 16))
  }
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}
