"use client"

// Closing an editor with unsaved changes. Editors are scratchpads — nothing lands
// in the library until this dialog says so, which is what makes the library a
// collection of things you chose to keep rather than every fork ever touched.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"

export function SaveCloseDialog({
  defaultName,
  askName = true,
  onSave,
  onDiscard,
  onCancel,
}: {
  /** False when the item already has a home (an existing draft) — the dialog then
   *  only appears to surface a refused save, and renaming isn't on offer. */
  askName?: boolean
  /** Pre-deduped suggestion — what the item will actually be called. */
  defaultName: string
  /** Return an error message to REFUSE the save — the dialog stays open and shows
   *  it. A broken shader must never land in the library: it would be auto-applied
   *  on every future pick and raise engine errors. */
  onSave: (name: string) => void | string | null | Promise<void | string | null>
  onDiscard: () => void
  /** Escape / clicking away: back to editing, nothing decided. */
  onCancel: () => void
}) {
  const t = useT()
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[22rem] border-white/10 bg-zinc-950/95 p-5 sm:max-w-[22rem]"
      >
        <DialogTitle className="text-sm font-medium">{t.library.saveChanges}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">{t.library.saveChangesBlurb}</DialogDescription>
        <form
          className="mt-1 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            void Promise.resolve(onSave(name.trim() || defaultName)).then((err) => {
              setBusy(false)
              if (err) setError(err)
            })
          }}
        >
          {askName && (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="h-8 border-white/10 bg-white/5 text-xs"
            />
          )}
          {error && (
            <p className="max-h-16 overflow-y-auto font-mono text-[11px] leading-relaxed break-all text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onDiscard}
              className="h-8 flex-1 text-xs text-red-400 hover:bg-red-400/10 hover:text-red-400"
            >
              {t.library.discard}
            </Button>
            <Button type="submit" disabled={busy} className="h-8 flex-1 bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-50">
              {t.library.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
