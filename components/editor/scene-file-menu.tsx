"use client"

// The scene menu: new, import, export, reset — the document-level file operations.
//
// It opens from the LOGO, wherever the logo appears (the rail top when the docks are
// open, the floating pill when they are collapsed): the Figma convention, and the role
// the rail logo was always documented to hold. One rule — the logo is the menu — beats
// a chevron decorating the scene name, which read as a rename affordance and put file
// chrome on the document's identity row.

import { useRef, useState, type ReactNode } from "react"
import { ArrowDownToLine, ArrowUpFromLine, FilePlus2, RotateCcw } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"

function Row({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    >
      <Icon className="size-3 shrink-0" />
      {label}
    </button>
  )
}

export type SceneMenuHandlers = {
  onNew: () => void
  onExport: () => void
  /** Receives the picked file — the caller parses, so a bad file is reported through
   *  the same notice the rest of the scene's file failures use. */
  onImport: (file: File) => void
  onReset: () => void
}

/** Wraps `trigger` (the logo, in either of its homes) as the opener of the scene menu. */
export function SceneFileMenu({ trigger, onNew, onExport, onImport, onReset }: SceneMenuHandlers & { trigger: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const pickFile = () => {
    setOpen(false)
    input.current?.click()
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so picking the SAME file twice still fires a change event.
          e.target.value = ""
          if (file) onImport(file)
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t.sceneFile.label}
                className="cursor-pointer rounded-md outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {trigger}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{t.sceneFile.label}</TooltipContent>
        </Tooltip>
        {/* Radix returns focus to the trigger on close, and a programmatic focus counts
            as keyboard focus — so the logo kept its focus ring after every use. Same
            fix the material sidebar's context menu uses. */}
        <PopoverContent align="start" className="w-fit min-w-40 p-1" onCloseAutoFocus={(e) => e.preventDefault()}>
          <Row icon={FilePlus2} label={t.sceneFile.newScene} onClick={run(onNew)} />
          <Row icon={ArrowUpFromLine} label={t.sceneFile.export} onClick={run(onExport)} />
          <Row icon={ArrowDownToLine} label={t.sceneFile.import} onClick={pickFile} />
          <Row icon={RotateCcw} label={t.sceneFile.reset} onClick={run(onReset)} />
        </PopoverContent>
      </Popover>
    </>
  )
}
