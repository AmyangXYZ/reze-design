"use client"

// Publishing a preset. The button opens a dialog rather than publishing on click,
// because publishing is public and permanent — and because name, description and
// tags are how anyone else will ever find the thing.

import { useState } from "react"
import { Check, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePublish } from "@/hooks/use-publish"
import type { LibraryItem, LibraryKind } from "@/lib/library"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_TAGS = 8

export function PublishButton({
  kind,
  defaultName,
  defaultDescription = "",
  defaultTags = [],
  payload,
  className,
  onPublished,
}: {
  kind: Exclude<LibraryKind, "scene">
  defaultName: string
  defaultDescription?: string
  defaultTags?: string[]
  /** Read at submit time, so it captures the latest edits rather than a stale copy. */
  payload: () => unknown
  className?: string
  /** Fires with the created row — the library uses it to promote a draft. */
  onPublished?: (item: LibraryItem) => void
}) {
  const t = useT()
  const { signedIn, publishing, published, failed, nameTaken, publish } = usePublish(kind)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState(defaultDescription)
  const [tags, setTags] = useState(defaultTags.join(", "))

  const submit = async () => {
    const item = await publish(name.trim() || defaultName, payload(), {
      description: description.trim(),
      tags: tags
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_TAGS),
    })
    // A name conflict keeps the dialog open for a rename; other failures show
    // inline too. Only success closes.
    if (!item) return
    onPublished?.(item)
    setOpen(false)
  }

  const trigger = (
    <Button
      size="sm"
      disabled={!signedIn}
      className={cn("h-7 gap-1.5 rounded-md bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-white/90 disabled:opacity-40", className)}
    >
      {published ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />}
      {published ? t.gradeLibrary.publishDone : t.gradeLibrary.publish}
    </Button>
  )

  // Signed out: the tooltip carries the reason, and the dialog never opens.
  if (!signedIn) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{trigger}</span>
        </TooltipTrigger>
        <TooltipContent>{t.gradeLibrary.publishSignIn}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[26rem] border-white/10 bg-zinc-950/95 p-5 sm:max-w-[26rem]"
      >
        <DialogTitle className="text-sm font-medium">{t.library.publishPreset}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">{t.library.publishBlurb}</DialogDescription>
        <form
          className="mt-1 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label className="block">
            <span className="text-[11px] text-muted-foreground">{t.library.publishName}</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              className="mt-1 h-8 border-white/10 bg-white/5 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">{t.library.publishDescription}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t.library.publishDescriptionHint}
              className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-blue-400/50"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">{t.library.publishTags}</span>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t.library.publishTagsHint}
              className="mt-1 h-8 border-white/10 bg-white/5 font-mono text-xs"
            />
          </label>
          {failed && <div className="text-[11px] text-red-400">{t.gradeLibrary.publishFailed}</div>}
          {nameTaken && <div className="text-[11px] text-red-400">{t.library.nameTaken}</div>}
          <Button
            type="submit"
            disabled={publishing}
            className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
          >
            {publishing ? t.account.working : t.gradeLibrary.publish}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground/70">{t.library.publishNote}</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
