"use client"

// The timeline's left column: every track in the scene by who it belongs to —
// the scene, each character, the stage, each prop — one section open at a
// time. Opening a section is choosing whose tracks you are editing; picking a
// row inside it is choosing which. Built by lib/timeline/rows.ts, drawn here.

import { useEffect, useRef } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { useT } from "@/lib/i18n"
import { buildRows, isSection, type RowLabels, type RowSource, type TimelineRow } from "@/lib/timeline/rows"
import { LANE_H } from "@/components/scene/effect-lanes"
import { useClipActions, useClipSelector } from "@/context/clip-editor"
import { cn } from "@/lib/utils"

export type OutlinerProps = {
  rows: TimelineRow[]
  /** The picked row, by id. */
  selected: string | null
  /** A section heading pressed: open it (folding the one before) or close it. */
  onSection: (row: TimelineRow) => void
  /** A row inside a section opened or closed. */
  onToggle: (row: TimelineRow) => void
  /** A row inside a section picked. */
  onPick: (row: TimelineRow) => void
  /** The cast, for copying or moving a character's effect to another. */
  cast: { id: string; name: string }[]
  onCopyTo: (uid: string, to: string) => void
  onMoveTo: (uid: string, from: string, to: string) => void
  /** The list scrolled, in pixels: the tracks beside it follow. */
  onScroll?: (top: number) => void
  /** The first row's height: it sits beside the time axis, not under it. */
  firstH?: number
}

const INDENT = 12
/** The column's width, which the header's position bar is sized against. */
export const OUTLINER_W = 184

export function Outliner({ rows, selected, onSection, onToggle, onPick, cast, onCopyTo, onMoveTo, onScroll, firstH }: OutlinerProps) {
  const t = useT()
  // The picked row kept in view: a bone picked in the viewport may be far down.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selected) return
    listRef.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" })
  }, [selected, rows.length])
  return (
    <div
      ref={listRef}
      // The track list's width: room for a bone name two levels in, and no
      // more — every pixel here is one the tracks do not get.
      className="no-scrollbar shrink-0 overflow-y-auto overscroll-contain border-r border-line"
      style={{ width: OUTLINER_W }}
      onScroll={(e) => onScroll?.(e.currentTarget.scrollTop)}
    >
      {rows.map((row, i) => {
        const height = i === 0 && firstH ? firstH : LANE_H
        const body = (
          <OutlineRow key={row.id} row={row} height={height} picked={row.id === selected} onSection={onSection} onToggle={onToggle} onPick={onPick} />
        )
        if (row.kind !== "effect" || !row.ref) return body
        const uid = row.ref
        // A character's effect can go to another character; a scene effect
        // is no one's to hand on.
        if (row.owner === null) return body
        const from = row.owner
        const others = cast.filter((m) => m.id !== from)
        return (
          <ContextMenu key={row.id}>
            <ContextMenuTrigger asChild>
              <div>{body}</div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              {others.map((m) => (
                <ContextMenuItem key={`c${m.id}`} onSelect={() => onCopyTo(uid, m.id)}>
                  {t.lab.timeline.outline.copyTo(m.name)}
                </ContextMenuItem>
              ))}
              {others.length > 0 && <ContextMenuSeparator />}
              {others.map((m) => (
                <ContextMenuItem key={`m${m.id}`} onSelect={() => onMoveTo(uid, from, m.id)}>
                  {t.lab.timeline.outline.moveTo(m.name)}
                </ContextMenuItem>
              ))}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}

function OutlineRow({
  row,
  height,
  picked,
  onSection,
  onToggle,
  onPick,
}: {
  row: TimelineRow
  height: number
  picked: boolean
  onSection: (row: TimelineRow) => void
  onToggle: (row: TimelineRow) => void
  onPick: (row: TimelineRow) => void
}) {
  const section = isSection(row)
  const opens = row.open !== undefined
  return (
    <div
      data-row={row.id}
      className={cn(
        "flex items-center",
        section && "border-t border-line first:border-t-0",
        // The picked row: the accent's fill, edged at the column's left. A
        // row that opens is a group, not a track, and never shows as picked.
        picked && !opens && "bg-blue-400/[0.12] shadow-[inset_2px_0_0_var(--color-blue-400)]",
      )}
      style={{ height, paddingLeft: 4 + row.depth * INDENT }}
    >
      <Button
        type="button"
        variant="bare"
        aria-label={row.label}
        aria-expanded={opens ? row.open : undefined}
        tabIndex={opens ? 0 : -1}
        onClick={() => (section ? onSection(row) : onToggle(row))}
        className={cn("flex size-4 shrink-0 items-center justify-center text-muted-foreground", !opens && "invisible")}
      >
        <ChevronRight className={cn("size-3", row.open && "rotate-90")} />
      </Button>
      <Button
        type="button"
        variant="bare"
        // A row that opens does so on its name as on its chevron, and is
        // picked as it opens; closing it only closes it.
        onClick={() => {
          if (section) return onSection(row)
          if (opens && row.open) return onToggle(row)
          onPick(row)
          if (opens) onToggle(row)
        }}
        className={cn(
          // The timeline's one size, the chrome's small one; a section's
          // heading reads as one by its weight.
          "flex h-full min-w-0 flex-1 items-center justify-start pr-2 text-left text-2xs text-foreground",
          section && "font-medium",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {row.count ? <span className="shrink-0 pl-1.5 text-figure text-muted-foreground tabular-nums">[{row.count}]</span> : null}
      </Button>
    </div>
  )
}

/** What the page hands the timeline for its outliner. */
export type OutlineData = Omit<OutlinerProps, "rows" | "onScroll" | "firstH"> & {
  source: RowSource
  section: string | null
  open: ReadonlySet<string>
  labels: RowLabels
  /** A bone picked somewhere else — the viewport, the curves — to show here. */
  onRevealBone: (modelId: string, bone: string) => void
}

/**
 * The tree, inside the clip editor: the open character's bones and morphs come
 * from the model being edited — the store holds it and every edit
 * lands there, which the page around the editor cannot reach. The outliner and
 * the overview beside it both draw these rows.
 */
export function useOutlineRows(outline: OutlineData | null): TimelineRow[] {
  // Every bone and morph the model has, keyed or not: a track you have not
  // keyed yet is still one you can pick and key.
  const boneNames = useClipSelector((s) => s.boneNames)
  const morphNames = useClipSelector((s) => s.morphNames)
  const modelId = useClipSelector((s) => s.modelId)
  const clip = useClipSelector((s) => s.clip)
  if (!outline) return []
  const { source } = outline
  // Each bone's and morph's key count, beside its name, from the clip.
  const counted = (row: TimelineRow): TimelineRow => {
    const n =
      row.kind === "bone" ? clip?.boneTracks.get(row.ref!)?.length : row.kind === "morph" ? clip?.morphTracks.get(row.ref!)?.length : undefined
    return n ? { ...row, count: n } : row
  }
  return buildRows(
    {
      ...source,
      cast: source.cast.map((c) => (c.id === modelId ? { ...c, bones: boneNames, morphs: morphNames } : c)),
    },
    outline.section,
    outline.open,
    outline.labels,
  ).map(counted)
}

/** The outliner inside the clip editor: a picked bone or morph is also the
 *  clip's selection, which only the editor's store can set. */
export function TimelineOutliner({ outline, rows, onScroll, firstH }: { outline: OutlineData; rows: TimelineRow[]; onScroll?: (top: number) => void; firstH?: number }) {
  const { setSelectedBone, setSelectedMorph } = useClipActions()
  // A bone picked anywhere — a double-click in the viewport most often — opens
  // its way here and is picked, so the list never disagrees with the gizmo.
  const selectedBone = useClipSelector((s) => s.selectedBone)
  const modelId = useClipSelector((s) => s.modelId)
  const reveal = outline.onRevealBone
  useEffect(() => {
    if (selectedBone && modelId) reveal(modelId, selectedBone)
  }, [selectedBone, modelId, reveal])
  return (
    <Outliner
      {...outline}
      rows={rows}
      onScroll={onScroll}
      firstH={firstH}
      onPick={(row) => {
        outline.onPick(row)
        if (row.kind === "bone" && row.ref) setSelectedBone(row.ref)
        else if (row.kind === "morph" && row.ref) setSelectedMorph(row.ref)
      }}
    />
  )
}
