"use client"

// Publishing a preset. The button opens a dialog rather than publishing on click,
// because publishing is public and permanent — and because name, description and
// tags are how anyone else will ever find the thing.

import { useState } from "react"
import { Check, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TagsInput } from "@/components/editor/tags-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { usePublish } from "@/hooks/use-publish"
import { publishClash } from "@/lib/names"
import { normalizeName, type LibraryItem, type LibraryKind } from "@/lib/library"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_TAGS = 5

export function PublishButton({
  kind,
  defaultName,
  defaultDescription = "",
  defaultTags = [],
  payload,
  itemId,
  forkedFromId,
  className,
  onPublished,
}: {
  kind: Exclude<LibraryKind, "scene">
  defaultName: string
  defaultDescription?: string
  defaultTags?: string[]
  /** Read at submit time, so it captures the latest edits rather than a stale copy. */
  payload: () => unknown
  /** The item's identity. A draft keeps its uuid through publishing; a working
   *  copy of something you already published carries THAT id, so this replaces
   *  that item rather than making a second one. */
  itemId?: string
  /** Someone else's item this was derived from — recorded as lineage. */
  forkedFromId?: string
  className?: string
  /** Fires with the created row — the library uses it to promote a draft. */
  onPublished?: (item: LibraryItem) => void
}) {
  const t = useT()
  const { signedIn, publishing, published, failed, nameTaken, publish } = usePublish(kind)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState(defaultDescription)
  const [tags, setTags] = useState<string[]>(defaultTags)

  // Every draft is publishable; a taken name is what blocks it. Checked here as
  // well as on the server — the server is the one that counts, but a round trip
  // to learn a name is taken delivers the message after the publish already
  // looked like it was working.
  const clash = publishClash(kind, name, itemId)

  const submit = async () => {
    if (clash) return
    const item = await publish(normalizeName(name) || defaultName, payload(), {
      id: itemId,
      forkedFromId,
      description: description.trim(),
      tags,
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
        onOpenAutoFocus={(e) => e.preventDefault()}
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
          // Publishing takes a click, never a stray Enter from a text field.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault()
          }}
        >
          <label className="block">
            <span className="text-xs text-muted-foreground">{t.library.publishName}</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className={cn(
                "mt-1 h-9 border-white/10 bg-white/5 text-sm md:text-sm",
                clash && "border-red-400/60",
              )}
            />
            {clash && <p className="mt-1 text-[11px] text-red-400">{t.library.nameTakenBy(clash)}</p>}
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t.library.publishDescription}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t.library.publishDescriptionHint}
              className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-blue-400/50"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t.library.publishTags}</span>
            <TagsInput value={tags} onChange={setTags} max={MAX_TAGS} placeholder={t.library.publishTagsHint} />
          </label>
          {failed && <div className="text-[11px] text-red-400">{t.gradeLibrary.publishFailed}</div>}
          {nameTaken && <div className="text-[11px] text-red-400">{t.library.nameTaken}</div>}
          <Button
            type="submit"
            disabled={publishing || !!clash || !name.trim() || !description.trim() || tags.length === 0}
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
