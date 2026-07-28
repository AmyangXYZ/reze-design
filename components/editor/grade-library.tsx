"use client"

// Grades library — the same three-column shell as the shader-graph and background-effect

import { useMemo, useState } from "react"
import { Palette, Plus, Search, SquarePen, Trash2, X } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { GradePreview } from "@/components/editor/grade-preview"
import type { GradeEditorSubject } from "@/components/editor/grade-editor"
import {
  CUSTOM_ID,
  GRADE_PRESETS,
  NEW_GRADE_SPEC,
  type GradeDef,
  type GradeSettings,
  type GradeSpec,
} from "@/lib/grade"
import { useZOrder } from "@/hooks/use-z-order"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  grade: GradeSettings
  /** Apply a built-in by id. */
  onApplyPreset: (id: string) => void
  /** Apply a user grade — snapshotted into the scene, never referenced. */
  onApplyCustom: (name: string, spec: GradeSpec) => void
  userGrades: GradeDef[]
  onSaveUserGrades: (list: GradeDef[]) => void
  /** Open the page-level floating grade editor (independent panel, same idiom as the graph */
  onEdit: (subject: GradeEditorSubject) => void
}

export function GradeLibrary(props: Props) {
  return (
    // Non-modal, no overlay — the docks stay live and the scene stays undimmed, because the scene
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      {props.open && <LibraryContent {...props} />}
    </Dialog>
  )
}

function LibraryContent({ onOpenChange, grade, onApplyPreset, onApplyCustom, userGrades, onSaveUserGrades, onEdit }: Props) {
  const t = useT()
  // Desktop-style stacking: clicking a library raises it over any editor.
  const { z, onPointerDownCapture } = useZOrder()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(grade.preset === CUSTOM_ID ? (userGrades[0]?.id ?? "neutral") : grade.preset)

  const nameOf = (g: GradeDef) => g.name ?? t.scene.gradePresets[g.id as keyof typeof t.scene.gradePresets] ?? g.id
  const all = useMemo(() => [...GRADE_PRESETS, ...userGrades], [userGrades])
  const selected = all.find((g) => g.id === selectedId) ?? all[0]
  const isUser = userGrades.some((g) => g.id === selected?.id)

  const categories = useMemo(() => [...new Set(all.map((g) => g.category))], [all])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (g) => (!category || g.category === category) && (!q || nameOf(g).toLowerCase().includes(q) || g.author.toLowerCase().includes(q)),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, category, t])

  // Browsing never touches the scene
  const select = (g: GradeDef) => setSelectedId(g.id)

  const apply = () => {
    if (isUser) onApplyCustom(nameOf(selected), selected.spec)
    else onApplyPreset(selected.id)
    onOpenChange(false)
  }

  /** Straight into the editor, no entry created */
  const startEdit = (g: GradeDef) => {
    setSelectedId(g.id)
    onEdit({ id: g.id, name: nameOf(g), spec: g.spec })
  }
  const startNew = () => onEdit({ id: CUSTOM_ID, name: t.gradeLibrary.untitled, spec: NEW_GRADE_SPEC })

  const removeUser = (id: string) => {
    onSaveUserGrades(userGrades.filter((g) => g.id !== id))
    setSelectedId("neutral")
  }

  /** Is this entry what the scene is currently showing? Snapshotted user grades have no id */
  const isApplied = (g: GradeDef) =>
    grade.preset === CUSTOM_ID ? userGrades.some((u) => u.id === g.id) && grade.custom?.name === nameOf(g) : grade.preset === g.id

  const shownSpec = selected?.spec

  return (
    <DialogContent
      showCloseButton={false}
      overlay={false}
      onInteractOutside={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      style={{ zIndex: z }}
        onPointerDownCapture={onPointerDownCapture}
        className="flex h-[82dvh] max-h-[82dvh] w-[92vw] max-w-5xl flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950/95 p-0 sm:max-w-5xl data-[state=closed]:animate-none data-[state=closed]:fade-out-100 data-[state=closed]:zoom-out-100"
    >
      <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-white/10 px-4 py-2 text-left">
        <DialogTitle className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Palette className="size-4 text-blue-400" />
          {t.scene.grade}
        </DialogTitle>
        <div className="relative ml-auto w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.library.searchPlaceholder}
            className="h-7 border-white/10 bg-white/5 pl-8 text-xs"
          />
        </div>
        <button
          onClick={startNew}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 transition-colors hover:bg-white/90"
        >
          <Plus className="size-3.5" />
          {t.gradeLibrary.newGrade}
        </button>
        <DialogClose className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">{t.library.close}</span>
        </DialogClose>
      </DialogHeader>

      <div className="flex min-h-0 flex-1">
        {/* ── Category rail ── */}
        <div className="hidden w-36 shrink-0 flex-col gap-0.5 border-r border-white/10 p-2 md:flex">
          <div className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">
            {t.bgLibrary.browse}
          </div>
          {[null, ...categories].map((c) => {
            const count = c === null ? all.length : all.filter((g) => g.category === c).length
            const on = category === c
            return (
              <button
                key={c ?? "all"}
                onClick={() => setCategory(c)}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-xs transition-colors",
                  on ? "bg-blue-400/15 font-medium text-blue-400" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {c === null ? t.bgLibrary.all : (t.gradeLibrary.categories[c as keyof typeof t.gradeLibrary.categories] ?? c)}
                </span>
                <span className={cn("font-mono text-[11px]", on ? "text-blue-400/80" : "text-muted-foreground/60")}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* ── Grid: every tile is the user's own scene under that grade ── */}
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] content-start gap-3 p-3">
            {rows.map((g) => {
              const sel = g.id === selectedId
              return (
                <button
                  key={g.id}
                  onClick={() => select(g)}
                  onDoubleClick={() => startEdit(g)} // straight into the wheels
                  className={cn(
                    "cursor-pointer overflow-hidden rounded-md border text-left transition-colors",
                    sel ? "border-blue-400 ring-1 ring-blue-400" : "border-white/10 hover:border-white/25",
                  )}
                >
                  <div className="relative aspect-[16/10] border-b border-white/5 bg-zinc-900">
                    <GradePreview spec={g.spec} />
                    {isApplied(g) && (
                      <span className="absolute top-1.5 left-1.5 rounded border border-blue-400/40 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-blue-400 uppercase">
                        {t.bgLibrary.applied}
                      </span>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <div className="truncate text-xs font-medium">{nameOf(g)}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground/70">{g.author}</div>
                  </div>
                </button>
              )
            })}
            {rows.length === 0 && (
              <div className="col-span-full py-16 text-center text-xs text-muted-foreground">{t.library.noMatch(query)}</div>
            )}
          </div>
        </ScrollArea>

        {/* ── Inspector, doubling as the editor for user grades ── */}
        <div className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-white/10 sm:w-[20rem]">
          {selected && shownSpec && (
            <>
              <div className="p-3 pb-0">
                {/* The preview IS the edit affordance, exactly like the other two libraries */}
                <button
                  type="button"
                  onClick={() => startEdit(selected)}
                  className="group/prev relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-md border border-white/10"
                >
                  <GradePreview spec={shownSpec} />
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-zinc-950/70 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover/prev:opacity-100">
                    <SquarePen className="size-4" />
                    {t.gradeLibrary.edit}
                  </div>
                </button>
              </div>

              <div className="min-h-0 p-3">
                <div className="truncate text-sm font-semibold">{nameOf(selected)}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">{selected.author}</div>
              </div>

              <div className="mt-auto shrink-0 space-y-1.5 border-t border-white/10 p-3">
                <Button
                  size="sm"
                  onClick={apply}
                  className="h-8 w-full bg-blue-400 text-xs font-medium text-white hover:bg-blue-300"
                >
                  {t.gradeLibrary.apply}
                </Button>
                {isUser && (
                  <Button
                    size="sm"
                    onClick={() => removeUser(selected.id)}
                    className="h-8 w-full bg-red-500/90 text-xs font-medium text-white hover:bg-red-500"
                  >
                    <Trash2 className="size-3.5" />
                    {t.bgLibrary.remove}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </DialogContent>
  )
}
