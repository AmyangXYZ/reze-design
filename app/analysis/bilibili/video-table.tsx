"use client"

// Every video, as a table: sortable by any number or the date, 25 to a page.
// Titles open the video, makers open their Bilibili homepage.

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PublicVideo } from "@/lib/db/bili"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const PAGE = 25
const LINK = "hover:text-foreground hover:underline underline-offset-2"

type Key = "published" | "plays" | "likes"

export function VideoTable({ videos }: { videos: PublicVideo[] }) {
  const t = useT().bilibili
  // First click on a column sorts descending: for counts, "most" is the question.
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "likes", desc: true })
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    const get = (v: PublicVideo) => (sort.key === "published" ? Date.parse(v.published) : v[sort.key])
    return [...videos].sort((a, b) => (sort.desc ? get(b) - get(a) : get(a) - get(b)))
  }, [videos, sort])
  const pages = Math.ceil(sorted.length / PAGE)
  const visible = sorted.slice(page * PAGE, page * PAGE + PAGE)

  const head = (key: Key, label: string) => (
    <th className="px-3 py-2 text-right font-medium">
      <Button
        variant="bare"
        onClick={() => {
          setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))
          setPage(0)
        }}
        className={cn("inline-flex items-center gap-1 text-xs hover:text-foreground", sort.key === key && "text-foreground")}
      >
        {label}
        {sort.key === key && (sort.desc ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />)}
      </Button>
    </th>
  )

  return (
    <section className="rounded-surface border border-line-strong bg-surface">
      <h2 className="px-4 pt-4 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">{t.byVideo}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-line text-left">
              <th className="w-10 px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">{t.video}</th>
              <th className="px-3 py-2 font-medium">{t.maker}</th>
              {head("published", t.published)}
              {head("plays", t.plays)}
              {head("likes", t.likes)}
            </tr>
          </thead>
          <tbody>
            {visible.map((v, i) => (
              <tr key={v.bvid} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-mono text-2xs text-muted-foreground tabular-nums">{page * PAGE + i + 1}</td>
                <td className="max-w-80 px-3 py-2">
                  <a href={`https://www.bilibili.com/video/${v.bvid}`} target="_blank" rel="noreferrer" title={v.title} className={cn("block truncate text-foreground", LINK)}>
                    {v.title}
                  </a>
                </td>
                <td className="max-w-40 px-3 py-2">
                  <a href={`https://space.bilibili.com/${v.mid}`} target="_blank" rel="noreferrer" className={cn("block truncate text-muted-foreground", LINK)}>
                    {v.author}
                  </a>
                </td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums">{v.published.slice(0, 10)}</td>
                <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums">{v.plays.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-foreground tabular-nums">{v.likes.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-xs text-muted-foreground">
          <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            {t.previous}
          </Button>
          <span className="font-mono tabular-nums">
            {page + 1} / {pages}
          </span>
          <Button variant="ghost" size="xs" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            {t.next}
          </Button>
          <span className="ml-auto font-mono tabular-nums">{t.nVideos(sorted.length)}</span>
        </div>
      )}
    </section>
  )
}
