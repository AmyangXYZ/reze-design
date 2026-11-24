"use client"

// A phone held upright, over the editor: turn it sideways. The editor is the
// computer's (a phone gets all of it, as a tablet does: lib/device), and its
// chrome needs the long side across. A page cannot turn an iPhone for you
// (iOS has no orientation lock), so this asks, on white paper as the
// dialogs are, and the editor stays mounted under it: turning back and forth
// loses nothing. Where the browser can lock the screen (Android, in full
// screen), one tap turns it.

import { useSyncExternalStore } from "react"
import { RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePhone } from "@/lib/device"
import { useT } from "@/lib/i18n"

const PORTRAIT = "(orientation: portrait)"

function subscribePortrait(onChange: () => void) {
  const mq = window.matchMedia(PORTRAIT)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
const isPortrait = () => window.matchMedia(PORTRAIT).matches

type Lockable = ScreenOrientation & { lock?: (o: "landscape") => Promise<void> }

/** Android's way: full screen, then the lock. Undefined where it cannot. */
function canLock(): boolean {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && typeof (screen.orientation as Lockable | undefined)?.lock === "function"
}

async function turn() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    await (screen.orientation as Lockable).lock?.("landscape")
  } catch {
    // Refused (a browser that offers the call but will not lock): the words
    // above the button still say what to do.
  }
}

export function TurnSideways() {
  const t = useT()
  const phone = usePhone()
  const portrait = useSyncExternalStore(subscribePortrait, isPortrait, () => false)
  if (!phone || !portrait) return null
  return (
    <div
      data-keep
      data-paper="light"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-surface px-10 text-center text-foreground"
    >
      <RotateCw className="size-6" />
      <p className="text-sm font-medium">{t.phone.turn}</p>
      <p className="text-xs text-balance text-muted-foreground">{t.phone.why}</p>
      {canLock() && (
        <Button size="sm" onClick={() => void turn()} className="mt-2">
          {t.phone.rotate}
        </Button>
      )}
    </div>
  )
}
