"use client"

// The React face of the stock shelf (lib/stock).

import { useEffect, useSyncExternalStore } from "react"
import { stockEffects, stockGrades, stockGraphs, stockWhole, loadStock, subscribeStock } from "@/lib/stock"
import type { EffectItem, GradeItem, GraphItem } from "@/lib/library"

/** Whether the whole shelf is here, starting its load on first use. False on
 *  the server and in the first client render, so the two agree. */
export function useStockWhole(): boolean {
  useEffect(() => {
    void loadStock()
  }, [])
  return useSyncExternalStore(subscribeStock, stockWhole, () => false)
}

const SHELVES = { graph: stockGraphs, effect: stockEffects, grade: stockGrades }
type Shelf = { graph: GraphItem; effect: EffectItem; grade: GradeItem }

/** One kind's stock, re-rendering when the shelf changes. */
export function useStock<K extends keyof Shelf>(kind: K): Shelf[K][] {
  const read = SHELVES[kind] as () => Shelf[K][]
  return useSyncExternalStore(subscribeStock, read, read)
}
