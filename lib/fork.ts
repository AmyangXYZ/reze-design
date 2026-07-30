// Handing a scene from the viewer to the editor.
//
// sessionStorage rather than a query string: `/?from=5VvAQA6d` is noise in the
// address bar of a tool people keep open all day. Tab-scoped is also the right
// lifetime — refreshing keeps what you were editing, a new tab opens your own
// work, and nothing leaks between the two.

const KEY = "reze-design.fork"

export function setForkTarget(sceneId: string): void {
  try {
    window.sessionStorage.setItem(KEY, sceneId)
  } catch {
    // Storage blocked: the fork simply doesn't carry, and the editor opens normally.
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

export function clearForkTarget(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Non-fatal.
  }
}
