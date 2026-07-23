"use client"

// Editor chrome pieces. RailLogo is the app-level home/menu button at the TOP of
// the left rail (Figma's logo slot) — higher-level ops live here (nav, and later
// account/new-scene). BrandPill is the panel header: "Reze Design" + scene name +
// the dock toggle; as the expanded dock header the logo is omitted (the rail owns
// it) and it gets extra top padding, keeping the logo only as the floating pill.
// TopRightCluster is the right header: portfolio (account) + a blue text Share.

import Link from "next/link"
import { CircleUserRound, PanelLeft, PanelLeftClose, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { GithubMark } from "@/components/icons"
import { NAV_LINKS } from "@/components/site-nav"
import { cn } from "@/lib/utils"

const floating = "rounded-lg border border-white/10 bg-zinc-950/70 shadow-float backdrop-blur-md"

/** App menu: nav + higher-level ops (placeholder). Reused by RailLogo and the
 *  floating brand pill so the two never drift. */
function AppMenu({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-48 rounded-xl border-white/10 bg-zinc-950/90 p-1 shadow-float backdrop-blur-md"
      >
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="block rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-white/5 hover:text-foreground"
          >
            {l.label}
          </Link>
        ))}
        <Separator className="my-1 bg-white/10" />
        <a
          href="https://github.com/AmyangXYZ/reze-design"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <GithubMark className="size-3.5" />
          GitHub
        </a>
      </PopoverContent>
    </Popover>
  )
}

/** Top of the left rail — the logo/home button for app-level operations. */
export function RailLogo() {
  return (
    <AppMenu>
      <Button variant="ghost" size="icon" className="mt-1.5 rounded-lg text-pink-400 hover:bg-white/5" aria-label="Menu">
        <WandSparkles className="size-4.5" />
      </Button>
    </AppMenu>
  )
}

export function BrandPill({
  sceneName,
  docksOpen,
  onToggleDocks,
  asHeader = false,
}: {
  sceneName: string
  docksOpen: boolean
  onToggleDocks: () => void
  /** Render flat & full-width as a dock header (expanded, logo lives in the rail),
   *  vs a floating pill with its own logo menu (collapsed). */
  asHeader?: boolean
}) {
  const toggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0 rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground", asHeader ? "ml-auto" : "ml-1")}
          onClick={onToggleDocks}
        >
          {docksOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{docksOpen ? "Hide panels" : "Show panels"}</TooltipContent>
    </Tooltip>
  )

  // Expanded header: title over scene name (two lines). Collapsed pill: one line.
  if (asHeader) {
    return (
      <div className="flex w-full items-center gap-2 px-3 py-2.5 pt-5.5">
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
          <span className="truncate text-xs text-muted-foreground ">{sceneName}</span>
        </div>
        {toggle}
      </div>
    )
  }
  return (
    <div className={cn("flex items-center gap-1.5", floating, "py-1.5 pr-1.5 pl-2")}>
      <AppMenu>
        <Button variant="ghost" size="icon" className="size-7 rounded-lg text-pink-400 hover:bg-white/5" aria-label="Menu">
          <WandSparkles className="size-4.5" />
        </Button>
      </AppMenu>
      <span className="whitespace-nowrap pb-0.5 text-sm font-semibold tracking-tight text-foreground">Reze Design</span>
      <span className="ml-1.5 max-w-28 truncate text-xs text-muted-foreground">{sceneName}</span>
      {toggle}
    </div>
  )
}

export function TopRightCluster({
  shareName,
  asHeader = false,
}: {
  /** The scene's future permanent path (/[user]/[scene]) — shown in the Share popover. */
  shareName: string
  asHeader?: boolean
}) {
  const accountBtn = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("rounded-md hover:bg-white/5 hover:text-foreground", asHeader ? "size-8" : "size-7")}
          aria-label="Account"
        >
          <CircleUserRound className={asHeader ? "size-5" : "size-4"} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={asHeader ? "start" : "end"}
        sideOffset={6}
        className="w-52 rounded-xl border-white/10 bg-zinc-950/90 p-3 text-center shadow-float backdrop-blur-md"
      >
        <CircleUserRound className="mx-auto size-8 text-muted-foreground"/>
        <div className="mt-2 text-xs">Accounts are coming soon.</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Save scenes and get a permanent URL.</div>
        <Button size="sm" disabled className="mt-3 h-7 w-full bg-white/10 text-xs hover:bg-white/15">
          Sign in
        </Button>
      </PopoverContent>
    </Popover>
  )

  const shareBtn = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          className="h-7 rounded-md bg-blue-400 px-3 text-xs font-medium text-white hover:bg-blue-300"
        >
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 rounded-xl border-white/10 bg-zinc-950/90 p-3 shadow-float backdrop-blur-md"
      >
        <div className="text-xs font-medium">Permanent link</div>
        <div className="mt-2 truncate rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-muted-foreground">
          reze.design/you/{shareName}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Sign in to publish a live, always-on 3D scene at your own URL — coming soon.
        </div>
      </PopoverContent>
    </Popover>
  )

  // Figma order: portfolio (avatar) on the left, Share pushed to the right.
  if (asHeader) {
    return (
      <div className="flex w-full items-center gap-1 pt-3 pr-2 pb-2 pl-2">
        {accountBtn}
        <span className="ml-auto">{shareBtn}</span>
      </div>
    )
  }
  // Collapsed: a single pill holding account + Share together (Figma parity).
  return (
    <div className={cn("flex items-center gap-1.5 py-1 pr-1 pl-1", floating)}>
      {accountBtn}
      {shareBtn}
    </div>
  )
}
