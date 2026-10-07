// Undo and redo for the scene's configuration — one commit layer, whoever edits.
//
// What it covers is the document's LOOK: settings, camera, effects, lamps, style
// groups and hidden materials. Not the clips (they have their own history, in
// clip-history.tsx) and not the assets (a model or a stage is added or removed,
// not undone).
//
// A step is a pair of whole snapshots, before and after. That is cheap here
// because the editor's state is immutable: a snapshot holds references, so the
// parts an edit did not touch are the same objects in every step.
//
// Three rules shape what a step is:
//   - Coalescing. Edits to the same parts within MERGE_MS of each other are one
//     step, so a slider drag undoes as a whole rather than one pixel of it.
//   - Transactions. begin()…end() makes everything in between one step — what
//     an AI turn uses, so a turn that touched six things undoes at once.
//   - Rebasing. Changes nobody chose (a scene loading, a stage setting its own
//     sun) move the baseline without becoming a step.

import type { StyleGroup } from "reze-engine"
import type { AppliedEffect } from "@/lib/effects"
import type { SceneCamera, SceneLight } from "@/lib/scene"
import type { SceneSettings } from "@/lib/scene-settings"

export type SceneSnapshot = {
  settings: SceneSettings
  camera: SceneCamera
  effects: AppliedEffect[]
  lights: SceneLight[]
  groups: Record<string, StyleGroup[]>
  /** Hidden material names, per model id. */
  hidden: Record<string, string[]>
}

export type HistoryStep = {
  /** What changed, for "Undo Sun" and an AI turn's change card. */
  label: string
  /** The snapshot keys this step touched — what coalescing compares. */
  parts: string[]
  before: SceneSnapshot
  after: SceneSnapshot
  /** When it was last extended, for coalescing. */
  at: number
}

export const MERGE_MS = 600
export const MAX_STEPS = 100

/** Which parts of the snapshot differ: whole sections, then per-key inside
 *  settings and per-model inside groups and hidden, so a label can say "Sun"
 *  rather than "settings". */
export function changedParts(a: SceneSnapshot, b: SceneSnapshot): string[] {
  const parts: string[] = []
  if (a.settings !== b.settings) {
    for (const k of new Set([...Object.keys(a.settings), ...Object.keys(b.settings)]) as Set<keyof SceneSettings>) {
      if (!same(a.settings[k], b.settings[k])) parts.push(`settings.${k}`)
    }
  }
  if (!same(a.camera, b.camera)) parts.push("camera")
  if (!same(a.effects, b.effects)) parts.push("effects")
  if (!same(a.lights, b.lights)) parts.push("lights")
  for (const id of new Set([...Object.keys(a.groups), ...Object.keys(b.groups)])) {
    if (!same(a.groups[id], b.groups[id])) parts.push(`groups.${id}`)
  }
  for (const id of new Set([...Object.keys(a.hidden), ...Object.keys(b.hidden)])) {
    if (!same(a.hidden[id] ?? [], b.hidden[id] ?? [])) parts.push(`hidden.${id}`)
  }
  return parts
}

/** Reference first — the common case — then by value, for state that was
 *  rebuilt with equal contents. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Readable names for the parts, given the model names to say which model. */
export function labelFor(parts: string[], modelName: (id: string) => string = (id) => id): string {
  const names = parts.map((p) => {
    if (p === "camera") return "Camera"
    if (p === "effects") return "Effects"
    if (p === "lights") return "Lamps"
    const dot = p.indexOf(".")
    const head = p.slice(0, dot)
    const rest = p.slice(dot + 1)
    if (head === "settings") return rest.charAt(0).toUpperCase() + rest.slice(1)
    if (head === "groups") return `${modelName(rest)} materials`
    if (head === "hidden") return `${modelName(rest)} visibility`
    return p
  })
  const unique = [...new Set(names)]
  return unique.length <= 2 ? unique.join(", ") : `${unique.slice(0, 2).join(", ")} +${unique.length - 2}`
}

export class SceneHistory {
  private past: HistoryStep[] = []
  private future: HistoryStep[] = []
  private base: SceneSnapshot | null = null
  private open: { label: string | null; before: SceneSnapshot } | null = null
  private listeners = new Set<() => void>()

  constructor(private modelName: (id: string) => string = (id) => id) {}

  /** How a model id reads in a label; the editor's names change as models load. */
  setModelName(fn: (id: string) => string): void {
    this.modelName = fn
  }

  /** The snapshot everything is measured against. Null until the first observe. */
  get baseline(): SceneSnapshot | null {
    return this.base
  }

  /** Forget everything and start from here — a different scene was opened. */
  reset(snapshot: SceneSnapshot | null = null): void {
    this.past = []
    this.future = []
    this.open = null
    this.base = snapshot
    this.emit()
  }

  /** Move the baseline without making a step: a change nobody chose. */
  rebase(snapshot: SceneSnapshot): void {
    this.base = snapshot
  }

  /**
   * The editor's state as it is now. Records a step when it differs from the
   * baseline, merging into the last step when that one touched the same parts
   * moments ago. Returns the step it recorded or extended, if any.
   */
  observe(snapshot: SceneSnapshot, now = Date.now()): HistoryStep | null {
    const prev = this.base
    this.base = snapshot
    if (!prev) return null
    // Inside a transaction, the step is written once, by end().
    if (this.open) return null
    const parts = changedParts(prev, snapshot)
    if (parts.length === 0) return null
    this.future = []
    const last = this.past[this.past.length - 1]
    if (last && now - last.at < MERGE_MS && sameParts(last.parts, parts)) {
      last.after = snapshot
      last.at = now
      this.emit()
      return last
    }
    const step: HistoryStep = { label: labelFor(parts, this.modelName), parts, before: prev, after: snapshot, at: now }
    this.push(step)
    return step
  }

  /** Start a transaction: everything until end() is one step. Nested calls join
   *  the outer one. */
  begin(label: string | null = null): void {
    if (this.open || !this.base) return
    this.open = { label, before: this.base }
  }

  /** Close the transaction, recording one step if anything changed. */
  end(): HistoryStep | null {
    const open = this.open
    this.open = null
    if (!open || !this.base) return null
    const parts = changedParts(open.before, this.base)
    if (parts.length === 0) return null
    this.future = []
    const step: HistoryStep = {
      label: open.label ?? labelFor(parts, this.modelName),
      parts,
      before: open.before,
      after: this.base,
      // Never merged into by a later edit: a turn is a unit.
      at: -Infinity,
    }
    this.push(step)
    return step
  }

  get inTransaction(): boolean {
    return this.open !== null
  }

  /** The step undo would take back, without taking it. */
  peekUndo(): HistoryStep | null {
    return this.past[this.past.length - 1] ?? null
  }

  peekRedo(): HistoryStep | null {
    return this.future[this.future.length - 1] ?? null
  }

  /** Take back the last step. Returns the snapshot to restore — the caller
   *  applies it and the next observe() of that state records nothing, because
   *  the baseline is already set to it here. */
  undo(): SceneSnapshot | null {
    if (this.open) return null
    const step = this.past.pop()
    if (!step) return null
    this.future.push(step)
    this.base = step.before
    this.emit()
    return step.before
  }

  redo(): SceneSnapshot | null {
    if (this.open) return null
    const step = this.future.pop()
    if (!step) return null
    this.past.push(step)
    this.base = step.after
    this.emit()
    return step.after
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private push(step: HistoryStep): void {
    this.past.push(step)
    if (this.past.length > MAX_STEPS) this.past.shift()
    this.emit()
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

const sameParts = (a: string[], b: string[]) => a.length === b.length && a.every((p, i) => p === b[i])
