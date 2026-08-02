// Handing a scene from the viewer to the editor.
//
// sessionStorage rather than a query string: `/?from=5VvAQA6d` is noise in the
// address bar of a tool people keep open all day, and tab-scoped keeps a fork from
// leaking into another tab's work.
//
// Consumed ONCE, the moment the editor route resolves the fork. From then on the
// forked scene is the working scene and persistence owns it — left in place, the
// target re-forked on every refresh, overwriting whatever had been done since:
// uploads vanished, a reset sprang back to the fork, and the scene loaded twice.

const KEY = "reze-design.fork"

export function setForkTarget(sceneId: string): void {
  try {
    window.sessionStorage.setItem(KEY, sceneId)
  } catch {
    // Storage blocked: the fork simply doesn't carry, and the editor opens normally.
  }
}

/** Spend the target. On failure it is left alone so a refresh can retry the fork. */
export function clearForkTarget(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // a blocked store never carried the fork in the first place
  }
}

export function forkTarget(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}
