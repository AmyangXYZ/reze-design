"use client"

// The React face of the built-ins shelf (lib/builtins).

import { useEffect, useSyncExternalStore } from "react"
import { builtinEffects, builtinGrades, builtinGraphs, builtinsWhole, loadBuiltins, subscribeBuiltins } from "@/lib/builtins"
import type { EffectItem, GradeItem, GraphItem } from "@/lib/library"

/** Whether the whole shelf is here, starting its load on first use. False on
 *  the server and in the first client render, so the two agree. */
export function useBuiltinsWhole(): boolean {
  useEffect(() => {
    void loadBuiltins()
  }, [])
  return useSyncExternalStore(subscribeBuiltins, builtinsWhole, () => false)
}

const SHELVES = { graph: builtinGraphs, effect: builtinEffects, grade: builtinGrades }
type Shelf = { graph: GraphItem; effect: EffectItem; grade: GradeItem }

/** One kind's built-ins, re-rendering when the shelf changes. */
export function useBuiltins<K extends keyof Shelf>(kind: K): Shelf[K][] {
  const read = SHELVES[kind] as () => Shelf[K][]
  return useSyncExternalStore(subscribeBuiltins, read, read)
}
