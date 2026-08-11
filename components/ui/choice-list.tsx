"use client"

// A short list of choices in a dialog: pick one, and the dialog closes.
//
// Three of these exist — language, look pack, which .pmx — and they were all
// keyboard dead ends. The dialogs suppress Radix's opening focus (it lands on
// whatever is first, which for a picker is an arbitrary row), so nothing was
// focused at all: tab walked in from the top, and the arrow keys did nothing,
// which is the one thing a vertical list of options invites you to try.
//
// So the behaviour lives here rather than three times over: the current value
// takes focus when the dialog opens, and Up/Down move between rows. Focus is
// roving over real buttons rather than an aria-activedescendant — these ARE
// buttons, and Enter and Space already do the right thing on one.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Every enabled row, in the order they are on screen. */
const rowsOf = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])

export function ChoiceList({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  // On open, land on the row you are already on — `data-current`, set by the
  // caller — so Down moves off a known place rather than from nowhere. A list
  // with no current value (which .pmx) starts at the top, which is the only
  // honest guess.
  useEffect(() => {
    const rows = rowsOf(ref.current)
    const current = rows.find((r) => r.dataset.current === "true")
    ;(current ?? rows[0])?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"]
    if (!keys.includes(e.key)) return
    const rows = rowsOf(ref.current)
    if (rows.length === 0) return
    // Wraps. The list is short and entirely on screen, so falling off the end is
    // a dead stop for no reason; from the last row, Down obviously means the top.
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : e.key === "ArrowDown"
            ? (at + 1 + rows.length) % rows.length
            : (at - 1 + rows.length) % rows.length
    // The dialog scrolls on a long .pmx list, and the browser would otherwise
    // scroll the container out from under the row it just focused.
    e.preventDefault()
    rows[next]?.focus()
  }

  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      // Focus is shown by lighting the ROW, not by ringing it. A focus ring is a
      // heavy white rectangle drawn around something that is already a full-width
      // target, and on the row you are currently ON it reads as a second, louder
      // selection competing with the check mark. Blue is the accent that means
      // selected/active/focus, so this is the same statement the rest of the
      // chrome makes, at the same weight as the hover it replaces.
      //
      // Set here rather than on each list: three dialogs wear this, and a focus
      // style that drifted between them would be a bug nobody would think to look
      // for.
      className={cn(
        "space-y-0.5 [&_button]:outline-none [&_button:focus]:bg-blue-300/15 [&_button:focus]:text-foreground",
        className,
      )}
    >
      {children}
    </div>
  )
}
