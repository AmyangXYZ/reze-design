"use client"

// A finger held still is a right-click, app-wide, as iPadOS has it.
//
// An iPad gets the computer's editor (lib/device), and the computer's editor
// keeps its second actions behind the context menu: a node's, a material's, a
// block's. A touch fires no `contextmenu` of its own, and Radix's own
// long-press opens its menu without one, so every handler that picks its
// target in `onContextMenu` (React Flow's pane/node/edge menus, the material
// rows, the effect blocks, the timeline's lanes) would open on nothing. So a
// touch held 500ms without moving dispatches a real `contextmenu` where the
// finger is, through the same handlers the mouse's right button goes
// through. The click its lift would make is swallowed: the hold was the act.
//
// Android's browser fires its own `contextmenu` for a hold; whichever comes
// first is the one, and the other is dropped, so a menu never opens twice.
//
// Two quick taps are a double-click. The browser makes one itself on most
// of the page, but not on a surface that takes the finger whole
// (touch-action none: the graph's canvas, the curves, the timeline), where the
// editor keeps renames and adds behind a double-click. So a second tap within
// 300ms and a finger's width of the first dispatches `dblclick` there, unless
// the browser's own arrives first.
//
// Touch only: a mouse and a pen keep their own buttons. Text fields keep the
// system's own hold (the caret loupe, select, paste).

import { useEffect } from "react"

const HOLD_MS = 500
/** A finger wanders a little while held; past this it is a drag. */
const SLOP = 8
const DOUBLE_MS = 300
/** Two taps this close are one place. */
const DOUBLE_SLOP = 24
const KEEPS_OWN_HOLD = "input,textarea,select,[contenteditable=true]"

export function TouchGestures() {
  useEffect(() => {
    let timer = 0
    let start: { id: number; x: number; y: number; target: Element } | null = null
    let swallowUntil = 0
    /** Ours fired: the browser's own, if it follows, is the same hold. */
    let firedAt = 0
    /** The last tap: where, when, and whether it was still a tap at its lift. */
    let lastTap: { x: number; y: number; t: number } | null = null
    let tapStart: { id: number; x: number; y: number; t: number } | null = null
    let nativeDouble = 0
    /** A second tap whose click is due: the double-click goes out inside it. */
    let dueDouble: { x: number; y: number; t: number } | null = null
    /** Ours went out: the browser's own, if it follows, is the same taps. */
    let sentDouble = 0
    const cancel = () => {
      window.clearTimeout(timer)
      start = null
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return
      tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }
      // A second finger is a pinch or a pan, never a hold.
      if (start) return cancel()
      const target = e.target
      if (!(target instanceof Element) || target.closest(KEEPS_OWN_HOLD)) return
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, target }
      timer = window.setTimeout(() => {
        if (!start) return
        const { x, y } = start
        const at = document.elementFromPoint(x, y) ?? start.target
        start = null
        swallowUntil = performance.now() + 800
        firedAt = performance.now()
        at.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 2, buttons: 0, view: window }),
        )
      }, HOLD_MS)
    }
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel()
    }
    const onEnd = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) cancel()
      if (e.type !== "pointerup" || e.pointerType !== "touch" || !tapStart || e.pointerId !== tapStart.id) return
      const now = performance.now()
      const still = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) <= SLOP && now - tapStart.t < HOLD_MS
      tapStart = null
      if (!still) {
        lastTap = null
        return
      }
      const prev = lastTap
      if (!prev || now - prev.t > DOUBLE_MS || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > DOUBLE_SLOP) {
        lastTap = { x: e.clientX, y: e.clientY, t: now }
        return
      }
      lastTap = null
      const { clientX: x, clientY: y } = e
      const asked = now
      // Sent from inside this tap's click, so what it opens is the user's own
      // act: iOS raises the keyboard only for a field focused in a gesture,
      // never from a timer. A surface that makes no click (it cancelled the
      // touch) gets it from the timer, keyboard or not.
      dueDouble = { x, y, t: asked }
      window.setTimeout(() => {
        if (dueDouble?.t === asked) sendDouble()
      }, 60)
    }
    const sendDouble = () => {
      const due = dueDouble
      dueDouble = null
      if (!due || nativeDouble >= due.t) return
      sentDouble = performance.now()
      const { x, y } = due
      document.elementFromPoint(x, y)?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, detail: 2, view: window }),
      )
    }
    /** The bubble's last stop: the click has been everywhere it goes. */
    const afterClick = (e: MouseEvent) => {
      if (dueDouble && e.isTrusted) sendDouble()
    }
    const onNativeDouble = (e: MouseEvent) => {
      if (!e.isTrusted) return
      // Ours already went out for these taps: one double-click, not two.
      if (performance.now() - sentDouble < 300) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      nativeDouble = performance.now()
    }
    const onNativeMenu = (e: MouseEvent) => {
      if (!e.isTrusted) return
      // The browser's came first: it is the hold, ours stands down.
      if (start) return cancel()
      if (performance.now() - firedAt < 800) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onClick = (e: MouseEvent) => {
      // The second tap's click lands as it is; the double-click follows it
      // (afterClick), in the mouse's order.
      if (dueDouble && e.isTrusted) return
      if (performance.now() > swallowUntil) return
      swallowUntil = 0
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("pointermove", onMove, true)
    document.addEventListener("pointerup", onEnd, true)
    document.addEventListener("pointercancel", onEnd, true)
    document.addEventListener("click", onClick, true)
    document.addEventListener("contextmenu", onNativeMenu, true)
    document.addEventListener("dblclick", onNativeDouble, true)
    window.addEventListener("click", afterClick)
    return () => {
      cancel()
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("pointermove", onMove, true)
      document.removeEventListener("pointerup", onEnd, true)
      document.removeEventListener("pointercancel", onEnd, true)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("contextmenu", onNativeMenu, true)
      document.removeEventListener("dblclick", onNativeDouble, true)
      window.removeEventListener("click", afterClick)
    }
  }, [])
  return null
}
