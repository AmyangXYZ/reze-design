"use client"

// Materials panel (chromeless): a flat list in PMX order (model authors order
// materials deliberately), each row carrying a slot-assignment chip. Material
// names are arbitrary artist choices, so the user maps each material to a style
// slot here; the slot's graph then styles every material assigned to it.
// Selection is bidirectional with the 3D scene — clicking a row highlights the
// material on the model, a raycast pick scrolls its row into view, hovering
// previews the highlight without committing. The surrounding glass container,
// tab header, and collapse control are owned by the LeftDock now.

import { useEffect, useRef, useState } from "react"
import type { MaterialPreset } from "reze-engine"
import { Check, CircleDashed, Eye, EyeOff, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MaterialRow } from "@/hooks/use-engine"
import { SLOT_ICONS } from "@/components/scene/slot-icons"
import { SLOT_GRAPHS, SLOT_LABELS, SLOT_ORDER } from "@/lib/materials"
import { cn } from "@/lib/utils"

export function MaterialsPanel({
  materials,
  assignments,
  selected,
  activeSlot,
  onSelect,
  onHover,
  onAssign,
  onToggleVisible,
  onEditGraph,
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
  /** Open the node-graph editor for the active slot (drawer at the page bottom). */
  onEditGraph: () => void
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

  return (
    <>
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
                "group/row mx-2 flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-1 pl-2 transition-colors",
                selected === m.name ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                !m.visible && "opacity-45",
              )}
              onClick={() => onSelect(m.name)}
              onMouseEnter={() => onHover(m.name)}
            >
              <RowIcon
                className={cn(
                  "size-3.5 shrink-0",
                  selected === m.name ? "text-blue-400" : "text-muted-foreground group-hover/row:text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  selected === m.name ? "" : " group-hover/row:text-foreground",
                )}
              >
                {m.name}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-5 shrink-0 text-muted-foreground hover:text-foreground",
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
                      "shrink-0 cursor-pointer rounded-full border px-1.5 py-px text-[10px] tracking-wide whitespace-nowrap transition-colors",
                      slot === null
                        ? "border-dashed border-white/20 text-muted-foreground hover:text-foreground"
                        : editable && slot === activeSlot
                          ? "border-blue-400/40 bg-blue-400/10 text-blue-400"
                          : editable
                            ? "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                            : "border-transparent bg-white/5 text-muted-foreground hover:text-foreground",
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
                  className="w-44 rounded-xl border-white/10 bg-zinc-950/90 p-1 shadow-float backdrop-blur-xl"
                >
                  <div className="px-2 pt-1 pb-1.5 text-xs tracking-[0.16em] text-muted-foreground uppercase">Style slot</div>
                  {SLOT_ORDER.map((s) => {
                    const Icon = SLOT_ICONS[s] ?? CircleDashed
                    return (
                      <button
                        key={s}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors",
                          slot === s
                            ? "bg-white/[0.08]"
                            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                        )}
                        onClick={() => {
                          onAssign(m.name, s)
                          setChipFor(null)
                        }}
                      >
                        <Icon className="size-3 text-muted-foreground" />
                        <span className="flex-1">{SLOT_LABELS[s]}</span>
                        {!(s in SLOT_GRAPHS) && <span className="text-xs text-muted-foreground">built-in</span>}
                        {slot === s && <Check className="size-3 text-blue-400" />}
                      </button>
                    )
                  })}
                </PopoverContent>
              </Popover>
            </div>
          )
        })}
          {materials.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No materials — load a model.</div>
          )}
        </div>
      </ScrollArea>
      {/* Node-graph entry — opens the editor drawer for the active slot. */}
      <div className="border-t border-white/5 p-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground"
          onClick={onEditGraph}
        >
          <Workflow className="size-3.5" />
          Edit {SLOT_LABELS[activeSlot]} node graph
        </Button>
      </div>
    </>
  )
}
