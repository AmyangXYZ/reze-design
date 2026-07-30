"use client"

// Publishing a SCENE: zip the uploaded assets automatically, PUT them straight to
// R2 (Vercel never sees the bytes), then publish the document. The user fills a
// name and blurb — never re-uploads what the scene is already showing.

import { useState } from "react"
import { Check, Copy, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TagsInput } from "@/components/editor/tags-input"
import { buildZip, type BundleEntry } from "@/lib/bundle"
import type { LibraryItem } from "@/lib/library"
import { sceneRefs, type SceneDoc } from "@/lib/scene"
import { useSession } from "@/lib/auth-client"
import { useT } from "@/lib/i18n"

const MAX_TAGS = 8

export type ScenePublishSource = {
  /** Files to bundle — empty when the scene only uses site-served assets. */
  entries: BundleEntry[]
  /** The document, with asset paths already bundle-relative. */
  makeDoc: (bundle: string | null) => SceneDoc
}

type Step = "idle" | "packing" | "uploading" | "publishing" | "done"

export function ShareSceneDialog({
  open,
  onOpenChange,
  sceneId,
  sceneName,
  onRename,
  collect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The working scene's client-minted id — keys the R2 bundle, so republishing
   *  the same scene overwrites its own assets. */
  sceneId: string
  sceneName: string
  /** Renaming here renames the working scene too — one name, top-left included. */
  onRename: (name: string) => void
  collect: () => ScenePublishSource
}) {
  const t = useT()
  const { data: session } = useSession()
  const [name, setName] = useState(sceneName)
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [credits, setCredits] = useState("")
  const [step, setStep] = useState<Step>("idle")
  const [error, setError] = useState<string | null>(null)
  const [row, setRow] = useState<LibraryItem | null>(null)
  const [copied, setCopied] = useState(false)

  const busy = step !== "idle" && step !== "done"
  const shareUrl =
    row && session ? `https://reze.design/${session.user.username ?? "you"}/${row.id}` : null

  const publish = async () => {
    if (!session || busy) return
    setError(null)
    try {
      setStep("packing")
      const { entries, makeDoc } = collect()
      let bundle: string | null = null
      let bundleKey: string | null = null
      let bundleBytes = 0
      if (entries.length > 0) {
        const zip = await buildZip(entries)
        setStep("uploading")
        const presign = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sceneId, size: zip.size }),
        })
        if (!presign.ok) throw new Error(`presign ${presign.status}`)
        const { uploadUrl, key, publicUrl } = (await presign.json()) as {
          uploadUrl: string
          key: string
          publicUrl: string
        }
        const put = await fetch(uploadUrl, { method: "PUT", body: zip, headers: { "content-type": "application/zip" } })
        if (!put.ok) throw new Error(`upload ${put.status}`)
        bundle = publicUrl
        bundleKey = key
        bundleBytes = zip.size
      }
      setStep("publishing")
      const finalName = name.trim() || sceneName
      onRename(finalName)
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
      if (!res.ok) throw new Error(`publish ${res.status}`)
      const { item } = (await res.json()) as { item: LibraryItem }
      setRow(item)
      setStep("done")
    } catch {
      setStep("idle")
      setError(t.share.failed)
    }
  }

  const stepLabel =
    step === "packing" ? t.share.packing : step === "uploading" ? t.share.uploading : t.share.publishing

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-[26rem] border-white/10 bg-zinc-950/95 p-5 sm:max-w-[26rem]"
      >
        <DialogTitle className="flex items-center gap-2 text-sm font-medium">
          <Globe className="size-4 text-blue-400" />
          {t.share.title}
        </DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">{t.share.blurb}</DialogDescription>

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
            <p className="text-[11px] text-muted-foreground">{t.share.viewerSoon}</p>
          </div>
        ) : (
          <form
            className="mt-1 space-y-3"
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
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.library.publishName}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="mt-1 h-9 border-white/10 bg-white/5 text-sm md:text-sm"
              />
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
            <label className="block">
              <span className="text-xs text-muted-foreground">{t.share.credits}</span>
              <textarea
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder={t.share.creditsHint}
                className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-blue-400/50"
              />
              <span className="mt-1 block text-[11px] text-muted-foreground/70">{t.share.creditsWhy}</span>
            </label>
            {error && <div className="text-[11px] text-red-400">{error}</div>}
            <Button
              type="submit"
              disabled={!session || busy || !name.trim() || !description.trim() || tags.length === 0 || !credits.trim()}
              className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300 disabled:opacity-50"
            >
              {busy ? stepLabel : session ? t.gradeLibrary.publish : t.share.signIn}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
