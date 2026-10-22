"use client"

// "Are you sure?", as a surface rather than as the browser's alert.
//
// window.confirm blocks the whole page, cannot be styled, cannot be dismissed
// with Escape into the z-stack the rest of the editor lives in, and on a canvas
// app it stops the render loop dead while it is up. It is also the one dialog in
// the product that looks like it belongs to someone else's software.
//
// Deliberately not a hook or a promise: a dialog is state a surface owns, and
// making it awaitable would hide the fact that the surface stays mounted and
// interactive underneath.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { storageKey } from "@/lib/storage"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// "Don't ask again for 7 days": per question, by key, in this browser.
const SNOOZE = storageKey("confirm-snooze")
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

function snoozes(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(SNOOZE) ?? "{}") as Record<string, number>
  } catch {
    return {}
  }
}

/** Whether the question under `key` is snoozed: the caller then acts at once. */
export function confirmSnoozed(key: string): boolean {
  return (snoozes()[key] ?? 0) > Date.now()
}

function snooze(key: string): void {
  try {
    window.localStorage.setItem(SNOOZE, JSON.stringify({ ...snoozes(), [key]: Date.now() + SNOOZE_MS }))
  } catch {
    // Storage blocked: it simply asks again next time.
  }
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  tone = "destructive",
  snoozeKey,
  snoozeLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  /** `destructive` (red) when confirming removes something; `accent` (blue) for
   *  a step that is permanent without removing anything, such as making an
   *  item public. Red keeps its one meaning. */
  tone?: "destructive" | "accent"
  /** Offers "don't ask again" for this question, remembered under this key for
   *  7 days. The caller checks `confirmSnoozed(key)` before opening. */
  snoozeKey?: string
  snoozeLabel?: string
}) {
  const [snoozing, setSnoozing] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No close X: the two buttons ARE the choice, and a third way out that
          means "cancel" without saying so is a third thing to read. */}
      {/* On the cover it is paper in the middle, and its buttons are words: the
          confirming one in its accent, the other plain. Off the cover, the
          dialog's own box. */}
      <DialogContent
        showCloseButton={false}
        paper="center"
        className="sm:max-w-xs data-[paper]:w-[20rem] data-[paper]:max-w-[20rem]"
      >
        <div className="grid gap-4 in-data-[paper]:p-5">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          {body ? <DialogDescription className="text-xs">{body}</DialogDescription> : null}
        </DialogHeader>
        {/* The checkbox rides with the buttons it qualifies, closer than the
            dialog's own 16px gap. */}
        <div className="grid gap-2">
          {snoozeKey && snoozeLabel ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={snoozing}
                onCheckedChange={(v) => setSnoozing(v === true)}
                className="border-line-strong data-[state=checked]:border-blue-400 data-[state=checked]:bg-blue-400 data-[state=checked]:text-on-accent dark:data-[state=checked]:bg-blue-400"
              />
              {snoozeLabel}
            </label>
          ) : null}
          <DialogFooter className="in-data-[paper]:gap-5">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="in-data-[paper]:h-6 in-data-[paper]:px-0">
              {cancelLabel}
            </Button>
            {/* Destructive, and it is the one that carries the colour: red is
                reserved for "this removes something", which is exactly what is
                being asked about. */}
            <Button
              variant={tone === "destructive" ? "destructive" : "default"}
              size="sm"
              autoFocus
              className={cn(
                tone === "accent" && "bg-blue-400 text-on-accent hover:bg-blue-400/90",
                // The variant's own fill (dark: included) gives way on paper.
                "in-data-[paper]:h-6 in-data-[paper]:bg-transparent! in-data-[paper]:px-0 in-data-[paper]:hover:bg-transparent! in-data-[paper]:hover:underline in-data-[paper]:underline-offset-4",
                tone === "accent" ? "in-data-[paper]:text-blue-400!" : "in-data-[paper]:text-red-400!",
              )}
              onClick={() => {
                if (snoozeKey && snoozing) snooze(snoozeKey)
                onOpenChange(false)
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
