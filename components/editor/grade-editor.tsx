"use client"

// Grade editor — a free-floating, draggable, resizable panel (FloatingPanel), the same idiom

import { Palette, RotateCcw } from "lucide-react"
import { FloatingPanel, type Rect } from "@/components/editor/floating-panel"
import { useHistory } from "@/hooks/use-history"
import { EditorHeader, EditorHeaderButton } from "@/components/editor/editor-header"
import { GradePreview } from "@/components/editor/grade-preview"
import { ColorWheel } from "@/components/editor/color-wheel"
import { SliderRow } from "@/components/scene/scene-sidebar"
import { applySplit, readSplit, resolveSpec, type GradeSpec, type Range } from "@/lib/grade"
import { useT } from "@/lib/i18n"

export type GradeEditorSubject = {
  /** Library entry being edited: a draft's local_ id, or a built-in's name. The
   *  first change to a built-in forks it into a draft (see page's editGrade). */
  id: string
  name: string
  spec: GradeSpec
  /** Built-in name this grade descends from — what "back to preset" reverts to. */
  origin?: string
}

export function GradeEditorPanel({
  open,
  sessionId,
  rect,
  onRectChange,
  subject,
  origin,
  onChange,
  onClose,
}: {
  open: boolean
  /** Bumped per editing session so the body remounts on a new subject. */
  sessionId: number
  rect: Rect | null
  onRectChange: (r: Rect) => void
  subject: GradeEditorSubject
  /** The BUILT-IN spec this subject descends from — resolved from the library, never
   *  a snapshot of how it looked when the editor opened. */
  origin: GradeSpec
  /** Every edit: persists to the library AND mirrors onto the scene. */
  onChange: (next: GradeEditorSubject) => void
  onClose: () => void
}) {
  if (!open || !rect) return null
  return (
    <FloatingPanel
      rect={rect}
      onRectChange={onRectChange}
      fullscreen={false}
      raiseKey={sessionId}
      onEscape={onClose}
      minW={520}
      minH={330}
      // z-50 like the other editors: above the docks and the non-modal library.
      className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 shadow-float"
    >
      <EditorBody key={sessionId} subject={subject} origin={origin} onChange={onChange} onClose={onClose} />
    </FloatingPanel>
  )
}

function EditorBody({
  subject,
  origin,
  onChange,
  onClose,
}: {
  subject: GradeEditorSubject
  origin: GradeSpec
  onChange: (next: GradeEditorSubject) => void
  onClose: () => void
}) {
  const t = useT()
  const { name, spec } = subject
  const set = (patch: Partial<GradeEditorSubject>) => onChange({ ...subject, ...patch })
  const setSpec = (patch: Partial<GradeSpec>) => set({ spec: { ...spec, ...patch } })
  const cdl = resolveSpec(spec, 1)

  // Wheel drags settle into one history step, the same way the graph editor batches
  // a node drag.
  const { scopeProps } = useHistory(subject, onChange, { scope: "grade" })

  return (
    <div className="flex h-full flex-col" {...scopeProps}>
      <EditorHeader
        icon={Palette}
        iconClassName="text-blue-400"
        title={name || t.gradeLibrary.untitled}
        closeLabel={t.library.close}
        onClose={onClose}
        actions={
          <EditorHeaderButton icon={RotateCcw} label={t.gradeLibrary.revert} onClick={() => set({ spec: origin })} />
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* ── Controls column ── */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
          {/* Split tone first: the one move that covers most grading intent. */}
          <SliderRow
            label={t.scene.split}
            value={readSplit(spec)}
            min={-1}
            max={1}
            step={0.01}
            onChange={(v) => set({ spec: applySplit(spec, v) })}
            fmt={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
          />

          {/* Wheels: angle = hue this range is pushed toward, distance = amount, rail = lightness (crush */}
          <div className="mt-4 flex items-start gap-3">
            {(
              [
                ["shadows", t.scene.shadows],
                ["midtones", t.scene.midtones],
                ["highlights", t.scene.highlights],
              ] as const
            ).map(([k, label]) => (
              <ColorWheel
                key={k}
                label={label}
                value={spec[k]}
                resolved={cdl[k]}
                onChange={(next: Range) => setSpec({ [k]: next })}
              />
            ))}
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <SliderRow
              label={t.scene.contrast}
              value={spec.contrast}
              min={0.5}
              max={1.6}
              step={0.01}
              onChange={(v) => setSpec({ contrast: v })}
              fmt={(v) => v.toFixed(2)}
            />
            <SliderRow
              label={t.scene.saturation}
              value={spec.saturation}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => setSpec({ saturation: v })}
              fmt={(v) => v.toFixed(2)}
            />
          </div>
        </div>
        {/* Preview column, on the RIGHT */}
        <div className="flex min-w-0 flex-[0_0_42%] flex-col border-l border-white/10 p-3">
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-zinc-900">
            <GradePreview spec={spec} />
          </div>
        </div>
      </div>
    </div>
  )
}
