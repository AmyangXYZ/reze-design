"use client"

// Published scenes, in the same shell as every other library: rail on the left,
// grid in the middle, details on the right. Browsing scenes is the same act as
// browsing grades, so it should not look like a different product.
//
// Opening one IS a navigation, though — a scene is a whole document, and the
// address bar should say which one you are looking at.

import { Fragment, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GalleryThumbnails, Heart, Loader2, Search, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LIBRARY_SHELL, LibraryTags, RailRow, RailSection, RailTags } from "@/components/editor/library-rail"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useSession } from "@/lib/auth-client"
import { useZOrder } from "@/hooks/use-z-order"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type GalleryScene = {
  id: string
  name: string
  author: string
  description: string
  credits: string
  tags: string[]
  likeCount: number
  viewCount: number
  poster: string | null
  createdAt: string
}

/** How the gallery is being browsed: three orderings of everything, then two
 *  narrowings. One axis, because to a reader they are the same question. */
const VIEWS = ["hot", "new", "top", "yours", "liked"] as const
type View = (typeof VIEWS)[number]
type Page = { scenes: GalleryScene[]; nextCursor: number | null }

const isFacet = (v: View) => v === "yours" || v === "liked"

// Session-lived, in memory only, and never emptied.
//
// One rule holds everywhere below: whatever we already know paints immediately,
// and any fresh request lands underneath it. Clearing the cache on publish or
// delete broke that — the next open had nothing to paint and put a spinner over
// an empty grid — so those events patch the cached lists instead, and the quiet
// refresh that follows every open reconciles them with the server.
const pages = new Map<View, Page>()

// Requests in flight, keyed by view. A gallery opened while the boot-time
// prefetch is still out joins that request rather than firing a second one and
// waiting behind its own spinner — the window where that happens is exactly the
// first few seconds, which is when someone is most likely to go looking.
const inflight = new Map<View, Promise<Page>>()

// Open galleries repaint when the cache is patched from elsewhere — the same
// relay the community libraries use.
const listeners = new Set<() => void>()
const announce = () => {
  for (const l of listeners) l()
}

/** Tag counts over the whole gallery — independent of how the list in front of
 *  you is narrowed. */
let tagCounts: [string, number][] | null = null
let tagsInflight: Promise<[string, number][]> | null = null

async function firstPage(v: View): Promise<Page> {
  const params = new URLSearchParams({ kind: "scene", sort: isFacet(v) ? "new" : v })
  // Only a narrowing needs a session; the three orderings stay one public query.
  if (isFacet(v)) params.set("facet", v)
  const res = await fetch(`/api/library?${params}`)
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as Page
}

/** Fresh window on top, anything already paged past kept below it and deduped:
 *  a row that slipped out of the top window keeps its place in the list instead
 *  of disappearing from under the reader mid-scroll. */
function merge(old: Page | undefined, fresh: Page): Page {
  if (!old) return fresh
  const seen = new Set(fresh.scenes.map((s) => s.id))
  return {
    scenes: [...fresh.scenes, ...old.scenes.filter((s) => !seen.has(s.id))],
    // Keep the deeper cursor once the reader has paged past the first window.
    nextCursor: old.scenes.length > fresh.scenes.length ? old.nextCursor : fresh.nextCursor,
  }
}

/** The first page of a view, merged into what we already had. Shared with anyone
 *  already waiting on the same view. */
function loadPage(v: View): Promise<Page> {
  const held = inflight.get(v)
  if (held) return held
  const req = firstPage(v)
    .then((fresh) => {
      const merged = merge(pages.get(v), fresh)
      pages.set(v, merged)
      inflight.delete(v)
      return merged
    })
    .catch((e: unknown) => {
      inflight.delete(v)
      throw e
    })
  inflight.set(v, req)
  return req
}

function loadTags(): Promise<[string, number][]> {
  tagsInflight ??= fetch("/api/library?kind=scene&counts=tags")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d: { tags: { tag: string; n: number }[] }) => {
      tagCounts = d.tags.map((x) => [x.tag, x.n] as [string, number])
      tagsInflight = null
      return tagCounts
    })
    .catch((e: unknown) => {
      tagsInflight = null
      throw e
    })
  return tagsInflight
}

/** Warm the default view and the tag cloud while the page is idle, so opening the
 *  gallery is a render rather than a wait. */
export function prefetchGallery(): void {
  if (!pages.has("hot")) void loadPage("hot").catch(() => {})
  if (!tagCounts) void loadTags().catch(() => {})
}

/** Your scene, in the lists it belongs to, without waiting for a round trip. */
export function noteScenePublished(scene: GalleryScene): void {
  for (const [v, page] of pages) {
    // "liked" is what you liked, and publishing isn't liking.
    if (v === "liked") continue
    pages.set(v, { ...page, scenes: [scene, ...page.scenes.filter((s) => s.id !== scene.id)] })
  }
  // Its tags moved the cloud.
  void loadTags().catch(() => {})
  announce()
}

export function noteSceneRemoved(id: string): void {
  for (const [v, page] of pages) pages.set(v, { ...page, scenes: page.scenes.filter((s) => s.id !== id) })
  void loadTags().catch(() => {})
  announce()
}

export function noteSceneRenamed(id: string, name: string): void {
  for (const [v, page] of pages) {
    pages.set(v, { ...page, scenes: page.scenes.map((s) => (s.id === id ? { ...s, name } : s)) })
  }
  announce()
}

export function SceneGallery({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {open && <GalleryContent onOpenChange={onOpenChange} />}
    </Dialog>
  )
}

function GalleryContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const router = useRouter()
  const { data: session } = useSession()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { z, onPointerDownCapture, onFocusCapture } = useZOrder(undefined, () => onOpenChange(false))
  const [view, setView] = useState<View>("hot")
  const [tag, setTag] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [scenes, setScenes] = useState<GalleryScene[]>(() => pages.get("hot")?.scenes ?? [])
  const [cursor, setCursor] = useState<number | null>(() => pages.get("hot")?.nextCursor ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tags, setTags] = useState<[string, number][]>(() => tagCounts ?? [])
  const [loading, setLoading] = useState(() => !pages.has("hot"))
  const [failed, setFailed] = useState(false)

  // Cached rows paint immediately and the refresh lands underneath them, so
  // reopening the gallery or changing how you browse is never a blank wait.
  useEffect(() => {
    let stale = false
    loadPage(view)
      .then((page) => {
        if (stale) return
        setScenes(page.scenes)
        setCursor(page.nextCursor)
        setSelectedId((prev) => prev ?? page.scenes[0]?.id ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (stale) return
        // Only an empty grid is a failure; stale rows are better than an apology.
        setFailed(!pages.has(view))
        setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [view])

  // Repaint when something patches the cache underneath an open gallery.
  useEffect(() => {
    const relay = () => {
      const page = pages.get(view)
      if (page) setScenes(page.scenes)
    }
    listeners.add(relay)
    return () => {
      listeners.delete(relay)
    }
  }, [view])

  useEffect(() => {
    if (tagCounts) return
    let stale = false
    loadTags()
      .then((counts) => !stale && setTags(counts))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  const loadMore = () => {
    if (!cursor) return
    setLoading(true)
    const params = new URLSearchParams({ kind: "scene", sort: isFacet(view) ? "new" : view, before: String(cursor) })
    if (isFacet(view)) params.set("facet", view)
    fetch(`/api/library?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((page: Page) => {
        // Into the cache as well as the view: pages read once shouldn't be re-read
        // the next time the gallery opens.
        const held = pages.get(view)
        const next = { scenes: [...(held?.scenes ?? []), ...page.scenes], nextCursor: page.nextCursor }
        pages.set(view, next)
        setScenes(next.scenes)
        setCursor(page.nextCursor)
        setLoading(false)
      })
      .catch(() => {
        setFailed(true)
        setLoading(false)
      })
  }

  const q = query.trim().toLowerCase()
  const rows = scenes.filter(
    (s) =>
      (!tag || s.tags.includes(tag)) &&
      (!q ||
        s.name.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q) ||
        s.tags.some((x) => x.includes(q))),
  )
  const selected = rows.find((s) => s.id === selectedId) ?? rows[0] ?? null

  const sceneHref = (s: GalleryScene) => `/${s.author}/${s.id}`

  const openScene = (s: GalleryScene) => {
    // Client-side, in this tab. A second tab would mean a second live WebGPU
    // device and a second copy of the models in VRAM — and since the viewer's
    // "open in editor" navigates as well, browsing that way stacks up editors.
    // The route is prefetched on select, so this is usually a paint.
    router.push(sceneHref(s))
  }

  // Ownership without an extra round trip: `author` is the handle, denormalised on
  // the row and kept in step by renames, so comparing it to yours is enough.
  const isMine = (s: GalleryScene) => !!session?.user.username && s.author === session.user.username

  const commitRename = (s: GalleryScene, raw: string) => {
    setRenamingId(null)
    const name = raw.trim()
    if (!name || name === s.name) return
    void fetch(`/api/library/${s.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((res) => {
      if (!res.ok) return
      setScenes((prev) => prev.map((x) => (x.id === s.id ? { ...x, name } : x)))
      // The short id is the link, so a rename never breaks one — only the label
      // the cached lists are still holding.
      noteSceneRenamed(s.id, name)
    })
  }

  const remove = (s: GalleryScene) => {
    if (!confirm(t.gallery.deleteConfirm)) return
    void fetch(`/api/library/${s.id}`, { method: "DELETE" }).then((res) => {
      if (!res.ok) return
      setScenes((prev) => prev.filter((x) => x.id !== s.id))
      noteSceneRemoved(s.id)
    })
  }

  const stamp = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })

  return (
    <DialogContent
      showCloseButton={false}
      overlay={false}
      onInteractOutside={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => e.preventDefault()}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onPointerDownCapture={onPointerDownCapture}
      onFocusCapture={onFocusCapture}
      style={{ zIndex: z }}
      className={LIBRARY_SHELL}
    >
      <DialogHeader className="flex-row items-center gap-2 space-y-0 border-b border-white/10 px-3 py-2">
        <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <GalleryThumbnails className="size-4 text-blue-400" />
          {t.gallery.title}
        </DialogTitle>
        <div className="relative ml-auto w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.library.searchPlaceholder}
            className="h-7 border-white/10 bg-white/5 pl-8 text-xs"
          />
        </div>
        <DialogClose className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">{t.library.close}</span>
        </DialogClose>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        {/* Rail: how to order, then what to order by. */}
        <div className="hidden w-50 shrink-0 flex-col border-r border-white/10 p-2 md:flex">
          {/* One section, like every other library: ordering the whole gallery and
              narrowing it to your own are both ways of browsing it. */}
          <RailSection title={t.rail.browse}>
            <div className="flex flex-col gap-0.5">
              {VIEWS.map((v) => (
                <RailRow
                  key={v}
                  label={v === "yours" || v === "liked" ? t.rail[v] : t.gallery[v]}
                  active={view === v}
                  onClick={() => {
                    if (v === view) return
                    // Cached view swaps instantly; an unseen one shows the spinner
                    // rather than the previous view's scenes under a new label.
                    const cached = pages.get(v)
                    setScenes(cached?.scenes ?? [])
                    setCursor(cached?.nextCursor ?? null)
                    setLoading(!cached)
                    setFailed(false)
                    setView(v)
                  }}
                />
              ))}
            </div>
          </RailSection>
          <RailTags counts={tags} tag={tag} onTagChange={setTag} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] content-start gap-2.5 p-3">
              {rows.map((s) => {
                const card = (
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setSelectedId(s.id)
                    }
                  }}
                  onClick={() => {
                    setSelectedId(s.id)
                    // Warms the RSC payload so opening is a paint, not a fetch.
                    router.prefetch(sceneHref(s))
                  }}
                  onDoubleClick={() => openScene(s)}
                  className={cn(
                    "cursor-pointer overflow-hidden rounded-md border text-left transition-colors",
                    s.id === selected?.id
                      ? "border-blue-400 ring-1 ring-blue-400"
                      : "border-white/10 hover:border-white/25",
                  )}
                >
                  <div className="aspect-[16/10] border-b border-white/5 bg-zinc-900">
                    {s.poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground/40">
                        {t.gallery.noPoster}
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {renamingId === s.id ? (
                        <Input
                          autoFocus
                          defaultValue={s.name}
                          className="h-5 min-w-0 flex-1 border-white/10 bg-white/5 px-1 text-xs md:text-xs"
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => commitRename(s, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                            if (e.key === "Escape") setRenamingId(null)
                          }}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.name}</span>
                      )}
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
                        <Heart className="size-3" />
                        {s.likeCount}
                      </span>
                    </div>
                  </div>
                </div>
                )
                if (!isMine(s)) return <Fragment key={s.id}>{card}</Fragment>
                return (
                  <ContextMenu key={s.id}>
                    <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
                    <ContextMenuContent className="w-40">
                      <ContextMenuItem onSelect={() => openScene(s)}>{t.gallery.open}</ContextMenuItem>
                      <ContextMenuItem onSelect={() => setRenamingId(s.id)}>{t.graph.rename}</ContextMenuItem>
                      <ContextMenuItem variant="danger" onSelect={() => remove(s)}>
                        {t.library.deletePublished}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}

              {loading && (
                <div className="col-span-full flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t.gallery.loading}
                </div>
              )}
              {!loading && failed && (
                <div className="col-span-full py-12 text-center text-xs text-red-400">{t.gallery.failed}</div>
              )}
              {!loading && !failed && rows.length === 0 && (
                <div className="col-span-full py-16 text-center text-xs text-muted-foreground">{t.gallery.empty}</div>
              )}
              {!loading && cursor && (
                <button
                  onClick={loadMore}
                  className="col-span-full cursor-pointer py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t.gallery.more}
                </button>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[20rem]">
          {selected ? (
            <>
              <div className="p-3 pb-0">
                <button
                  type="button"
                  onClick={() => openScene(selected)}
                  className="block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-md border border-white/10 bg-zinc-900"
                >
                  {selected.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.poster} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[11px] text-muted-foreground/40">
                      {t.gallery.noPoster}
                    </span>
                  )}
                </button>
              </div>
              <div className="min-h-0 p-3">
                <div className="truncate text-sm font-semibold">{selected.name}</div>
                <div className="mt-0.5 font-mono text-[13px] text-muted-foreground/70">
                  {selected.author} · {stamp(selected.createdAt)}
                </div>
                {selected.description && (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <LibraryTags tags={selected.tags} />
                {/* Who made the model, the motion and the music — the thing the
                    community actually asks to see before anyone reuses anything. */}
                {selected.credits && (
                  <div className="mt-3 border-t border-white/10 pt-2.5">
                    <div className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground/60 uppercase">
                      {t.share.credits}
                    </div>
                    <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                      {selected.credits}
                    </p>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-3 font-mono text-[11px] text-muted-foreground/70">
                  <span className="flex items-center gap-1">
                    <Heart className="size-3" />
                    {selected.likeCount}
                  </span>
                  <span>{t.gallery.views(selected.viewCount)}</span>
                </div>
              </div>
              <div className="mt-auto shrink-0 border-t border-white/10 p-3">
                <Button
                  asChild
                  size="sm"
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
                >
                  {/* A real link: plain click navigates in this tab, cmd-click
                      still gets a new one for anyone who wants it. */}
                  <Link href={sceneHref(selected)}>{t.gallery.open}</Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
              {t.gallery.empty}
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  )
}
