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

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No close X: the two buttons ARE the choice, and a third way out that
          means "cancel" without saying so is a third thing to read. */}
      <DialogContent showCloseButton={false} className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          {body ? <DialogDescription className="text-xs">{body}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          {/* Destructive, and it is the one that carries the colour: red is
              reserved for "this removes something", which is exactly what is
              being asked about. */}
          <Button
            variant="destructive"
            size="sm"
            autoFocus
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
