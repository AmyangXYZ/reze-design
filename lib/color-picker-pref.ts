import { storageKey } from "@/lib/storage"

// Which tab the colour picker opens on, per browser.
//
// A habit, not a setting: someone who mixes colours by hand reaches for the
// sliders every time, and making them click past the palette on each of the
// app's dozen colour fields is the friction this removes. The palette by
// default, because it is the app's own set and the one most picks come from.
export type ColorPickerTab = "palette" | "picker"

const KEY = storageKey("color-picker-tab")

export function loadColorPickerTab(): ColorPickerTab {
  if (typeof window === "undefined") return "palette"
  try {
    return window.localStorage.getItem(KEY) === "picker" ? "picker" : "palette"
  } catch {
    return "palette"
  }
}

export function saveColorPickerTab(tab: ColorPickerTab): void {
  try {
    window.localStorage.setItem(KEY, tab)
  } catch {
    // Non-fatal: the choice still holds until the page reloads.
  }
}

// The colours this browser last settled on, newest first — one shared list
// across every colour field, because a colour used on the bloom is often the
// one wanted on the outline next.
const RECENT_KEY = storageKey("color-recent")
export const RECENT_COLORS = 12

export function loadRecentColors(): string[] {
  if (typeof window === "undefined") return []
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(list)
      ? list.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c)).slice(0, RECENT_COLORS)
      : []
  } catch {
    return []
  }
}

export function pushRecentColor(hex: string): void {
  const c = hex.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(c)) return
  try {
    const next = [c, ...loadRecentColors().filter((x) => x !== c)].slice(0, RECENT_COLORS)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal: the colour still applied.
  }
}
