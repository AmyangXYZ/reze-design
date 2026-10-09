"use client"

// Publishing a preset. The button opens a dialog rather than publishing on click,
// because publishing is public and permanent — and because name, description and
// tags are how anyone else will ever find the thing.

import { useState } from "react"
import { Check, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { TagsInput } from "@/components/editor/tags-input"
import { VisibilityPicker, type Visibility } from "@/components/editor/library-shell"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { usePublish } from "@/hooks/use-publish"
import { publishClash } from "@/lib/names"
import { normalizeName, type LibraryItem, type LibraryKind } from "@/lib/library"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_TAGS = 5

// ── The publish dialogs' one skin ──
//
// Shared with the scene's (share-scene.tsx) so a grade, a shader, an effect and
// a scene are published through what reads as the same form: the same field
// sizes, the same type scale, the same frame. Capped at the viewport: a header
// that stays, a body that scrolls, and a footer holding the submit and its
// errors, so a long "publish these first" list can never push the button —
// or the top of the dialog — off screen.
export const PUBLISH_DIALOG =
  "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-surface border-line-strong bg-surface-raised p-0"
/** Right padding clears the dialog's close button. */
export const PUBLISH_HEAD = "shrink-0 px-4 pt-4 pr-11"
/** The close button ON the title row. One 16px inset on every side of these
 *  dialogs — top, sides, bottom — and the X in a 20px box with the icon
 *  centred, the same box the titles state (h-5), so the X shares the title's
 *  centre line and the body's right edge. */
export const PUBLISH_CLOSE = "top-4 right-4 flex h-5 items-center"
export const PUBLISH_FORM = "flex min-h-0 flex-1 flex-col"
export const PUBLISH_BODY = "flex min-h-0 flex-col gap-3.5 overflow-y-auto px-4 pt-4 pb-1"
export const PUBLISH_FOOT = "flex shrink-0 flex-col gap-2 px-4 pt-3 pb-4"
export const PUBLISH_INPUT = "mt-0.5 h-8 border-line-strong bg-white/5 text-xs md:text-xs"
export const PUBLISH_TEXTAREA = "mt-0.5 max-h-40 border-line-strong bg-white/5 px-2.5 py-2 text-xs leading-relaxed md:text-xs"

export function PublishButton({
  kind,
  defaultName,
  defaultDescription = "",
  defaultTags = [],
  payload,
  itemId,
  forkedFromId,
  className,
  currentVisibility,
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
  /** What this item's visibility already is, when republishing over one you own.
   *  Gates the choice: nothing reachable can go back to private. */
  currentVisibility?: Visibility
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
  // Publishing is a public act by default; the other two are deliberate choices.
  const [visibility, setVisibility] = useState<Visibility>("public")

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
      visibility,
    })
    // A name conflict keeps the dialog open for a rename; other failures show
    // inline too. Only success closes.
    if (!item) return
    onPublished?.(item)
    setOpen(false)
    // The dialog closing is the only other sign it worked, and a surface that
    // disappears is indistinguishable from one that was dismissed.
    toast.success(`${t.gradeLibrary.publishDone} · ${item.name}`)
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
        {/* block, not the default inline: a tooltip needs a wrapper around a
            disabled button, and an inline one sits outside the column's vertical
            rhythm — so signed-out viewers saw a different gap here than
            everybody else. */}
        <TooltipTrigger asChild>
          <span className="block">{trigger}</span>
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
        aria-describedby={undefined}
        className={PUBLISH_DIALOG + " w-[26rem] sm:max-w-[26rem]"}
        closeClassName={PUBLISH_CLOSE}
      >
        <div className={PUBLISH_HEAD}>
          <DialogTitle className="flex h-5 items-center gap-2 text-sm font-medium">
            <Share2 className="size-4 text-blue-400" />
            {t.library.publishPreset}
          </DialogTitle>
        </div>
        <form
          className={PUBLISH_FORM}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          // Publishing takes a click, never a stray Enter from a text field.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault()
          }}
        >
          <div className={PUBLISH_BODY}>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.library.publishName}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className={cn(PUBLISH_INPUT, clash && "border-red-400/60")}
              />
              {clash && <p className="mt-1 text-[11px] text-red-400">{t.library.nameTakenBy(clash)}</p>}
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.library.publishDescription}</span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t.library.publishDescriptionHint}
                className={PUBLISH_TEXTAREA + " min-h-[4.5rem]"}
              />
            </label>
            <label className="block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t.library.publishTags}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {tags.length}/{MAX_TAGS}
                </span>
              </span>
              <TagsInput value={tags} onChange={setTags} max={MAX_TAGS} placeholder={t.library.publishTagsHint} />
            </label>
            <VisibilityPicker value={visibility} onChange={setVisibility} current={currentVisibility} />
          </div>
          <div className={PUBLISH_FOOT}>
            {failed && <div className="text-[11px] text-red-400">{t.gradeLibrary.publishFailed}</div>}
            {nameTaken && <div className="text-[11px] text-red-400">{t.library.nameTaken}</div>}
            <Button
              type="submit"
              disabled={publishing || !!clash || !name.trim() || !description.trim() || tags.length === 0}
              className="h-9 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-50"
            >
              {publishing ? t.account.working : t.gradeLibrary.publish}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
