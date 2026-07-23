"use client"

// Solid top header for the content pages (gallery / library) — nextjs.org-style:
// brand at the left, nav links, GitHub + account at the right. The immersive
// editor does NOT use this; it has its own floating brand pill (editor-chrome).

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CircleUserRound, WandSparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GithubMark } from "@/components/icons"
import { NAV_LINKS } from "@/components/site-nav"
import { cn } from "@/lib/utils"

export function SiteHeader() {
  const pathname = usePathname()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-white/10 bg-zinc-950/70 px-4 backdrop-blur-xs">
      <Link href="/" className="mr-4 flex items-center gap-2">
        <WandSparkles className="size-4 text-pink-400" />
        <span className="text-sm font-semibold tracking-tight text-zinc-100">Reze Design</span>
      </Link>
      <nav className="flex items-center gap-1">
        {NAV_LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href)
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-200",
              )}
            >
              {l.label}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <Button asChild variant="ghost" size="icon" className="size-8 text-zinc-500 hover:text-zinc-200">
          <a href="https://github.com/AmyangXYZ/reze-design" target="_blank" rel="noreferrer">
            <GithubMark className="size-4" />
          </a>
        </Button>
        <Button variant="ghost" size="icon" className="size-8 text-zinc-400 hover:text-zinc-200" aria-label="Account">
          <CircleUserRound className="size-4" />
        </Button>
      </div>
    </header>
  )
}
