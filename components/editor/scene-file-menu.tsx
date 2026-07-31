"use client"

// Document-level actions for the scene's CONFIG: import one, export this one, reset to
// the curated default. They hang off the scene name because that is what they act on —
// and they live together because they are the same slice of state seen three ways,
// which is why there is no longer one reset in the Scene tab and another in Materials.

import { useRef, useState } from "react"
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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

export function SceneFileActions({
  onExport,
  onImport,
  onReset,
}: {
  onExport: () => void
  /** Receives the picked .json — the caller parses, so a bad file is reported through
   *  the same notice the rest of the scene's file failures use. */
  onImport: (file: File) => void
  onReset: () => void
}) {
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
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so picking the SAME file twice still fires a change event.
          e.target.value = ""
          if (file) onImport(file)
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.sceneFile.label}
            className="size-4 shrink-0 rounded text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-fit min-w-40 p-1">
          <Row icon={ArrowDownToLine} label={t.sceneFile.import} onClick={pickFile} />
          <Row icon={ArrowUpFromLine} label={t.sceneFile.export} onClick={run(onExport)} />
          <Row icon={RotateCcw} label={t.sceneFile.reset} onClick={run(onReset)} />
        </PopoverContent>
      </Popover>
    </>
  )
}
