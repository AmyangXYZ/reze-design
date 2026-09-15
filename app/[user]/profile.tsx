"use client"

// The page itself: who, the work they lead with, then everything.
//
// A creator's channel the way film catalogues present one: the identity first,
// the pinned (or most-watched) scene as a wide banner, and the rest as a calm,
// borderless wall of pictures behind tabs — scenes first, the presets that made
// them after. Two text sizes: lg for the two headings, sm for everything else.
//
// The page is the same for every visitor, so managing it happens in the browser:
// the author's own session turns on a right-click menu on their scenes.

import { useMemo, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Eye, Heart, Pin, PinOff, Play, Trash2, WandSparkles } from "lucide-react"
import type { ShaderGraph } from "reze-engine"
import type { GradeSpec } from "@/lib/grade"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EffectPreview } from "@/components/editor/effect-preview"
import { GradePreview } from "@/components/editor/grade-preview"
import { GraphMinimap } from "@/components/editor/graph-minimap"
import { tagSwatch } from "@/components/editor/library-rail"
import { useReport } from "@/hooks/use-report"
import { useSession } from "@/lib/auth-client"
import { useI18n, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Published = { id: string; name: string; description: string; likeCount: number; createdAt: string }

export type ProfileScene = Published & { viewCount: number; poster: string | null; pinned: boolean }
export type ProfileEffect = Published & { wgsl: string }
export type ProfileGraph = Published & { graph: ShaderGraph }
export type ProfileGrade = Published & { spec: GradeSpec }

/** Three across a laptop, four from 1280px, five on the widest screens — near
 *  300px a card, big enough to read a poster, small enough to see the body of work. */
const SCENE_GRID = "grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"

/** Presets, smaller and more of them. */
const PRESET_GRID = "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"

/** Initials for an account with no picture, latin or CJK. */
const initials = (n: string) => (n.match(/[a-zA-Z0-9一-鿿]/g) ?? []).slice(0, 2).join("").toUpperCase()

type TabKey = "scenes" | "effects" | "graphs" | "grades"

/** What the author can do to one of their scenes from this page. */
type Manage = { pin: (scene: ProfileScene, on: boolean) => void; remove: (scene: ProfileScene) => void } | null

export function Profile({
  handle,
  image,
  joined,
  scenes: initialScenes,
  effects,
  graphs,
  grades,
}: {
  handle: string
  image: string | null
  joined: string
  scenes: ProfileScene[]
  effects: ProfileEffect[]
  graphs: ProfileGraph[]
  grades: ProfileGrade[]
}) {
  const t = useT()
  const report = useReport()
  const { data: session } = useSession()
  // Held here so a pin or a delete shows at once, before the cached page refreshes.
  const [scenes, setScenes] = useState(initialScenes)
  const [confirming, setConfirming] = useState<ProfileScene | null>(null)

  const views = scenes.reduce((n, s) => n + s.viewCount, 0)
  const likes = [...scenes, ...effects, ...graphs, ...grades].reduce((n, item) => n + item.likeCount, 0)

  // The banner: the scene the author pinned, else the one watched most among
  // those with a picture to show.
  const hero = useMemo(
    () =>
      scenes.find((s) => s.pinned) ??
      scenes.reduce<ProfileScene | null>((best, s) => (s.poster && (!best || s.viewCount > best.viewCount) ? s : best), null),
    [scenes],
  )
  // The wall repeats nothing the banner already shows — unless the banner is all there is.
  const wall = hero && scenes.length > 1 ? scenes.filter((s) => s.id !== hero.id) : scenes

  const manage: Manage =
    session?.user.username === handle
      ? {
          pin: (scene, on) =>
            void report(
              fetch(`/api/library/${scene.id}`, { method: "PATCH", body: JSON.stringify({ featured: on }) }),
              on ? t.profile.pinDone : t.profile.unpinDone,
            ).then((ok) => {
              if (ok) setScenes((prev) => prev.map((s) => ({ ...s, pinned: on && s.id === scene.id })))
            }),
          remove: setConfirming,
        }
      : null

  const confirmRemove = () => {
    const scene = confirming
    setConfirming(null)
    if (!scene) return
    void report(fetch(`/api/library/${scene.id}`, { method: "DELETE" }), t.library.deleted).then((ok) => {
      if (ok) setScenes((prev) => prev.filter((s) => s.id !== scene.id))
    })
  }

  const tabs = (
    [
      { key: "scenes", title: t.profile.scenesTitle, count: scenes.length },
      { key: "effects", title: t.profile.effectsTitle, count: effects.length },
      { key: "graphs", title: t.profile.graphsTitle, count: graphs.length },
      { key: "grades", title: t.profile.gradesTitle, count: grades.length },
    ] satisfies { key: TabKey; title: string; count: number }[]
  ).filter((tab) => tab.count > 0)
  const [tab, setTab] = useState<string>(tabs[0]?.key ?? "scenes")
  const tabsRef = useRef<HTMLDivElement>(null)
  // Past the tab bar, a switch returns the page to where the bar pins, so the new
  // shelf starts right under it instead of wherever the old one left the scroll.
  const switchTab = (next: string) => {
    const el = tabsRef.current
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY
      if (window.scrollY > top) window.scrollTo({ top })
    }
    setTab(next)
  }

  return (
    <main className="min-h-dvh bg-zinc-950">
      {/* The editor's brand pill at the editor's own origin, top-3/left-3, so the
          mark sits on the same pixels on every page it appears on. */}
      <div className="px-3 pt-3">
        <Link href="/" className="group flex h-10 w-fit items-center gap-1.5 rounded-xl border border-transparent pr-1.5 pl-2">
          <span className="flex size-7 items-center justify-center text-pink-400" aria-hidden>
            <WandSparkles className="size-4.5" />
          </span>
          <span className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground transition-colors group-hover:text-white">
            Reze Design
          </span>
        </Link>
      </div>

      <div className="px-5 pb-32 sm:px-10 sm:pb-40 lg:px-20 xl:px-28 2xl:px-40">
        <header className="flex items-center gap-4 pt-6 pb-8 sm:pt-10 sm:pb-10">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-14 shrink-0 rounded-full object-cover sm:size-16" />
          ) : (
            <span
              className={cn(
                "flex size-14 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold sm:size-16",
                tagSwatch(handle),
              )}
            >
              {initials(handle)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">@{handle}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
              <span>{t.profile.scenes(scenes.length)}</span>
              <span aria-hidden>·</span>
              <span>{t.profile.views(views)}</span>
              <span aria-hidden>·</span>
              <span>{t.profile.likes(likes)}</span>
              <span aria-hidden>·</span>
              <span>{t.profile.joined(joined.slice(0, 7))}</span>
            </p>
          </div>
        </header>

        {hero && (
          <Managed scene={hero} manage={manage}>
            <Hero handle={handle} scene={hero} />
          </Managed>
        )}

        {tabs.length === 0 ? (
          <p className="border-t border-line py-10 text-sm text-muted-foreground">{t.profile.empty}</p>
        ) : (
          <Tabs ref={tabsRef} value={tab} onValueChange={switchTab} className="mt-10">
            {/* Sticky, so the other shelves stay in reach down a long wall. Only
                the open tab is mounted, so effects run only while they are shown. */}
            <div className="sticky top-0 z-10 border-b border-line bg-zinc-950">
              <TabsList className="h-auto gap-6 rounded-none bg-transparent p-0">
                {tabs.map((x) => (
                  <TabsTrigger
                    key={x.key}
                    value={x.key}
                    className={cn(
                      "relative h-11 rounded-none bg-transparent px-0 text-sm hover:text-foreground",
                      "data-[state=active]:bg-transparent data-[state=active]:text-foreground",
                      "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent data-[state=active]:after:bg-foreground",
                    )}
                  >
                    {x.title}
                    <span className="ml-1.5 text-sm text-muted-foreground tabular-nums">{x.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* At least a screen tall whichever shelf is open, so a short one never
                pulls the page up under the pointer. */}
            <div className="min-h-dvh">
              <TabsContent value="scenes" className="pt-8">
                <div className={SCENE_GRID}>
                  {wall.map((scene) => (
                    <Managed key={scene.id} scene={scene} manage={manage}>
                      <SceneCard handle={handle} scene={scene} />
                    </Managed>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="effects" className="pt-8">
                <div className={PRESET_GRID}>
                  {effects.map((effect) => (
                    <PresetCard key={effect.id} item={effect}>
                      <EffectPreview wgsl={effect.wgsl} />
                    </PresetCard>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="graphs" className="pt-8">
                <div className={PRESET_GRID}>
                  {graphs.map((graph) => (
                    <PresetCard key={graph.id} item={graph}>
                      <GraphMinimap graph={graph.graph} />
                    </PresetCard>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="grades" className="pt-8">
                <div className={PRESET_GRID}>
                  {grades.map((grade) => (
                    <PresetCard key={grade.id} item={grade}>
                      <GradePreview spec={grade.spec} />
                    </PresetCard>
                  ))}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t.gallery.deleteTitle}
        body={confirming ? `${confirming.name} — ${t.gallery.deleteConfirm}` : undefined}
        confirmLabel={t.library.deleteConfirmLabel}
        cancelLabel={t.library.cancel}
        onConfirm={confirmRemove}
      />
    </main>
  )
}

/** The author's right-click menu on one of their scenes; for anyone else, the
 *  browser's own. */
function Managed({ scene, manage, children }: { scene: ProfileScene; manage: Manage; children: React.ReactElement }) {
  const t = useT()
  if (!manage) return children
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onSelect={() => manage.pin(scene, !scene.pinned)}>
          {scene.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {scene.pinned ? t.profile.unpin : t.profile.pin}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="danger" onSelect={() => manage.remove(scene)}>
          <Trash2 className="size-3.5" />
          {t.library.deleteConfirmLabel}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** True once the page runs in a browser; false while it renders on the server.
 *  What a server cannot know — the visitor's clock and timezone — waits for it. */
const noSubscription = () => () => {}
const useInBrowser = () => useSyncExternalStore(noSubscription, () => true, () => false)

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
]

function relative(iso: string, locale: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(0, "minute")
}

/** When something was published: "3 days ago", with the full local date and time
 *  on hover. The server renders the date alone. */
function When({ iso, className }: { iso: string; className?: string }) {
  const { locale } = useI18n()
  const inBrowser = useInBrowser()
  return (
    <time
      dateTime={iso}
      title={inBrowser ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : undefined}
      className={className}
    >
      {inBrowser ? relative(iso, locale) : iso.slice(0, 10)}
    </time>
  )
}

/** The pinned or most-watched scene, wide, with its title on the picture and a way in. */
function Hero({ handle, scene, ...rest }: { handle: string; scene: ProfileScene } & React.HTMLAttributes<HTMLAnchorElement>) {
  const t = useT()
  return (
    <Link
      {...rest}
      href={`/${handle}/${scene.id}`}
      prefetch={false}
      className="group relative block aspect-video overflow-hidden rounded-surface bg-zinc-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:aspect-[21/9]"
    >
      {scene.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={scene.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground" aria-hidden>
          <WandSparkles className="size-6" />
        </span>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-white/70">
            {scene.pinned && <Pin className="size-3.5" />}
            {scene.pinned ? t.profile.pinned : t.profile.mostViewed}
          </div>
          <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-white">{scene.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/75 tabular-nums">
            <span className="flex items-center gap-1.5">
              <Eye className="size-4" />
              {scene.viewCount}
            </span>
            <span className="flex items-center gap-1.5">
              <Heart className="size-4" />
              {scene.likeCount}
            </span>
            <When iso={scene.createdAt} />
          </div>
        </div>
        <span className="flex h-9 w-fit shrink-0 items-center gap-2 rounded-interior bg-white px-4 text-sm font-semibold text-zinc-950 transition-colors group-hover:bg-white/90">
          <Play className="size-4 fill-current" />
          {t.profile.watch}
        </span>
      </div>
    </Link>
  )
}

/**
 * A scene on the wall: the picture unframed, the title and when beneath it, and
 * how it has been received over the picture on hover — always shown where
 * nothing can hover.
 */
function SceneCard({ handle, scene, ...rest }: { handle: string; scene: ProfileScene } & React.HTMLAttributes<HTMLAnchorElement>) {
  return (
    <Link
      {...rest}
      href={`/${handle}/${scene.id}`}
      // A wall of cards would otherwise prefetch every scene page in view, and
      // each of those reads the database.
      prefetch={false}
      className="group block outline-none"
    >
      <div className="relative aspect-video overflow-hidden rounded-surface bg-zinc-900 group-focus-visible:ring-2 group-focus-visible:ring-blue-400">
        {scene.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground" aria-hidden>
            <WandSparkles className="size-5" />
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pt-10 pb-2.5 text-sm text-white tabular-nums opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <span className="flex items-center gap-1">
            <Eye className="size-3.5" />
            {scene.viewCount}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="size-3.5" />
            {scene.likeCount}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-medium text-foreground">{scene.name}</div>
        <When iso={scene.createdAt} className="shrink-0 text-sm text-muted-foreground tabular-nums" />
      </div>
    </Link>
  )
}

/** A preset the same way, smaller: its live picture, then its name and likes. */
function PresetCard({ item, children }: { item: Published; children: React.ReactNode }) {
  return (
    <div title={item.description || undefined}>
      <div className="relative aspect-[16/10] overflow-hidden rounded-surface bg-zinc-900">{children}</div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-sm text-foreground">{item.name}</div>
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground tabular-nums">
          <Heart className="size-3.5" />
          {item.likeCount}
        </span>
      </div>
    </div>
  )
}
