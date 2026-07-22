"use client"

// Materials panel (chromeless): a flat list in PMX order. Each row shows the
// material and its attached look (its style group's label) — clicking the look
// chip opens the library to pick/change a shader for that material. The engine's
// slot/role concept stays fully internal (auto-grouped); the user just sees
// materials and looks. Selection is bidirectional with the 3D scene.

import { useEffect, useRef } from "react"
import { CircleDashed, Eye, EyeOff, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MaterialRow } from "@/hooks/use-engine"
import { cn } from "@/lib/utils"

export function MaterialsPanel({
  materials,
  selected,
  lookByMaterial,
  onSelect,
  onHover,
  onToggleVisible,
  onEditGraph,
  onOpenLibrary,
}: {
  materials: MaterialRow[]
  selected: string | null
  /** material name → its attached look (its group's label); absent = ungrouped. */
  lookByMaterial: Record<string, string>
  onSelect: (name: string) => void
  onHover: (name: string | null) => void
  onToggleVisible: (name: string) => void
  /** Open the node-graph editor for the selected material's look. */
  onEditGraph: () => void
  /** Open the library to pick a look for a material. */
  onOpenLibrary: (material: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

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
            const look = lookByMaterial[m.name]
            const isSel = selected === m.name
            return (
              <div
                key={m.name}
                data-material={m.name}
                className={cn(
                  "group/row mx-2 flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-1 pl-2 transition-colors",
                  isSel ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                  !m.visible && "opacity-45",
                )}
                onClick={() => onSelect(m.name)}
                onMouseEnter={() => onHover(m.name)}
              >
                <CircleDashed className={cn("size-3.5 shrink-0", isSel ? "text-blue-400" : "text-muted-foreground")} />
                <span className={cn("min-w-0 flex-1 truncate text-xs", isSel ? "text-foreground" : "group-hover/row:text-foreground")}>
                  {m.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("size-5 shrink-0 text-muted-foreground hover:text-foreground", m.visible && "opacity-0 group-hover/row:opacity-100")}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleVisible(m.name)
                  }}
                >
                  {m.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </Button>

                {/* Look chip — the attached shader; click to browse the library. */}
                <button
                  className={cn(
                    "max-w-24 shrink-0 cursor-pointer truncate rounded-full border px-1.5 py-px text-[10px] tracking-wide whitespace-nowrap transition-colors",
                    look
                      ? isSel
                        ? "border-blue-400/40 bg-blue-400/10 text-blue-400"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                      : "border-dashed border-white/20 text-muted-foreground hover:text-foreground",
                  )}
                  title={look ? `${look} — browse looks` : "Pick a look"}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenLibrary(m.name)
                  }}
                >
                  {look ?? "—"}
                </button>
              </div>
            )
          })}
          {materials.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No materials — load a model.</div>
          )}
        </div>
      </ScrollArea>
      {/* Node-graph entry — opens the editor drawer for the selected material's look. */}
      <div className="border-t border-white/5 p-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 border-white/10 bg-white/5 text-xs hover:bg-white/10 hover:text-foreground"
          onClick={onEditGraph}
        >
          <Workflow className="size-3.5" />
          Edit node graph
        </Button>
      </div>
    </>
  )
}
