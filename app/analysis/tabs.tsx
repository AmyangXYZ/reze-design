"use client"

// The two halves of /analysis, as addresses: what people render here, and what
// they posted on Bilibili. Links rather than in-page tabs, so either one can be
// shared on its own.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function AnalysisTabs() {
  const t = useT()
  const path = usePathname()
  const tabs = [
    { href: "/analysis", label: t.analysis.title },
    { href: "/analysis/bilibili", label: t.bilibili.title },
  ]
  return (
    <nav className="flex gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={path === tab.href ? "page" : undefined}
          className={cn(
            "rounded-chip px-2.5 py-1 text-xs transition-colors",
            path === tab.href ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
