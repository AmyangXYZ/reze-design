"use client"

// What a visitor sees when the app's own JavaScript does not arrive.
//
// The editor needs its JS chunks (over a megabyte compressed) before anything
// runs, and the first thing on screen, "Starting the engine…", is in the
// server's HTML. On a lossy route into Cloudflare (lib/net) a chunk can stall
// or fail, and a page whose code never arrives can do nothing about it: the
// pill just stays. Visitors in mainland China reported exactly that, often
// right after a deploy, when a page loaded moments earlier asks for chunk
// names the new build no longer has.
//
// So this runs BEFORE the app's code, as plain HTML and a few lines of inline
// script that need nothing else to have loaded:
// - a chunk that fails to load reloads the page once — which also fetches the
//   new HTML after a deploy — guarded so it cannot loop;
// - if the app still has not started after 15 seconds, one quiet line says the
//   connection is slow, with a Reload button.
// The app marks itself started (components/boot-note), which ends both.

import { useSyncExternalStore } from "react"


const SLOW_MS = 15_000

// Kept in step with lib/storage (storageKey("locale")) by hand: this runs
// before any module does.
const LOCALE_KEY = "reze-design.locale.0.5.0"

const GUARD = `(function () {
  var d = document, w = window;
  var RELOADED = "reze-design.boot-reload";
  function booted() { return d.documentElement.hasAttribute("data-booted"); }
  function lang() {
    try { var s = localStorage.getItem(${JSON.stringify(LOCALE_KEY)}); if (s === "zh" || s === "en") return s; } catch (e) {}
    return (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  }
  function show() {
    var n = d.getElementById("boot-slow");
    if (!n || booted()) return;
    var l = lang(), parts = n.querySelectorAll("[data-lang]");
    for (var i = 0; i < parts.length; i++) parts[i].hidden = parts[i].getAttribute("data-lang") !== l;
    n.hidden = false;
  }
  // Once a minute at most, so a chunk that is truly gone cannot reload forever.
  function reloadOnce() {
    try {
      var last = Number(sessionStorage.getItem(RELOADED)) || 0;
      if (Date.now() - last < 60000) return false;
      sessionStorage.setItem(RELOADED, String(Date.now()));
    } catch (e) { return false; }
    location.reload();
    return true;
  }
  w.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t === w) return;
    var src = t.src || t.href || "";
    if (src.indexOf("/_next/static/") < 0) return;
    // After start the app is running and handles its own failures.
    if (booted()) return;
    if (!reloadOnce()) show();
  }, true);
  setTimeout(function () { if (!booted()) show(); }, ${SLOW_MS});
  d.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest("#boot-reload");
    if (b) location.reload();
  });
})();`

/**
 * In the root layout's <head>, as a plain inline <script>: the browser runs it
 * while parsing the HTML, before and without any chunk.
 *
 * NOT next/script's beforeInteractive, which looks like the tool for this and
 * is not: here it ships the code inside the RSC payload for Next's runtime to
 * run — so when the runtime's own chunk is what failed, the guard never ran.
 */
export function BootGuardScript() {
  // In the server's HTML and its hydration only. A <script> React creates on
  // the client never runs and React warns about it — and that is exactly what
  // a client-only render (next dev renders the page in the browser) would do.
  // The server snapshot says "render it", the client's says "don't": hydration
  // matches the HTML, and nothing is ever created client-side.
  const fromServer = useSyncExternalStore(noSubscribe, () => false, () => true)
  return fromServer ? <script id="boot-guard" dangerouslySetInnerHTML={{ __html: GUARD }} /> : null
}

const noSubscribe = () => () => {}
