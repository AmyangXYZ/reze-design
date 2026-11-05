"use client"

// Drag a file or a folder from the desktop onto an upload slot.
//
// The slot's row IS the target: while files hover it, it draws its bound in
// the ink (a drop target's bound is `foreground`, never an accent), and a drop
// hands the same File[] its picker would to the same handler — so a dropped
// file and a picked one can never be two code paths that drift.
//
// A FOLDER arrives the way the folder picker gives it: readDroppedFiles walks
// the directory and names each file by its path from the folder ("Miku/Miku.pmx"),
// the shape relFilePath reads, so a dropped model finds its textures exactly as
// a picked one does. A zip arrives as one file and the model path opens it.
//
// Only a drag carrying FILES lights a slot. A row being reordered, a material
// being dragged to a group, a text selection — none of them is an upload.

import { useEffect, useRef, useState, type DragEvent } from "react"
import { readDroppedFiles } from "@/lib/uploads"

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

/** The outline a slot draws: always there, transparent until files hover it,
 *  so lighting up never moves a pixel of the row. */
export const DROP_BOUND = "rounded-chip outline-1 -outline-offset-1 transition-[outline-color]"

export function useFileDrop(onFiles: ((files: File[]) => void) | undefined) {
  const [over, setOver] = useState(false)
  // dragenter and dragleave fire for every child the pointer crosses, so the
  // slot counts them rather than trusting the last one it saw.
  const depth = useRef(0)
  if (!onFiles) return { over: false, props: {} }
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      // Claimed here so the page-wide guard below does not refuse it, and so
      // an outer slot (the cast group around a row) does not light as well.
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setOver(false)
      // The items list is only readable during the event, so the walk starts
      // now; the files land when the folder has been read.
      void readDroppedFiles(e.dataTransfer.items).then((files) => {
        if (files.length) onFiles(files)
      })
    },
  }
  return { over, props }
}

/**
 * A file let go anywhere that is not a slot does nothing.
 *
 * A browser's default for a dropped file is to OPEN it, replacing the page —
 * so missing a slot by a few pixels would throw away the whole unsaved scene.
 * Mounted once by the editor.
 */
export function useRefuseStrayDrops() {
  useEffect(() => {
    const refuse = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return
      // Claimed by a target already (a slot, the AI panel's image drop).
      if (e.defaultPrevented) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "none"
    }
    window.addEventListener("dragover", refuse)
    window.addEventListener("drop", refuse)
    return () => {
      window.removeEventListener("dragover", refuse)
      window.removeEventListener("drop", refuse)
    }
  }, [])
}
