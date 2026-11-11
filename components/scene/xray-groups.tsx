"use client"

// The see-through window's list (#xray): which material groups it cuts on the
// characters it is aimed at. Every group the aimed cast has, by name, ticked
// when the window cuts it — the dress, or the stockings too, or a group made
// by hand for one garment — and the materials in no group as one row.

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { XRAY_UNGROUPED } from "@/lib/effects"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function XrayGroups({
  groups,
  cut,
  onCut,
}: {
  /** The aimed characters' groups, one row a group id, in their order. */
  groups: { id: string; label: string }[]
  /** The ids the window cuts. */
  cut: readonly string[]
  onCut: (next: string[]) => void
}) {
  const t = useT()
  const rows = [...groups, { id: XRAY_UNGROUPED, label: t.lab.ctl.xrayUngrouped }]
  const on = (id: string) => cut.includes(id)
  return (
    <>
      <div className="mb-1 truncate pl-1.5 text-2xs text-muted-foreground">{t.lab.ctl.xrayCut}</div>
      <div className="flex flex-col">
        {rows.map((g) => (
          <Button
            key={g.id}
            variant="ghost"
            onClick={() => onCut(on(g.id) ? cut.filter((x) => x !== g.id) : [...cut, g.id])}
            // The aiming list's row: a tick on the right, the accent on the
            // text, muted when it is off.
            className={cn(
              "h-6 w-full justify-start gap-2 rounded-interior px-1.5 text-xs font-normal hover:bg-white/10",
              on(g.id) ? "text-blue-400 hover:text-blue-400" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{g.label}</span>
            <Check className={cn("size-3.5 shrink-0", on(g.id) ? "opacity-100" : "opacity-0")} />
          </Button>
        ))}
      </div>
    </>
  )
}
