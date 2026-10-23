"use client"

// The cover's ink as the person chose it: read off the scene (auto), or held
// black or white whatever the scene does. A viewing preference, kept in this
// browser; the scene never carries it.

import { useSyncExternalStore } from "react"
import { storageKey } from "@/lib/storage"

export type InkChoice = "auto" | "dark" | "light"

const KEY = storageKey("ink-choice")
const CHOICES: InkChoice[] = ["auto", "dark", "light"]

const listeners = new Set<() => void>()
// Held here too, so the choice still works where storage is refused.
let current: InkChoice | null = null

function read(): InkChoice {
  if (current !== null) return current
  try {
    const v = localStorage.getItem(KEY) as InkChoice | null
    current = v && CHOICES.includes(v) ? v : "auto"
  } catch {
    current = "auto"
  }
  return current
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useInkChoice(): [InkChoice, (choice: InkChoice) => void] {
  const value = useSyncExternalStore(subscribe, read, () => "auto" as const)
  const set = (choice: InkChoice) => {
    current = choice
    try {
      localStorage.setItem(KEY, choice)
    } catch {}
    for (const l of listeners) l()
  }
  return [value, set]
}
