"use client"

import type { ReactNode } from "react"
import { DROP_BOUND, useFileDrop } from "@/hooks/use-file-drop"
import { cn } from "@/lib/utils"

/** An upload line that also takes a file or folder dragged onto it — see
 *  hooks/use-file-drop. Without `onFiles` it is a plain div. */
export function FileDropArea({
  onFiles,
  className,
  children,
}: {
  onFiles?: (files: File[]) => void
  className?: string
  children: ReactNode
}) {
  const drop = useFileDrop(onFiles)
  return (
    <div
      {...drop.props}
      className={cn(className, onFiles && DROP_BOUND, onFiles && (drop.over ? "outline-foreground" : "outline-transparent"))}
    >
      {children}
    </div>
  )
}
