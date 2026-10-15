import { storageKey } from "@/lib/storage"

// The chrome's palette: what colour the docks, panels and menus are, and what
// is printed on them. A preference of this browser, never scene state — a
// shared scene opens in the viewer's own palette, not its author's.
//
// The palettes themselves live in app/globals.css ("Chrome palettes"), as the
// same --chrome-* variables the default ground is made of, so nothing at a
// call site knows a palette exists. Here is only which one is on, and the
// picture someone chose to see through their docks.
//
// Both are written onto <html> (data-chrome, data-chrome-photo and the
// --chrome-photo variable) because popovers and dialogs portal to <body>: a
// palette set on the editor's root would stop at the first menu. The boot
// script (components/chrome-theme-script.tsx) does the same before the first
// paint, so a pink editor never flashes grey on load.

export const CHROME_THEMES = ["night", "strawberry", "sakura", "moon", "ramune", "matcha", "blood", "cyber"] as const
export type ChromeTheme = (typeof CHROME_THEMES)[number]
export const DEFAULT_CHROME: ChromeTheme = "night"

export const THEME_KEY = storageKey("chrome")
export const PHOTO_KEY = storageKey("chrome-photo")

type State = { theme: ChromeTheme; photo: string | null }

const SERVER: State = { theme: DEFAULT_CHROME, photo: null }
let state: State | null = null
const listeners = new Set<() => void>()

function read(): State {
  try {
    const raw = window.localStorage.getItem(THEME_KEY)
    return {
      theme: CHROME_THEMES.includes(raw as ChromeTheme) ? (raw as ChromeTheme) : DEFAULT_CHROME,
      photo: window.localStorage.getItem(PHOTO_KEY),
    }
  } catch {
    return SERVER
  }
}

/** Puts the palette on <html>, where every surface — portalled ones too — can see it. */
function apply({ theme, photo }: State) {
  const root = document.documentElement
  if (theme === DEFAULT_CHROME) root.removeAttribute("data-chrome")
  else root.setAttribute("data-chrome", theme)
  if (photo) {
    root.setAttribute("data-chrome-photo", "")
    root.style.setProperty("--chrome-photo", `url("${photo}")`)
  } else {
    root.removeAttribute("data-chrome-photo")
    root.style.removeProperty("--chrome-photo")
  }
}

function set(next: State) {
  state = next
  apply(next)
  for (const l of listeners) l()
}

export function getChrome(): State {
  if (typeof window === "undefined") return SERVER
  return (state ??= read())
}
export const getServerChrome = (): State => SERVER

export function subscribeChrome(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function setChromeTheme(theme: ChromeTheme): void {
  set({ ...getChrome(), theme })
  try {
    window.localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Non-fatal: the palette still applies to this session.
  }
}

/**
 * Sets (or with null, clears) the picture behind the docks. Returns false when
 * the browser would not keep it — it still shows for this session.
 */
export function setChromePhoto(photo: string | null): boolean {
  set({ ...getChrome(), photo })
  try {
    if (photo) window.localStorage.setItem(PHOTO_KEY, photo)
    else window.localStorage.removeItem(PHOTO_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * A picked image, made small enough to keep: the longest side at most 1600px,
 * as a JPEG. It is seen through a tinted, blurred dock, never at full size, so
 * this costs nothing visible and keeps it well inside localStorage's quota.
 */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/jpeg", 0.82)
}
