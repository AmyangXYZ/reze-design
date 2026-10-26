"use client"

// Publishing a SCENE: zip the uploaded assets automatically, PUT them straight to
// R2 (Vercel never sees the bytes), then publish the document. The user fills a
// name and blurb — never re-uploads what the scene is already showing.

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Check, Copy, ExternalLink, Eye, GalleryThumbnails, Globe, ImagePlus, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useCover } from "@/components/ui/cover"
import { Input } from "@/components/ui/input"
import { Mark, Notice } from "@/components/ui/notice"
import { Textarea } from "@/components/ui/textarea"
import { TagsInput } from "@/components/editor/tags-input"
import {
  PUBLISH_BODY,
  PUBLISH_CLOSE,
  PUBLISH_DIALOG,
  PUBLISH_FOOT,
  PUBLISH_FORM,
  PUBLISH_HEAD,
  PUBLISH_INPUT,
  PUBLISH_TEXTAREA,
  PublishButton,
} from "@/components/editor/publish-button"
import { addCommunityItem } from "@/lib/community-store"
import { noteItemPublished } from "@/hooks/use-library-stats"
import { draftOrigin, removeDraft } from "@/lib/drafts"
import { VisibilitySwitch, type Visibility } from "@/components/editor/library-shell"
import { PublishSwitch, PublishSwitches } from "@/components/editor/publish-switch"
import { noteScenePublished, type GalleryScene } from "@/components/editor/scene-gallery"
import { buildZip, type BundleEntry } from "@/lib/bundle"
import { isSealedBundle, sealBundle, sealedName } from "@/lib/bundle-cipher"
import { MAX_BUNDLE_BYTES, type LibraryItem } from "@/lib/library"
import { formatBytes } from "@/lib/png-sequence"
import { posterToWebp } from "@/lib/poster"
import { sceneRefs, type SceneDoc } from "@/lib/scene"
import { useSession } from "@/lib/auth-client"
import type { UnpublishedUse } from "@/lib/refs"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { MAX_VIDEO_URL, parseVideoLink, VIDEO_PLATFORM_NAMES } from "@/lib/video-link"

const MAX_TAGS = 5
// Generous: an untouched Retina screenshot is routinely past 10MB.
const MAX_POSTER_BYTES = 20 * 1024 * 1024

// The written parts of a publish, kept until the scene is actually published.
//
// Taking the thumbnail means leaving this dialog — often the app entirely — and
// coming back to a blank form after composing a description and a credits list is
// the kind of small loss that stops people publishing at all. Per scene, so two
// scenes in two tabs don't overwrite each other's drafts.
type Draft = { description: string; tags: string[]; credits: string; video?: string; displayOnly?: boolean; visibility?: Visibility }

/** What a publish just said about the scene, handed back so the next publish in
 *  the same session starts from it rather than from a blank form. */
export type PublishedMeta = Draft & { displayOnly: boolean; poster: string | null }

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
      ...(typeof d.video === "string" ? { video: d.video } : {}),
      ...(typeof d.displayOnly === "boolean" ? { displayOnly: d.displayOnly } : {}),
      ...(d.visibility === "public" || d.visibility === "private" ? { visibility: d.visibility } : {}),
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
  /** The published scene this one REPLACES — set when the author opened their
   *  own scene to correct it. Publishing then updates that row in place. */
  updatesId?: string
  /** The cover that scene already has, shown in place of an empty frame. Kept
   *  unless a new one is picked, and never re-uploaded: the server keeps the
   *  poster it holds when a publish carries none. */
  updatesPoster?: string | null
  /** What that scene already says about itself, so an edit opens on the author's
   *  own words instead of asking them to write the blurb a second time. */
  updatesMeta?: Draft | null
  /** The id a publish landed on, so a second publish in the same session
   *  updates rather than making a third scene. */
  onPublished?: (id: string, meta: PublishedMeta) => void
  collect: () => Promise<ScenePublishSource>
  unpublished: (visibility: Visibility) => UnpublishedUse[]
  /** A look this scene wears was published from here under `newName`. */
  onLookPublished: (kind: UnpublishedUse["kind"], oldName: string, newName: string) => void
  /** Closes this dialog and opens the gallery — offered once the scene is up. */
  onGallery: () => void
}) {
  // Mounted only while open, so every publish starts from a clean form. Kept
  // mounted, the dialog reopened onto the previous publish's success screen —
  // with the previous scene's link.
  return (
    // Not modal: on a desktop it is a column beside the scene, worked beside
    // the console as export is, and only its own close or Escape ends it.
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onOpenChange(false)} modal={false}>
      {props.open && <ShareSceneForm {...props} />}
    </Dialog>
  )
}

function ShareSceneForm({
  sceneId,
  sceneName,
  onRename,
  forkedFromId,
  updatesId,
  updatesPoster,
  updatesMeta,
  onPublished,
  collect,
  unpublished,
  onLookPublished,
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
  /** The published scene this one REPLACES — set when the author opened their
   *  own scene to correct it. Publishing updates that row in place. */
  updatesId?: string
  /** The cover that scene already has — see the dialog's prop. */
  updatesPoster?: string | null
  /** What it already says about itself — see the dialog's prop. */
  updatesMeta?: Draft | null
  /** The id a publish landed on, so a second publish in the same session
   *  updates rather than making a third scene. */
  onPublished?: (id: string, meta: PublishedMeta) => void
  collect: () => Promise<ScenePublishSource>
  /** Looks this scene's readers could not resolve, under the visibility it is
   *  about to be published with. Publishing is blocked while this is non-empty
   *  — see lib/refs.ts for why. */
  unpublished: (visibility: Visibility) => UnpublishedUse[]
  onLookPublished: (kind: UnpublishedUse["kind"], oldName: string, newName: string) => void
  onGallery: () => void
}) {
  const t = useT()
  const { data: session } = useSession()
  // Lazily from storage: nothing is rendered until the dialog opens, so reading
  // client-only state here can't disagree with the server's markup.
  // An edit starts from what is published; a draft left mid-sentence outranks it
  // per field, because that is the writing this dialog exists to protect.
  const [draft] = useState(() => {
    const local = readDraft(sceneId)
    if (!updatesMeta) return local
    return {
      description: local.description || updatesMeta.description,
      tags: local.tags.length ? local.tags : updatesMeta.tags,
      credits: local.credits || updatesMeta.credits,
      video: local.video ?? updatesMeta.video,
      displayOnly: local.displayOnly ?? updatesMeta.displayOnly,
      ...(local.visibility ? { visibility: local.visibility } : {}),
    }
  })
  // Recomputed when the picker moves, NOT read once: a look that is fine for a
  // private scene can be exactly what a public one may not point at, so the
  // answer belongs to the visibility currently chosen. The scene itself is
  // frozen behind this dialog, so nothing else can move underneath it.
  const [description, setDescription] = useState(draft.description)
  const [tags, setTags] = useState<string[]>(draft.tags)
  const [credits, setCredits] = useState(draft.credits)
  const [video, setVideo] = useState(draft.video ?? "")
  // Checked as it is typed: a link to anywhere else is said so here, not
  // refused by the server after the bundle has uploaded.
  const videoLink = video.trim() ? parseVideoLink(video) : null
  const videoBad = video.trim() !== "" && !videoLink
  // Publishing a scene is a public act by default; the picker is where you say
  // otherwise, and private here means the link works for nobody but you.
  // Kept with the draft like the rest, so leaving for a screenshot does not
  // quietly turn a private scene back to public.
  const [visibility, setVisibility] = useState<Visibility>(draft.visibility ?? "public")
  const [displayOnly, setDisplayOnly] = useState(draft.displayOnly ?? false)
  // Bumped when a look is published from the list below, so the list asks again.
  const [looksPublished, setLooksPublished] = useState(0)
  const blocking = useMemo(
    () => unpublished(visibility),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- looksPublished is the recompute trigger
    [unpublished, visibility, looksPublished],
  )
  // Chosen by the author, not grabbed from the canvas: the frame that happens to
  // be showing at publish is rarely the one they would pick to represent the work.
  const [poster, setPoster] = useState<File | null>(null)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const takePoster = (f: File) => {
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
  }
  // The cover from what is on screen: publishing frames the scene at a
  // cover's 16:9, so the frame drawn now IS the cover, saved as WebP at
  // 1280×720. Read in a frame queued from a timer, so it runs after the
  // engine's render while the canvas still holds it.
  const capturePoster = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("main canvas")
    if (!canvas || !canvas.width) return
    window.setTimeout(() =>
      requestAnimationFrame(() => {
        const out = document.createElement("canvas")
        out.width = 1280
        out.height = 720
        const g = out.getContext("2d")
        if (!g) return
        // Cover-fit: fill 16:9 from the middle of whatever shape is drawn.
        const s = Math.max(out.width / canvas.width, out.height / canvas.height)
        const w = canvas.width * s
        const h = canvas.height * s
        g.drawImage(canvas, (out.width - w) / 2, (out.height - h) / 2, w, h)
        out.toBlob((blob) => blob && takePoster(new File([blob], "cover.webp", { type: "image/webp" })), "image/webp", 0.9)
      }),
    )
  }
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
    const draft: Draft = { description, tags, credits, video, displayOnly, ...(visibility === "private" ? { visibility } : {}) }
    const key = draftKey(sceneId)
    if (!description && !tags.length && !credits && !video && !displayOnly && visibility === "public") window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(draft))
  }, [sceneId, description, tags, credits, video, displayOnly, visibility, step])
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
      // Waits for the scene to finish loading: published mid-load, it had no stage.
      const { entries, makeDoc } = await collect()
      let bundle: string | null = null
      let bundleKey: string | null = null
      let bundleBytes = 0
      let posterKey: string | null = null
      if (entries.length > 0) {
        const zip = await buildZip(entries)
        if (zip.size > MAX_BUNDLE_BYTES) {
          setStep("idle")
          setError(t.share.bundleTooBig(formatBytes(zip.size), formatBytes(MAX_BUNDLE_BYTES)))
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
        // Sealed under the name the server picked (lib/bundle-cipher), so what
        // lands in storage is not a zip anyone can save and open. An older
        // server still hands out an assets.zip key; that goes up as it is.
        const sealed = isSealedBundle(key)
        const body = sealed ? await sealBundle(zip, sealedName(key)) : zip
        await putWithProgress(uploadUrl, body, sealed ? "application/octet-stream" : "application/zip", setProgress)
        bundle = publicUrl
        bundleKey = key
        bundleBytes = zip.size
      }
      if (poster) {
        // WebP, and no larger than a card or a share card can show — see
        // lib/poster.ts. The gallery is a grid of these and its weight is paid
        // by everyone who opens it, so the cover is compressed where it is
        // chosen rather than left as whatever the screenshot tool produced.
        const cover = await posterToWebp(poster)
        const presign = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sceneId: publishScope, size: cover.size, kind: "poster", contentType: cover.type }),
        })
        if (!presign.ok) throw new Error(await reason(presign))
        const { uploadUrl, key } = (await presign.json()) as { uploadUrl: string; key: string }
        await putWithProgress(uploadUrl, cover, cover.type, () => {})
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
          video: videoLink?.url ?? "",
          bundleKey,
          bundleBytes,
          posterKey,
          // Naming a scene you own replaces it: same short id, same counters.
          // Ignored by the server for anyone else's, which then publishes anew.
          ...(updatesId ? { id: updatesId } : {}),
          forkedFromId,
          // The published presets this scene pins — recorded as edges so "used in
          // N scenes" is a join rather than a scan through documents.
          uses: sceneRefs(doc),
          tags,
          visibility,
          // Only a public scene has strangers to withhold the editor from.
          displayOnly: visibility === "public" && displayOnly,
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
        video: videoLink?.url ?? "",
        tags: item.tags ?? [],
        likeCount: 0,
        poster: item.poster ?? null,
        createdAt: item.createdAt ?? new Date().toISOString(),
        displayOnly: visibility === "public" && displayOnly,
      })
      // Published — the draft has served its purpose.
      window.localStorage.removeItem(draftKey(sceneId))
      setRow(item)
      onPublished?.(item.id, {
        description: description.trim(),
        tags,
        credits: credits.trim(),
        video: videoLink?.url ?? "",
        displayOnly: visibility === "public" && displayOnly,
        poster: item.poster ?? null,
      })
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
      aria-describedby={undefined}
      paper="column"
      className={PUBLISH_DIALOG + " w-[34rem] sm:max-w-[34rem]"}
      closeClassName={PUBLISH_CLOSE}
    >
        <ShareHead title={updatesId ? t.share.updateScene : t.share.title} blurb={updatesId ? t.share.updateBlurb : null} busy={busy} />

        {step === "done" && shareUrl ? (
          <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto px-4 pt-4 pb-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 truncate rounded-interior border border-line-strong bg-white/5 px-2.5 py-1.5 font-mono text-xs">
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
              className="h-8 w-full border border-line-strong text-xs font-medium hover:bg-white/10"
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
            <Button size="sm" variant="ghost" className="h-8 w-full border border-line-strong text-xs font-medium hover:bg-white/10" onClick={onGallery}>
              <GalleryThumbnails className="size-3.5" />
              {t.gallery.door}
            </Button>
          </div>
        ) : (
          <form
            className={PUBLISH_FORM}
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
            <div data-publish-body className={cn(PUBLISH_BODY, "cover-enter")}>
            {/* Shown before the form rather than on submit: discovering a block after
                writing a description, choosing tags and picking a thumbnail is the
                worst moment to learn about it. */}
            {/* TWO blocks, because the two have different fixes: one asks you to
                publish something, the other to change what you already published
                — or to publish this scene privately instead. One list saying
                "publish these first" would be wrong advice for half of it. */}
            {(["missing", "private"] as const).map((reason) => {
                const rows = blocking.filter((u) => u.reason === reason)
                if (rows.length === 0) return null
                return (
                  <Notice key={reason} tone="warning">
                    <p className="text-xs font-medium">
                      {reason === "missing" ? t.share.unpublishedTitle : t.share.privateUseTitle}
                    </p>
                    <p className="mt-0.5 text-2xs leading-snug">
                      {reason === "missing" ? t.share.unpublishedBlurb : t.share.privateUseBlurb}
                    </p>
                    {/* One grid for every row: the kind column is as wide as its
                        longest label, so the names start on one line. */}
                    <ul className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-2xs">
                      {rows.map((u) => (
                        <li key={`${u.kind}:${u.name}`} className="col-span-3 grid min-h-5 grid-cols-subgrid items-center">
                          <span className="justify-self-start text-muted-foreground">{t.share.unpublishedKind[u.kind]}</span>
                          <span className="truncate font-mono">{u.name}</span>
                          {reason === "missing" && (
                            // The look's own publish form, right here. React carries
                            // its submit up through the portal, and this form's
                            // onSubmit publishes the scene — so it stops here.
                            <span className="flex shrink-0" onSubmit={(e) => e.stopPropagation()}>
                              <PublishButton
                                kind={u.kind}
                                defaultName={u.draft?.name ?? u.name}
                                defaultDescription={u.draft?.description}
                                defaultTags={u.draft?.tags}
                                payload={() => u.draft?.payload ?? u.payload}
                                itemId={u.draft ? (draftOrigin(u.kind, u.draft.id).sourceId ?? u.draft.id) : undefined}
                                forkedFromId={u.draft ? draftOrigin(u.kind, u.draft.id).forkedFromId : undefined}
                                className="h-5 border border-line-strong bg-transparent px-2 text-2xs font-normal text-foreground hover:bg-foreground/10 [&_svg]:hidden"
                                onPublished={(item) => {
                                  // The libraries' own promotion: the draft now lives on the server.
                                  addCommunityItem(item)
                                  noteItemPublished(item.id)
                                  if (u.draft) removeDraft(u.kind, u.draft.id)
                                  if (item.name !== u.name) onLookPublished(u.kind, u.name, item.name)
                                  setLooksPublished((n) => n + 1)
                                }}
                              />
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                )
              })}
            {/* Name and description beside the image, with the description
                stretching to meet its bottom edge — pinning two short fields to
                opposite ends left a hole in the middle instead. */}
            <div data-publish-split className="grid grid-cols-[1fr_15rem] items-stretch gap-3">
              <div className="flex min-w-0 flex-col gap-2.5">
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t.library.publishName}</span>
                  <Input
                    value={sceneName}
                    onChange={(e) => onRename(e.target.value)}
                    maxLength={60}
                    className={PUBLISH_INPUT}
                  />
                </label>
                <label className="flex min-h-0 flex-1 flex-col">
                  <span className="text-xs text-muted-foreground">{t.library.publishDescription}</span>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                    className={PUBLISH_TEXTAREA + " min-h-0 flex-1 [field-sizing:fixed]"}
                  />
                </label>
              </div>
              <label className="block">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t.share.thumbnail}</span>
                  <Button
                    type="button"
                    variant="bare"
                    onClick={(e) => {
                      e.preventDefault()
                      capturePoster()
                    }}
                    className="text-2xs text-muted-foreground hover:text-foreground"
                  >
                    {t.share.capturePreview}
                  </Button>
                </span>
                {updatesId && !poster && updatesPoster && (
                  <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">{t.share.coverKept}</span>
                )}
                <input
                  ref={posterInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (f) takePoster(f)
                  }}
                />
                {/* The preview IS the control — a separate button beside it was two
                    affordances for one action. */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => posterInputRef.current?.click()}
                  data-publish-thumb
                  className="mt-0.5 block h-auto aspect-video w-full cursor-pointer overflow-hidden rounded-interior border border-line-strong bg-white/5 p-0 font-normal transition-colors hover:border-white/25 hover:bg-white/10 dark:hover:bg-white/10"
                >
                  {(posterUrl ?? updatesPoster) ? (
                    // Any shape is fine: the card crops to fill, so authors aren't
                    // asked to produce a particular aspect ratio. Falling back to
                    // the cover the scene already has, so an author correcting a
                    // published scene sees it rather than an empty frame — and
                    // keeps it by simply not picking another.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={posterUrl ?? updatesPoster!} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImagePlus className="size-4" />
                      <span className="text-2xs">{t.share.thumbnailPick}</span>
                    </span>
                  )}
                </Button>
              </label>
            </div>
            <label className="block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t.library.publishTags}</span>
                {/* The cap, stated. Five was already enforced silently. */}
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {tags.length}/{MAX_TAGS}
                </span>
              </span>
              <TagsInput value={tags} onChange={setTags} max={MAX_TAGS} placeholder={t.library.publishTagsHint} />
            </label>
            {/* The maker's own render, wherever they posted it — optional, and
                only to the sites lib/video-link knows. */}
            <label className="block">
              {/* A fixed height: the note on the right is smaller type, and on a
                  baseline row its arrival grew the row by a pixel. */}
              <span className="flex h-4 items-center justify-between gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">{t.share.video}</span>
                {/* What it read as, or why not, on the label's own row as the
                    credits' note is — so a warning appearing moves nothing. */}
                {videoBad ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-2xs">
                    <Mark tone="error" />
                    <span className="truncate">{t.share.videoInvalid}</span>
                  </span>
                ) : (
                  videoLink && <span className="min-w-0 truncate text-2xs text-muted-foreground">{VIDEO_PLATFORM_NAMES[videoLink.platform]}</span>
                )}
              </span>
              <Input
                value={video}
                onChange={(e) => setVideo(e.target.value)}
                maxLength={MAX_VIDEO_URL * 2}
                placeholder={t.share.videoHint}
                inputMode="url"
                spellCheck={false}
                // The border turns red and nothing else: the input's own invalid
                // styling adds a ring, which made the field look as if it grew.
                className={cn(PUBLISH_INPUT, videoBad && "border-red-400/60 focus-visible:border-red-400/60 focus-visible:ring-red-400/20")}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.share.credits}</span>
              <Textarea
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                maxLength={4000}
                rows={3}
                placeholder={t.share.creditsHint}
                className={PUBLISH_TEXTAREA + " min-h-[4.5rem] max-h-48"}
              />
            </label>
            {/* Who sees it, then who may fork it — display only qualifies a PUBLIC
                scene, so it sits beside visibility and is inert while private. */}
            <PublishSwitches>
              <VisibilitySwitch value={visibility} onChange={setVisibility} />
              <PublishSwitch
                icon={Eye}
                label={t.share.displayOnly}
                checked={visibility === "public" && displayOnly}
                onCheckedChange={setDisplayOnly}
                disabled={visibility !== "public"}
              />
            </PublishSwitches>
            </div>
            <div data-publish-foot className={PUBLISH_FOOT}>
            {error && (
              <Notice tone="error" className="text-2xs leading-relaxed break-words select-text">
                {error}
              </Notice>
            )}
            <Button
              type="submit"
              disabled={
                !session ||
                busy ||
                blocking.length > 0 ||
                !sceneName.trim() ||
                videoBad ||
                !description.trim() ||
                tags.length === 0 ||
                !credits.trim() ||
                // An update keeps whatever cover the scene already has, so
                // re-publishing to fix a stage does not mean re-framing a shot.
                (!poster && !updatesId)
              }
              data-paper-solid
              className="h-9 w-full bg-blue-400 text-xs font-medium text-on-accent hover:bg-blue-400/90 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {stepLabel}
                </>
              ) : session ? (
                updatesId ? t.share.updateScene : t.gradeLibrary.publish
              ) : (
                t.share.signIn
              )}
            </Button>
            </div>
          </form>
        )}
    </DialogContent>
  )
}

/** The dialog's title row. Laid in the right-hand column (paper, so inside the
 *  cover) it is set as the export column's is: a mono line and a Close word,
 *  flush at the column's top. Elsewhere, the publish dialogs' own row. */
function ShareHead({ title, blurb, busy }: { title: string; blurb: string | null; busy: boolean }) {
  const t = useT()
  const cover = useCover()
  if (!cover)
    return (
      <div className={PUBLISH_HEAD}>
        <DialogTitle className="flex h-5 items-center gap-2 text-sm font-medium">
          <Globe className="size-4" />
          {title}
        </DialogTitle>
        {blurb && <p className="mt-1 text-xs leading-snug text-muted-foreground">{blurb}</p>}
      </div>
    )
  return (
    <div data-share-head className="shrink-0 px-4">
      <div className="flex h-5 items-center gap-4">
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{title}</DialogTitle>
        {!busy && (
          <DialogClose asChild>
            <Button variant="bare" aria-label={t.library.close} className="flex size-5 items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </Button>
          </DialogClose>
        )}
      </div>
      {blurb && <p className="mt-1 text-xs leading-snug text-muted-foreground">{blurb}</p>}
    </div>
  )
}
