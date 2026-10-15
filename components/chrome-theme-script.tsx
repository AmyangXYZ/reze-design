"use client"

// Puts the chosen chrome palette on <html> before the first paint, so a pink
// editor never flashes grey while the app's code loads. lib/chrome-theme.ts
// takes over once it runs; this is the same few lines, needing nothing else.
//
// Server-rendered only, for the reason BootGuardScript gives: a <script> React
// creates on the client never runs.

import { useSyncExternalStore } from "react"
import { CHROME_THEMES, DEFAULT_CHROME, PHOTO_KEY, THEME_KEY } from "@/lib/chrome-theme"

const SCRIPT = `(function () {
  try {
    var d = document.documentElement;
    var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (${JSON.stringify(CHROME_THEMES)}.indexOf(t) >= 0 && t !== ${JSON.stringify(DEFAULT_CHROME)}) d.setAttribute("data-chrome", t);
    var p = localStorage.getItem(${JSON.stringify(PHOTO_KEY)});
    if (p) { d.setAttribute("data-chrome-photo", ""); d.style.setProperty("--chrome-photo", 'url("' + p + '")'); }
  } catch (e) {}
})();`

export function ChromeThemeScript() {
  const fromServer = useSyncExternalStore(noSubscribe, () => false, () => true)
  return fromServer ? <script id="chrome-theme" dangerouslySetInnerHTML={{ __html: SCRIPT }} /> : null
}

const noSubscribe = () => () => {}
