// Where the chrome was left standing — not what the scene IS.
//
// A separate store from the scene document on purpose: which panel is open and
// which tab is showing belong to this browser, not to the artwork. They must
// never travel with a published scene, and they must survive a scene swap.
//
// ONE key for both editors. The 0.4.0 chrome (app/lab) replaces the shipped one
// (app/page.tsx), and while both exist they share this blob — which is why
// saveUiState takes a PATCH and merges: each page writes only the fields it
// owns, and neither can wipe the other's.

const UI_KEY = "reze-design.ui"

export type UiState = {
  /** Shipped editor: are the two side docks open. */
  docks: boolean
  leftTab: string
  rightTab: string
  /** 0.4.0 chrome: which row is unfolded inside the stack. Whether the stack
   *  itself is expanded is NOT here on purpose — that is a viewing posture, and
   *  restoring it would greet a returning user with chrome that looks broken.
   *  The device rule (collapsed on a coarse pointer) lives at the call site. */
  openRow: string | null
  /** The selected pane of each tabbed row — a go-to lands on a pane, so which
   *  pane you were last in is part of where you left off. */
  stageTab: "stage" | "ground" | "background"
  lightTab: "world" | "sun"
  cameraTab: "lens" | "focus"
  postTab: "grade" | "bloom" | "outline"
}

function defaults(): UiState {
  // Mobile first-open: docks closed — two 300px docks bury a phone viewport
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
  return {
    docks: !coarse,
    leftTab: "materials",
    rightTab: "assets",
    openRow: null,
    stageTab: "ground",
    lightTab: "world",
    cameraTab: "lens",
    postTab: "grade",
  }
}

export function loadUiState(): UiState {
  const def = defaults()
  if (typeof window === "undefined") return def
  try {
    const raw = window.localStorage.getItem(UI_KEY)
    return { ...def, ...(raw ? (JSON.parse(raw) as Partial<UiState>) : {}) }
  } catch {
    return def
  }
}

export function saveUiState(patch: Partial<UiState>) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify({ ...loadUiState(), ...patch }))
  } catch {
    // non-fatal
  }
}
