"use client"

// Publishing a SCENE: zip the uploaded assets automatically, PUT them straight to
// R2 (Vercel never sees the bytes), then publish the document. The user fills a
// name and blurb — never re-uploads what the scene is already showing.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, Copy, ExternalLink, GalleryThumbnails, Globe, ImagePlus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TagsInput } from "@/components/editor/tags-input"
import { noteScenePublished, type GalleryScene } from "@/components/editor/scene-gallery"
import { buildZip, type BundleEntry } from "@/lib/bundle"
import type { LibraryItem } from "@/lib/library"
import { sceneRefs, type SceneDoc } from "@/lib/scene"
import { useSession } from "@/lib/auth-client"
import type { UnpublishedUse } from "@/lib/refs"
import { useT } from "@/lib/i18n"

const MAX_TAGS = 5
// Generous: an untouched Retina screenshot is routinely past 10MB.
const MAX_POSTER_BYTES = 20 * 1024 * 1024
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024

// The written parts of a publish, kept until the scene is actually published.
//
// Taking the thumbnail means leaving this dialog — often the app entirely — and
// coming back to a blank form after composing a description and a credits list is
// the kind of small loss that stops people publishing at all. Per scene, so two
// scenes in two tabs don't overwrite each other's drafts.
type Draft = { description: string; tags: string[]; credits: string }

const draftKey = (sceneId: string) => `reze:publish-draft:${sceneId}`

function readDraft(sceneId: string): Draft {
  const empty: Draft = { description: "", tags: [], credits: "" }
  // Runs during SSR too — the dialog is mounted (closed) with the editor.
  if (typeof window === "undefined") return empty
  try {
    const raw = window.localStorage.getItem(draftKey(sceneId))
    if (!raw) return empty
    const d = JSON.parse(raw) as Partial<Draft>
    return {
      description: typeof d.description === "string" ? d.description : "",
      tags: Array.isArray(d.tags) ? d.tags.filter((x): x is string => typeof x === "string") : [],
      credits: typeof d.credits === "string" ? d.credits : "",
    }
  } catch {
    return empty
  }
}

/**
 * PUT with upload progress. `fetch` reports nothing until the whole body is sent,
 * which for a 200MB bundle is several silent minutes — indistinguishable from a
 * hang, and the first thing anyone does about a hang is reload and lose the work.
 */
// Only `content-type` goes on this request. Every header set here has to be in
// the bucket's CORS allow-list or the preflight is refused, and XHR reports that
// as a bare "network error" with no status to go on — which is exactly how an
// attempt to send `cache-control` presented. Cache headers are applied to the
// object out of band; see scripts/r2-backfill-cache.mjs.
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("content-type", contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("network error"))
    xhr.ontimeout = () => reject(new Error("timed out"))
    xhr.send(body)
  })
}

/** Whatever the server said, when it said anything. */
async function reason(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}

export type ScenePublishSource = {
  /** Files to bundle — empty when the scene only uses site-served assets. */
  entries: BundleEntry[]
  /** The document, with asset paths already bundle-relative. */
  makeDoc: (bundle: string | null) => SceneDoc
}

type Step = "idle" | "packing" | "uploading" | "publishing" | "done"

export function ShareSceneDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneId: string
  sceneName: string
  onRename: (name: string) => void
  forkedFromId?: string
  collect: () => ScenePublishSource
  unpublished: () => UnpublishedUse[]
  /** Closes this dialog and opens the gallery — offered once the scene is up. */
  onGallery: () => void
}) {
  // Mounted only while open, so every publish starts from a clean form. Kept
  // mounted, the dialog reopened onto the previous publish's success screen —
  // with the previous scene's link.
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onOpenChange(false)}>
      {props.open && <ShareSceneForm {...props} />}
    </Dialog>
  )
}

function ShareSceneForm({
  sceneId,
  sceneName,
  onRename,
  forkedFromId,
  collect,
  unpublished,
  onGallery,
}: {
  /** The working scene's client-minted id. Keys the saved draft — the upload gets
   *  its own id per publish (see `publishScope`). */
  sceneId: string
  sceneName: string
  /** Renaming here renames the working scene too — one name, top-left included. */
  onRename: (name: string) => void
  /** The scene this session was forked from, if any. Lineage, recorded quietly. */
  forkedFromId?: string
  collect: () => ScenePublishSource
  /** Looks this scene uses that exist in no library. Publishing is blocked while
   *  this is non-empty — see lib/refs.ts for why. */
  unpublished: () => UnpublishedUse[]
  onGallery: () => void
}) {
  const t = useT()
  const { data: session } = useSession()
  // Lazily from storage: nothing is rendered until the dialog opens, so reading
  // client-only state here can't disagree with the server's markup.
  const [draft] = useState(() => readDraft(sceneId))
  // Looks this scene wears that no library has. Read once — the scene is frozen
  // behind this dialog — and it blocks publishing outright: see lib/refs.ts.
  const [blocking] = useState(() => unpublished())
  const [description, setDescription] = useState(draft.description)
  const [tags, setTags] = useState<string[]>(draft.tags)
  const [credits, setCredits] = useState(draft.credits)
  // Chosen by the author, not grabbed from the canvas: the frame that happens to
  // be showing at publish is rarely the one they would pick to represent the work.
  const [poster, setPoster] = useState<File | null>(null)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const posterInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("idle")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [row, setRow] = useState<LibraryItem | null>(null)
  const [copied, setCopied] = useState(false)

  const busy = step !== "idle" && step !== "done"

  // Written as you type, not on close: the way this form gets abandoned is the tab
  // going away to a screenshot tool, which fires no close handler.
  useEffect(() => {
    if (step === "done") return
    const draft: Draft = { description, tags, credits }
    const key = draftKey(sceneId)
    if (!description && !tags.length && !credits) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(draft))
  }, [sceneId, description, tags, credits, step])
  // Whatever origin this is — localhost while testing, reze.design in production.
  // Hard-coding the production host meant a link you could not follow from a dev
  // build, and one you could not verify before it was real.
  const shareUrl = row && session ? `${window.location.origin}/${session.user.username ?? "you"}/${row.id}` : null

  const publish = async () => {
    if (!session || busy) return
    // Disabling the button is the courtesy; this is the rule.
    if (blocking.length > 0) return
    setError(null)
    // A fresh storage scope per publish. Keying the bundle by the WORKING scene id
    // meant two publishes from one editor session wrote the same object: the first
    // scene silently started serving the second one's models.
    const publishScope = crypto.randomUUID()
    // Which step is in flight, so a thrown error can say what actually failed
    // rather than "something went wrong" for four unrelated causes.
    let stage: Step = "packing"
    try {
      setStep("packing")
      const { entries, makeDoc } = collect()
      let bundle: string | null = null
      let bundleKey: string | null = null
      let bundleBytes = 0
      let posterKey: string | null = null
      if (entries.length > 0) {
        const zip = await buildZip(entries)
        if (zip.size > MAX_BUNDLE_BYTES) {
          setStep("idle")
          setError(t.share.bundleTooBig(Math.round(zip.size / 1048576)))
          return
        }
        stage = "uploading"
        setStep("uploading")
        const presign = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sceneId: publishScope, size: zip.size }),
        })
        if (!presign.ok) throw new Error(`presign ${presign.status}`)
        const { uploadUrl, key, publicUrl } = (await presign.json()) as {
          uploadUrl: string
          key: string
          publicUrl: string
        }
        setProgress(0)
        await putWithProgress(uploadUrl, zip, "application/zip", setProgress)
        bundle = publicUrl
        bundleKey = key
        bundleBytes = zip.size
      }
      if (poster) {
        const presign = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sceneId: publishScope, size: poster.size, kind: "poster", contentType: poster.type }),
        })
        if (!presign.ok) throw new Error(await reason(presign))
        const { uploadUrl, key } = (await presign.json()) as { uploadUrl: string; key: string }
        await putWithProgress(uploadUrl, poster, poster.type, () => {})
        posterKey = key
      }

      stage = "publishing"
      setStep("publishing")
      const finalName = sceneName.trim()
      if (finalName !== sceneName) onRename(finalName)
      const doc = { ...makeDoc(bundle), name: finalName }
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "scene",
          name: doc.name,
          payload: { doc },
          description: description.trim(),
          credits: credits.trim(),
          bundleKey,
          bundleBytes,
          posterKey,
          forkedFromId,
          // The published presets this scene pins — recorded as edges so "used in
          // N scenes" is a join rather than a scan through documents.
          uses: sceneRefs(doc),
          tags,
        }),
      })
      if (res.status === 409) {
        setStep("idle")
        setError(t.library.nameTaken)
        return
      }
      if (!res.ok) throw new Error(await reason(res))
      const { item } = (await res.json()) as { item: LibraryItem & GalleryScene }
      // Into the gallery's cached lists directly. Emptying them instead would mean
      // the next open had nothing to paint and showed a spinner over a blank grid.
      noteScenePublished({
        id: item.id,
        name: item.name,
        author: item.author,
        description: item.description ?? "",
        credits: credits.trim(),
        tags: item.tags ?? [],
        likeCount: 0,
        viewCount: 0,
        poster: item.poster ?? null,
        createdAt: item.createdAt ?? new Date().toISOString(),
      })
      // Published — the draft has served its purpose.
      window.localStorage.removeItem(draftKey(sceneId))
      setRow(item)
      setStep("done")
    } catch (e) {
      setStep("idle")
      const detail = e instanceof Error ? e.message : String(e)
      // Which step, plus what the server or network actually said. A publish can
      // fail at four different places for unrelated reasons, and "try again" is
      // useless advice when the real answer is "sign in" or "your file is 240MB".
      setError(
        `${stage === "uploading" ? t.share.failedUpload : stage === "publishing" ? t.share.failedPublish : t.share.failedPacking}${detail ? ` — ${detail}` : ""}`,
      )
    }
  }

  const stepLabel =
    step === "packing"
      ? t.share.packing
      : step === "uploading"
        ? `${t.share.uploading} ${Math.round(progress * 100)}%`
        : t.share.publishing

  return (
    <DialogContent
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      // A publish in flight owns the dialog: closing it mid-upload would abandon
      // a bundle already on its way to storage. All three exits are held here
      // rather than on the Dialog root, which no longer sees `busy`.
      showCloseButton={!busy}
      onEscapeKeyDown={(e) => busy && e.preventDefault()}
      onInteractOutside={(e) => busy && e.preventDefault()}
      className="grid w-[34rem] gap-0 border-white/10 bg-zinc-950/95 p-5 sm:max-w-[34rem]"
    >
        <DialogTitle className="flex items-center gap-2 text-sm font-medium">
          <Globe className="size-4 text-blue-400" />
          {t.share.title}
        </DialogTitle>
        <DialogDescription className="mt-0.5 text-xs leading-snug text-muted-foreground/80">{t.share.blurb}</DialogDescription>

        {/* Shown before the form rather than on submit: discovering a block after
            writing a description, choosing tags and picking a thumbnail is the
            worst moment to learn about it. */}
        {blocking.length > 0 && step !== "done" && (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5">
            <p className="text-xs font-medium text-amber-300">{t.share.unpublishedTitle}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-amber-200/70">{t.share.unpublishedBlurb}</p>
            <ul className="mt-1.5 space-y-0.5">
              {blocking.map((u) => (
                <li key={`${u.kind}:${u.name}`} className="font-mono text-[11px] text-amber-200/90">
                  {t.share.unpublishedKind[u.kind as "graph" | "grade" | "effect"]} · {u.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === "done" && shareUrl ? (
          <div className="mt-1 min-w-0 space-y-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-xs">
                {shareUrl}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 text-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-8 w-full border border-white/10 text-xs font-medium hover:bg-white/5"
            >
              {/* This tab, client-side. The scene is published — the editor has
                  nothing left to lose — and a second tab would mean a second live
                  WebGPU device. Cmd-click still opens one for anyone who wants it. */}
              <Link href={new URL(shareUrl).pathname}>
                <ExternalLink className="size-3.5" />
                {t.share.openScene}
              </Link>
            </Button>
            {/* The other place the scene now exists. Below opening it, because
                seeing your own scene is the first thing you want and the shelf
                it landed on is the second — and it is the same door as the top
                bar's, so it carries that door's name rather than a new one. */}
            <Button size="sm" className="h-8 w-full text-xs font-medium" onClick={onGallery}>
              <GalleryThumbnails className="size-3.5" />
              {t.gallery.door}
            </Button>
          </div>
        ) : (
          <form
            className="mt-3 space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              void publish()
            }}
            // Publishing is public and permanent — it takes a click, never a
            // stray Enter from a text field.
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault()
            }}
          >
            {/* Name and description beside the image, with the description
                stretching to meet its bottom edge — pinning two short fields to
                opposite ends left a hole in the middle instead. */}
            <div className="grid grid-cols-[1fr_15rem] items-stretch gap-3">
              <div className="flex min-w-0 flex-col gap-2.5">
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t.library.publishName}</span>
                  <Input
                    value={sceneName}
                    onChange={(e) => onRename(e.target.value)}
                    maxLength={60}
                    className="mt-0.5 h-8 border-white/10 bg-white/5 text-xs md:text-xs"
                  />
                </label>
                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="text-xs text-muted-foreground">{t.library.publishDescription}</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                    placeholder={t.library.publishDescriptionHint}
                    className="mt-0.5 min-h-0 flex-1 resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:border-blue-400/50"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t.share.thumbnail}</span>
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (!f) return
                    if (f.size > MAX_POSTER_BYTES) {
                      setError(t.share.thumbnailTooBig)
                      return
                    }
                    setError(null)
                    setPoster(f)
                    setPosterUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev)
                      return URL.createObjectURL(f)
                    })
                  }}
                />
                {/* The preview IS the control — a separate button beside it was two
                    affordances for one action. */}
                <button
                  type="button"
                  onClick={() => posterInputRef.current?.click()}
                  className="mt-0.5 block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-md border border-white/10 bg-white/5 transition-colors hover:border-white/25"
                >
                  {posterUrl ? (
                    // Any shape is fine: the card crops to fill, so authors aren't
                    // asked to produce a particular aspect ratio.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={posterUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground/60">
                      <ImagePlus className="size-4" />
                      <span className="text-[11px]">{t.share.thumbnailPick}</span>
                    </span>
                  )}
                </button>
              </label>
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t.library.publishTags}</span>
                {/* The cap, stated. Five was already enforced silently. */}
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {tags.length}/{MAX_TAGS}
                </span>
              </span>
              <TagsInput value={tags} onChange={setTags} max={MAX_TAGS} placeholder={t.library.publishTagsHint} />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.share.credits}</span>
              {/* The one thing in this dialog a publisher must actually read. */}
              <p className="mt-0.5 text-xs leading-snug text-amber-200/90">{t.share.creditsWhy}</p>
              <textarea
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder={t.share.creditsHint}
                className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:border-blue-400/50"
              />
            </label>
            {error && (
              <div className="rounded-md bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed break-words text-red-400">
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={
                !session ||
                busy ||
                blocking.length > 0 ||
                !sceneName.trim() ||
                !description.trim() ||
                tags.length === 0 ||
                !credits.trim() ||
                !poster
              }
              className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {stepLabel}
                </>
              ) : session ? (
                t.gradeLibrary.publish
              ) : (
                t.share.signIn
              )}
            </Button>
          </form>
        )}
    </DialogContent>
  )
}
