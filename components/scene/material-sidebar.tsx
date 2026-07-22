"use client"

// Floating glass sidebar, material-led: a flat list in PMX order (model authors
// order materials deliberately), each row carrying a slot-assignment chip.
// Material names are arbitrary artist choices, so the user maps each material
// to a style slot here; the slot's graph then styles every material assigned to
// it. Selection is bidirectional with the 3D scene — clicking a row highlights
// the material on the model, a raycast pick scrolls its row into view, and
// hovering previews the highlight without committing.

import { useEffect, useRef, useState } from "react"
import type { MaterialPreset } from "reze-engine"
import { Check, CircleDashed, Eye, EyeOff, PanelLeftClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { MaterialRow } from "@/hooks/use-engine"
import { SLOT_ICONS } from "@/components/scene/slot-icons"
import { SLOT_GRAPHS, SLOT_LABELS, SLOT_ORDER } from "@/lib/materials"
import { cn } from "@/lib/utils"

export function MaterialSidebar({
  materials,
  assignments,
  selected,
  activeSlot,
  onSelect,
  onHover,
  onAssign,
  onToggleVisible,
  onCollapse,
}: {
  materials: MaterialRow[]
  /** material name → assigned slot; null = engine's mmd_classic fallback. */
  assignments: Record<string, MaterialPreset | null>
  selected: string | null
  activeSlot: MaterialPreset
  onSelect: (name: string) => void
  onHover: (name: string | null) => void
  onAssign: (name: string, slot: MaterialPreset | null) => void
  onToggleVisible: (name: string) => void
  onCollapse: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [chipFor, setChipFor] = useState<string | null>(null)

  // Raycast picks land here from outside — keep the selected row in view.
  useEffect(() => {
    if (!selected) return
    listRef.current
      ?.querySelector(`[data-material="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [selected])

  // How many materials share each slot — a preset edit touches all of them.
  const slotCounts = new Map<MaterialPreset, number>()
  for (const slot of Object.values(assignments)) {
    if (slot) slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1)
  }

  return (
    <aside className="flex min-h-0 w-56 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/60 shadow-2xl backdrop-blur-sm">
      <header className="flex items-center gap-1 px-3 py-2">
        <div className="min-w-0 flex-1 text-xs font-medium text-zinc-300">
          Materials
          <span className="ml-1.5 text-xs font-normal text-zinc-500 tabular-nums">{materials.length}</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-6 text-zinc-500 hover:text-zinc-200" onClick={onCollapse}>
              <PanelLeftClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse</TooltipContent>
        </Tooltip>
      </header>
      <Separator className="bg-white/5" />

      <ScrollArea className="min-h-0 flex-1">
        <div ref={listRef} className="py-1.5" onMouseLeave={() => onHover(null)}>
          {materials.map((m) => {
            const slot = assignments[m.name] ?? null
            const editable = slot !== null && slot in SLOT_GRAPHS
            const RowIcon = (slot && SLOT_ICONS[slot]) || CircleDashed
            return (
              <div
                key={m.name}
                data-material={m.name}
                className={cn(
                  "group/row mx-1.5 flex cursor-pointer items-center gap-2 rounded-lg py-1 pr-1 pl-2 transition-colors",
                  selected === m.name ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                  !m.visible && "opacity-45",
                )}
                onClick={() => onSelect(m.name)}
                onMouseEnter={() => onHover(m.name)}
              >
                <RowIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    selected === m.name ? "text-pink-300" : "text-zinc-500 group-hover/row:text-zinc-400",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    selected === m.name ? "text-zinc-100" : "text-zinc-300 group-hover/row:text-zinc-100",
                  )}
                >
                  {m.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-5 shrink-0 text-zinc-500 hover:text-zinc-200",
                    m.visible && "opacity-0 group-hover/row:opacity-100",
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleVisible(m.name)
                  }}
                >
                  {m.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </Button>

                {/* ── Slot assignment chip ── */}
                <Popover open={chipFor === m.name} onOpenChange={(o) => setChipFor(o ? m.name : null)}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "shrink-0 cursor-pointer rounded-full border px-1.5 py-px text-xs tracking-wide whitespace-nowrap transition-colors",
                        slot === null
                          ? "border-dashed border-white/20 text-zinc-500 hover:text-zinc-300"
                          : editable && slot === activeSlot
                            ? "border-pink-400/40 bg-pink-400/10 text-pink-300"
                            : editable
                              ? "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"
                              : "border-transparent bg-white/5 text-zinc-500 hover:text-zinc-300",
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {slot === null ? "unset" : SLOT_LABELS[slot]}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="right"
                    sideOffset={6}
                    className="w-44 rounded-xl border-white/10 bg-zinc-950/90 p-1 shadow-2xl backdrop-blur-xl"
                  >
                    <div className="px-2 pt-1 pb-1.5 text-xs tracking-[0.16em] text-zinc-500 uppercase">
                      Style slot
                    </div>
                    {SLOT_ORDER.map((s) => {
                      const Icon = SLOT_ICONS[s] ?? CircleDashed
                      const count = slotCounts.get(s) ?? 0
                      return (
                        <button
                          key={s}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors",
                            slot === s ? "bg-white/[0.08] text-zinc-100" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
                          )}
                          onClick={() => {
                            onAssign(m.name, s)
                            setChipFor(null)
                          }}
                        >
                          <Icon className="size-3 text-zinc-500" />
                          <span className="flex-1">{SLOT_LABELS[s]}</span>
                          {!(s in SLOT_GRAPHS) && <span className="text-xs text-zinc-600">built-in</span>}
                          {count > 0 && <span className="text-xs text-zinc-600 tabular-nums">{count}</span>}
                          {slot === s && <Check className="size-3 text-pink-400" />}
                        </button>
                      )
                    })}
                  </PopoverContent>
                </Popover>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
