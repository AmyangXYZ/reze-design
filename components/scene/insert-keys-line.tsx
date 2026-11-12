"use client"

import { Diamond } from "lucide-react"
import { Button } from "@/components/ui/button"

/** One press keys every field of the picked object at the playhead, as it
 *  stands: place it, press, move the playhead, place it again, press. */
export function InsertKeysLine({ label, onInsert }: { label: string; onInsert: () => void }) {
  return (
    <Button
      variant="bare"
      onClick={onInsert}
      className="mb-1.5 flex h-7 items-center gap-2.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <Diamond className="size-3.5" />
      {label}
    </Button>
  )
}
