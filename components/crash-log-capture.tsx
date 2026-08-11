"use client"

// Starts the console/error ring buffer that CrashScreen reports from.
//
// Mounted in the root layout so capture begins before the engine does — the
// warnings that explain a crash (a texture that would not decode, a style group
// that failed to compile, an evicted bundle) are all printed well before the
// throw that ends the render.

import { useEffect } from "react"
import { installCrashLog } from "@/lib/crash-log"

export function CrashLogCapture() {
  // In an effect, not at module scope: this only ever wants to run in the
  // browser, and installCrashLog is a no-op on a second call anyway.
  useEffect(() => installCrashLog(), [])
  return null
}
