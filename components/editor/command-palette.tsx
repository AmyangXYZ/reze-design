"use client"

// The command palette.
//
// Built on shadcn Dialog + Input rather than cmdk: the ranking is ours (see
// lib/command-search.ts — three locales, keyword bags, kana folding), so cmdk
// would only have supplied keyboard navigation, which is the twenty lines below.
//
// Shape follows the chrome study: top of the window rather than centred, since a
// vertically centred palette reads as an alert. No ">" mode — that is VS Code
// muscle memory this audience does not have, and a hidden mode you have to know
// about is worse than none. Sections group the one list, visibly.
//
// The right edge carries what a row will ACT ON rather than a keybinding: the
// label already says what it does, and the target is what changes between
// invocations.

import { useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { searchPalette, type CommandSection, type PaletteItem, type SceneGap } from "@/lib/command-search"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function CommandPalette({
  open,
  onOpenChange,
  items,
  recentIds,
  gaps,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: PaletteItem[]
  /** Most-recent-first ids, persisted by the caller. */
  recentIds: string[]
  /** What the scene is missing — the strongest signal Suggestions has. */
  gaps?: SceneGap[]
  onRun: (item: PaletteItem) => void
}) {
  const t = useT()
  const label = t.lab.palette
  const SECTION_LABEL: Record<CommandSection | "suggested", string> = {
    suggested: label.suggested,
    command: label.command,
    goto: label.goto,
    setting: label.setting,
  }
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  // Typing resets the selection and opening resets the query — both are
  // consequences of an event, so they happen in the handler rather than in an
  // effect that fires a second render to correct the first.
  const setQueryAndReset = (next: string) => {
    setQuery(next)
    setActive(0)
  }
  const listRef = useRef<HTMLDivElement>(null)

  const { suggested, results } = useMemo(
    () => searchPalette(items, query, recentIds, gaps),
    [items, query, recentIds, gaps],
  )

  // One flat list for the keyboard; the grouping below is presentation only, so
  // arrowing never has to know a section boundary exists.
  const flat = useMemo(() => [...suggested, ...results], [suggested, results])


  // Keep the selection in view without scrolling the whole dialog.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    if (active === 0) {
      list.scrollTop = 0
      return
    }
    list.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  // Closing changes NOTHING. Clearing the query here would re-run the search
  // with an empty needle while the dialog is still fading out — the filtered
  // list snaps back to the full one and scrolls, right under the cursor. The
  // caller remounts this component on open instead (see the `key` in the lab),
  // so every session starts clean without anything resetting on screen.
  const run = (item: PaletteItem) => {
    onRun(item)
    onOpenChange(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (flat.length === 0) return
      const step = e.key === "ArrowDown" ? 1 : -1
      setActive((i) => (i + step + flat.length) % flat.length)
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault()
      run(flat[active])
    }
  }

  const groups: { key: string; label: string; items: PaletteItem[] }[] = []
  if (suggested.length) groups.push({ key: "suggested", label: SECTION_LABEL.suggested, items: suggested })
  const sectioned: { key: string; label: string; items: PaletteItem[] }[] = []
  for (const section of ["command", "goto", "setting"] as CommandSection[]) {
    const inSection = results.filter((i) => i.section === section)
    if (inSection.length) sectioned.push({ key: section, label: SECTION_LABEL[section], items: inSection })
  }
  // `results` is rank-ordered, but grouping by section re-buries it: with a
  // fixed command→goto→setting order, a weak keyword hit in Commands sat above
  // an exact label match in Go to — and since the keyboard starts on the first
  // row, Enter ran the wrong thing (searching "material" ran a placeholder).
  // While searching, the section holding the best match comes first.
  if (query.trim()) sectioned.sort((a, b) => results.indexOf(a.items[0]) - results.indexOf(b.items[0]))
  groups.push(...sectioned)

  let index = 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Top of the window, not the middle — centring reads as an alert.
        className="top-[14%] max-w-[29rem] translate-y-0 gap-0 overflow-hidden rounded-surface border-line-strong bg-surface p-0 shadow-float backdrop-blur-xs"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">{label.title}</DialogTitle>

        <div className="flex items-center gap-2.5 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQueryAndReset(e.target.value)}
            placeholder={label.placeholder}
            className="h-11 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>

        {/* 22rem = 9 rows (2rem) + 2 section headers (1.75rem) + this box's own
            py-1 (0.5rem). The padding is the point: max-height bounds the BORDER
            box, so the old 21.5rem — content-only arithmetic — spent half a rem
            on padding and clipped the ninth row in half. Landing on a row
            boundary is what stops the list ending mid-row. Generous because this
            is the main entrance to everything the app can do, not a dropdown. */}
        <div ref={listRef} className="max-h-[22rem] overflow-y-auto border-t border-line py-1">
          {flat.length === 0 && <p className="px-3.5 py-4 text-sm text-muted-foreground">{label.empty}</p>}

          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex h-7 items-end px-3.5 pb-1 font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
                {g.label}
              </div>
              {g.items.map((item) => {
                const i = index++
                return (
                  <button
                    key={item.id}
                    data-active={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      "flex h-8 w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-interior px-2.5 text-left text-sm",
                      i === active ? "mx-1 bg-white/[0.08]" : "mx-1",
                    )}
                  >
                    <item.icon
                      className={cn("size-4 shrink-0", item.deep ? "text-pink-400" : "text-muted-foreground")}
                    />
                    <span className="min-w-0 truncate">{item.label}</span>
                    {/* ONE annotation per row, and the value wins where there is
                        one. Both at once was two muted strings competing at the
                        same edge for the same attention — and of the two, where a
                        control lives is the one you can answer by running the
                        row, while what it is set to is why you searched. The
                        label already names the control and the icon already names
                        its row, so the path was the third way of saying it.

                        The path is still SEARCHED (see searchKey) — typing
                        "environment" still finds everything in that row, it just
                        no longer spends the width saying so. */}
                    {(item.value ?? item.hint) && (
                      <span className="ml-auto max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground">
                        {item.value ?? item.hint}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

      </DialogContent>
    </Dialog>
  )
}
