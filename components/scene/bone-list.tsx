"use client"

import { useRef, useState, useEffect, useCallback, useMemo, memo } from "react"
import { ChevronRight } from "lucide-react"
import { BONE_GROUPS } from "@/lib/animation"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { AnimationClip } from "reze-engine"

const GROUP_H = 24
const BONE_H = 20
const OVERSCAN = 8

interface BoneListProps {
  modelBones: string[]
  clip: AnimationClip | null
  selectedGroup: string
  selectedBone: string | null
  onSelectGroup: (group: string) => void
  onSelectBone: (bone: string) => void
  /** External reveal request (from viewport raycast). `epoch` bumps per
   *  request so repeated picks of the same bone still re-trigger the scroll.
   *  The parent is responsible for ensuring `selectedGroup` contains the
   *  target bone before bumping — otherwise the row isn't rendered and the
   *  scroll is a no-op. */
  revealRequest: { bone: string; epoch: number } | null
}

type Row =
  | { type: "group"; name: string; boneCount: number; isSelected: boolean }
  | { type: "bone"; name: string; kfCount: number; isActive: boolean }

const GroupRow = memo(function GroupRow({
  name,
  boneCount,
  isSelected,
  onClick,
}: {
  name: string
  boneCount: number
  isSelected: boolean
  onClick: () => void
}) {
  const dict = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full w-full items-center gap-0 border-l-2 pl-1 pr-1.5 text-left text-[10px] font-medium leading-none text-muted-foreground",
        isSelected
          ? "border-blue-400 bg-white/[0.03] text-blue-400 hover:bg-white/[0.05]"
          : "border-transparent hover:bg-white/[0.03]",
      )}
    >
      <span className="mr-1 inline-flex size-3 shrink-0 items-center justify-center leading-none">
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            isSelected ? "rotate-90 text-blue-400" : "text-muted-foreground",
          )}
          strokeWidth={2.5}
        />
      </span>
      <span className="min-w-0 flex-1 truncate py-[1px]">{dict.lab.timeline.boneGroups[name] ?? name}</span>
      {/* Right edge, in the same column as the bone rows' keyframe counts, so
          the whole picker reads as two columns rather than as text that
          sometimes ends in a number. Parentheses rather than the rows'
          brackets: this counts bones the group CONTAINS, theirs counts keys the
          clip HAS, and two different facts should not wear one notation. */}
      <span className="ml-auto shrink-0 pl-1 tabular-nums text-[9px]">({boneCount})</span>
    </button>
  )
})

const BoneRow = memo(function BoneRow({
  name,
  kfCount,
  isActive,
  onClick,
}: {
  name: string
  kfCount: number
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full w-full items-center gap-1 pl-2 pr-1.5 text-left font-mono text-[10px] font-normal leading-none",
        isActive
          ? "bg-blue-400/[0.08] text-blue-400 hover:bg-blue-400/12"
          : "text-muted-foreground hover:bg-white/[0.03]",
        // Unkeyed bones recede. Most of a rig is never keyed, so a flat list
        // makes you read every name to find the handful the clip actually
        // touches — the dim is what turns the picker back into a summary of the
        // clip while still letting you reach anything.
        !isActive && kfCount === 0 && "opacity-45",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {kfCount > 0 && (
        <span className={cn("ml-auto shrink-0 pl-1 tabular-nums text-[9px]", isActive ? "text-blue-400" : "text-muted-foreground")}>
          [{kfCount}]
        </span>
      )}
    </button>
  )
})

export const BoneList = memo(function BoneList({
  modelBones,
  clip,
  selectedGroup,
  selectedBone,
  onSelectGroup,
  onSelectBone,
  revealRequest,
}: BoneListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const [name, groupDef] of Object.entries(BONE_GROUPS)) {
      const groupBones = groupDef ? modelBones.filter((b) => groupDef.includes(b)) : modelBones
      const isSelected = selectedGroup === name
      out.push({ type: "group", name, boneCount: groupBones.length, isSelected })
      if (isSelected) {
        for (const b of groupBones) {
          out.push({
            type: "bone",
            name: b,
            kfCount: clip?.boneTracks.get(b)?.length ?? 0,
            isActive: selectedBone === b,
          })
        }
      }
    }
    return out
  }, [modelBones, clip, selectedGroup, selectedBone])

  // Precompute offsets
  const { offsets, total } = useMemo(() => {
    const offs: number[] = []
    let t = 0
    for (const r of rows) {
      offs.push(t)
      t += r.type === "group" ? GROUP_H : BONE_H
    }
    return { offsets: offs, total: t }
  }, [rows])

  // ─── Scroll-to-bone (viewport raycast) ───────────────────────────────
  //     Fires when the parent bumps `revealRequest.epoch`. By then it has
  //     already flipped `selectedGroup` to a group containing the target, so
  //     `offsets` below reflects the expanded layout and we can center the
  //     row in one scrollTo. Initial render (`epoch === 0` conceptually, but
  //     we guard on the request being nullish) is skipped so first-mount
  //     doesn't auto-scroll.
  const lastRevealEpochRef = useRef<number | null>(null)
  useEffect(() => {
    if (!revealRequest) return
    if (lastRevealEpochRef.current === revealRequest.epoch) return
    lastRevealEpochRef.current = revealRequest.epoch
    const el = containerRef.current
    if (!el) return
    const idx = rows.findIndex((r) => r.type === "bone" && r.name === revealRequest.bone)
    if (idx < 0) return
    const target = Math.max(0, offsets[idx] - el.clientHeight / 2 + BONE_H / 2)
    el.scrollTo({ top: target, behavior: "smooth" })
  }, [revealRequest, rows, offsets])

  // Visible window
  const startY = scrollTop - OVERSCAN * BONE_H
  const endY = scrollTop + viewH + OVERSCAN * BONE_H
  let startIdx = 0
  let endIdx = rows.length
  // Binary search for start
  let lo = 0, hi = rows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const h = rows[mid].type === "group" ? GROUP_H : BONE_H
    if (offsets[mid] + h < startY) { startIdx = mid + 1; lo = mid + 1 }
    else hi = mid - 1
  }
  // Binary search for end
  lo = startIdx; hi = rows.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] > endY) { endIdx = mid; hi = mid - 1 }
    else lo = mid + 1
  }

  return (
    <div ref={containerRef} className="h-full touch-pan-y overscroll-contain no-scrollbar overflow-y-auto" onScroll={onScroll}>
      <div style={{ position: "relative", height: total }}>
        {rows.slice(startIdx, endIdx).map((row, i) => {
          const idx = startIdx + i
          const top = offsets[idx]
          const h = row.type === "group" ? GROUP_H : BONE_H
          return (
            <div
              key={row.type === "group" ? `g:${row.name}` : `b:${row.name}`}
              style={{ position: "absolute", top, left: 0, right: 0, height: h }}
            >
              {row.type === "group" ? (
                <GroupRow
                  name={row.name}
                  boneCount={row.boneCount}
                  isSelected={row.isSelected}
                  onClick={() => onSelectGroup(row.name)}
                />
              ) : (
                <BoneRow
                  name={row.name}
                  kfCount={row.kfCount}
                  isActive={row.isActive}
                  onClick={() => onSelectBone(row.name)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
