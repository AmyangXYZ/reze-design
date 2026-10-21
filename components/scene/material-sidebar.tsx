"use client"

// Materials panel — a VSCode-explorer-style tree over style groups (materials that share

import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { StyleGroup } from "reze-engine"
import { Bookmark, BookmarkCheck, ChevronDown, ChevronRight, Circle, Eye, EyeOff, FolderPlus, Pencil, Trash2, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { GRAPH_LIBRARY, groupLabel, sameGraphLook } from "@/lib/materials"
import { type GraphItem } from "@/lib/library"
import { useCommunity } from "@/hooks/use-community"
import type { MaterialRow } from "@/hooks/use-engine"
import { builtinName, localGroupLabel } from "@/lib/builtin-text"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useCover } from "@/components/ui/cover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** The console's action look: a line of type, muted, ink on hover. */
const COVER_ACTION = "h-6 w-fit gap-1.5 rounded-none border-0 bg-transparent px-0 text-xs font-normal text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
/** Chosen on the cover: ink, stroked heavier without re-spacing the word. */
const COVER_CHOSEN = "text-foreground [-webkit-text-stroke:0.35px_currentColor]"
/** The chosen GROUP, the one the library beside the pane dresses: the index's
 *  own mark, the selected blue as a rule under its name. */
/** The chosen GROUP: the index's own mark, the selected blue as a rule under
 *  its name. py-1: the name truncates, which clips, so its box holds the rule. */
const COVER_GROUP_CHOSEN = "py-1 text-foreground underline decoration-blue-400 decoration-[1.5px] underline-offset-4"

const UNGROUPED = "\0ungrouped" // sentinel collapse-key / drop-target id for "no group"

// The engine's stock graph, shown as plain "Default"
const ENGINE_DEFAULT_GRAPH = "Lit"

// Eye/Hair own the special render classes
const isProtected = (g: StyleGroup) => g.renderClass === "eye" || g.renderClass === "hair"

// What the ONE shared context menu is pointed at.
type MenuTarget = { kind: "material"; name: string; groupId: string | null } | { kind: "group"; id: string }

// Memoized: the dock keeps tabs MOUNTED (see useKeepAlive in editor/dock.tsx)
export const MaterialsPanel = memo(function MaterialsPanel({
  modelTabs,
  onSelectModel,
  materials,
  groups,
  activeGroupId,
  onSelectGroup,
  onHover,
  onToggleVisible,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onEditGroupGraph,
  onMoveMaterial,
  looksSaved,
  onToggleSavedLooks,
  dense,
}: {
  /** All loaded models — the strip only renders with 2+. The panel body always shows the ACTIVE */
  modelTabs: { id: string; file: string; active: boolean }[]
  onSelectModel: (id: string) => void
  materials: MaterialRow[]
  groups: StyleGroup[]
  /** The group the graph editor is currently bound */
  activeGroupId: string | null
  /** Choose the group the library beside the pane applies to. */
  onSelectGroup?: (id: string) => void
  /** Hover a material to highlight it on the model (null clears). */
  onHover: (name: string | null) => void
  onToggleVisible: (name: string) => void
  /** Creates the group and returns its id — the panel opens rename mode on it. */
  onCreateGroup: () => string
  onRenameGroup: (id: string, label: string) => void
  onDeleteGroup: (id: string) => void
  /** Open the node-graph editor on a group's shader graph. Optional — hosts
   *  without the floating editor hide the edit affordances. */
  onEditGroupGraph?: (id: string) => void
  /** Reassign materials to a group (target=null → ungroup). A list, applied
   *  as one change: moving a selection one call at a time would have each
   *  call rebuild the grouping from the same stale snapshot. */
  onMoveMaterial: (materials: string[], targetId: string | null) => void
  /** The model's grouping is the one saved for it in this browser (lib/model-looks). */
  looksSaved?: boolean
  /** Save the grouping for this model's next upload, or forget it when it is
   *  the saved one. Optional: a host without saved looks hides the button. */
  onToggleSavedLooks?: () => void
  /** Trim the outer vertical padding. The default 3.5 rhythm exists to line the
   *  panel up with the Scene tab inside the dock; a panel that is a surface of
   *  its own already has the header's rule and its own rounded edge doing that
   *  work, and the full gutter reads as slack. */
  dense?: boolean
  /** Discard hand-made grouping and re-derive it from the scene document. */
}) {
  const { t, locale } = useI18n()
  // A default group's label and a built-in graph's name translate on screen;
  // what is stored stays English (lib/builtin-text).
  const shownLabel = (g: StyleGroup) => localGroupLabel(groupLabel(g), locale)
  // On touch devices HTML5-draggable rows swallow swipes (drag starts instead of
  // scroll). Read at init — this panel only ever renders inside a mounted dock.
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)
  // Groups start folded, but the chosen one: a stage brings hundreds of
  // materials, and mounting a row for each made the pane slow to open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeGroupId ? [activeGroupId] : []))
  const [renaming, setRenaming] = useState<string | null>(null)
  // Focus + select the rename input once it mounts.
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!renaming) return
    const raf = requestAnimationFrame(() => {
      renameRef.current?.focus()
      renameRef.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [renaming])
  const [dragMat, setDragMat] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Kept (stale) after close on purpose
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null)

  const communityGraphs = useCommunity<GraphItem>("graph")
  // A group reads `edited` only when its graph actually DIFFERS from the library
  // entry it came from. Compared without `name`, which the group rewrites to the
  // entry's label on apply, and without each node's `ui` — opening the editor
  // round-trips the graph through ReactFlow, which stamps layout positions onto
  // every node. Layout is not part of the look.
  const editedGroups = useMemo(() => {
    const out = new Set<string>()
    for (const g of groups) {
      // Community entries count too — a group built on someone's published graph
      // could never read as edited while only built-ins were consulted.
      const lib =
        GRAPH_LIBRARY.find((e) => e.name === g.graph?.name) ??
        communityGraphs.find((e) => e.name === g.graph?.name)
      if (lib && !sameGraphLook(g.graph, lib.payload.graph)) out.add(g.id)
    }
    return out
  }, [groups, communityGraphs])
  const byName = useMemo(() => new Map(materials.map((m) => [m.name, m])), [materials])
  const grouped = useMemo(() => new Set(groups.flatMap((g) => g.materials)), [groups])
  const ungrouped = useMemo(
    () => materials.filter((m) => !grouped.has(m.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [materials, grouped],
  )
  // Materials within a group render alphabetically, so a drop lands in a deterministic spot
  const sortedNames = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  // Display order: alphabetical by name.
  const ordered = useMemo(
    () => [...groups].sort((a, b) => shownLabel(a).localeCompare(shownLabel(b), undefined, { sensitivity: "base" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, locale],
  )

  /**
   * Long-press on a finger, standing in for the right-click.
   *
   * Rows can't be dragged on touch (a drag would swallow the scroll), so the
   * menu is the only way to move a material there, and Radix's own long-press
   * never got it open. It is cancelled by ANY pointermove, and a held finger
   * jitters. Even when it fired, it opened without a target, because iOS sends
   * no contextmenu event for the row's handler to aim the menu with. This one
   * allows a few pixels of drift and then sends the row the contextmenu event a
   * mouse would, so the row aims the menu and Radix opens it, the same path as
   * a right-click. Radix's timer is turned off by the preventDefault (it skips
   * a handled pointerdown).
   */
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null)
  // The tap that ends a long-press is not a tap: on a group row it would fold
  // the group the menu just opened over. Cleared by the next press either way.
  const pressedLongRef = useRef(false)
  const endPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }
  const pressHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return
      endPress()
      pressedLongRef.current = false
      const target = e.target as HTMLElement
      // A field keeps its own touch behaviour (caret, selection).
      if (target.closest("input, textarea")) return
      e.preventDefault()
      const row = target.closest<HTMLElement>("[data-ctx]")
      if (!row) return
      const { clientX: x, clientY: y } = e
      const timer = window.setTimeout(() => {
        pressRef.current = null
        pressedLongRef.current = true
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      }, 500)
      pressRef.current = { timer, x, y }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = pressRef.current
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) endPress()
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
    onClickCapture: (e: React.MouseEvent) => {
      if (!pressedLongRef.current) return
      pressedLongRef.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
  useEffect(() => endPress, [])

  const toggleCollapse = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  /**
   * Picking several materials — desktop only. Ctrl-click (cmd on a Mac)
   * toggles a row in or out; a plain click on a row, or Escape, lets the
   * selection go. Rows keep their own drag, so grabbing a selected row, or
   * right-clicking it, moves the whole selection.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Names that left the panel (another model, a reload) drop out by themselves.
  const selection = useMemo(() => new Set([...selected].filter((n) => byName.has(n))), [selected, byName])
  const groupOf = useMemo(() => new Map(groups.flatMap((g) => g.materials.map((m) => [m, g.id] as const))), [groups])
  /** What a drag or a Move to on this row carries: the selection when the row
   *  is part of it, the row alone when it is not. */
  const movingWith = (name: string) => (selection.has(name) ? sortedNames([...selection]) : [name])
  const hasSelection = selection.size > 0
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hasSelection])
  const clickRow = (e: React.MouseEvent, name: string) => {
    if (coarse) return
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
    } else if (hasSelection) setSelected(new Set())
  }

  const endDrag = () => {
    setDragMat(null)
    setDropTarget(null)
  }
  const onDropTo = (targetId: string | null) => {
    if (dragMat) onMoveMaterial(movingWith(dragMat), targetId)
    endDrag()
  }
  // Shared drop-zone handlers for a group (id) or the ungrouped section (UNGROUPED).
  const dropZone = (key: string, targetId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragMat) return
      e.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((t) => (t === key ? null : t))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      onDropTo(targetId)
    },
  })

  const cover = useCover()

  // A single material row: hover highlights, drag reassigns, right-click moves it to another
  const materialRow = (m: MaterialRow, currentGroupId: string | null, reactKey: string) => {
    return (
      <div
        key={reactKey}
        data-ctx="row"
        data-material={m.name}
        draggable={!coarse}
        onDragStart={(e) => {
          setDragMat(m.name)
          e.dataTransfer.effectAllowed = "move"
        }}
        onDragEnd={endDrag}
        onContextMenu={() => setMenuTarget({ kind: "material", name: m.name, groupId: currentGroupId })}
        className={cn(
          "group/row flex h-6 cursor-grab items-center select-none gap-1.5 rounded-chip pr-0.5 pl-1 transition-colors active:cursor-grabbing",
          !cover && "hover:bg-white/[0.05]",
          !m.visible && "opacity-45",
          selection.has(m.name) && (cover ? "" : "bg-blue-400/10 hover:bg-blue-400/10"),
          dragMat !== null && movingWith(dragMat).includes(m.name) && "opacity-40",
        )}
        onClick={(e) => clickRow(e, m.name)}
        onMouseEnter={() => onHover(m.name)}
        onMouseLeave={() => onHover(null)}
      >
        {cover ? (
          // A small, light mark: the list's bullet, not a status light.
          <span className="size-[3px] shrink-0 rounded-full bg-muted-foreground" />
        ) : (
          <Circle className="size-1.5 shrink-0 fill-current text-muted-foreground" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs text-muted-foreground group-hover/row:text-foreground",
            selection.has(m.name) && (cover ? COVER_CHOSEN : "text-foreground"),
          )}
        >
          {m.name}
        </span>
        <Button variant="bare"
          className={cn("shrink-0 text-muted-foreground hover:text-foreground", m.visible && "opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-100")}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible(m.name)
            // Hiding is the end of looking for it: the wireframe that showed
            // where it was goes with it, and comes back if it is shown again
            // under the same pointer. Another hidden row still lights up on
            // hover — that is how you find one to bring back.
            onHover(m.visible ? null : m.name)
          }}
        >
          {m.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
      </div>
    )
  }

  return (
    <>
      {/* ── Model strip (multi-model scenes): which model this panel edits ── */}
      {/* On the cover the models head the pane as its tabs, the way Camera's
          Lens and Focus do — one model is still a tab, so the pane always
          opens on the same line. */}
      {cover && (
        <Tabs value={modelTabs.find((m) => m.active)?.id} onValueChange={onSelectModel} className="mt-1 shrink-0 px-4">
          <TabsList className="mb-2 w-full">
            {modelTabs.map((m) => (
              <TabsTrigger key={m.id} value={m.id} className="min-w-0">
                <span className="truncate">{m.file.replace(/\.pmx$/i, "")}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {!cover && modelTabs.length > 1 && (
        <div className={cn("flex shrink-0 flex-wrap gap-1 px-4", dense ? "pt-2" : "pt-3.5")}>
          {modelTabs.map((m) => (
            <Button variant="bare"
              key={m.id}
              onClick={() => onSelectModel(m.id)}
              className={cn(
                "max-w-full truncate rounded-chip border px-2 py-0.5 text-2xs transition-colors",
                m.active
                  ? "border-blue-400/40 bg-blue-400/10 text-foreground"
                  : "border-line-strong text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              {m.file.replace(/\.pmx$/i, "")}
            </Button>
          ))}
        </div>
      )}
      {/* ── Section toolbar (VSCode explorer header): create, and the saved-looks switch ── */}
      {/* Same px-4 gutter and 3.5 vertical rhythm as the Scene tab, so the two panels line up */}
      <div
        className={cn(
          "flex shrink-0 items-center px-4",
          // On the cover the toolbar is a line of words, and wraps rather
          // than cutting the last one off.
          cover ? "flex-wrap gap-x-4" : cn("gap-1", modelTabs.length > 1 ? "pt-1.5" : dense ? "pt-2" : "pt-3.5"),
        )}
      >
        {/* This row used to open with STYLE GROUPS in the Scene tab's uppercase and
            carry create as a bare icon beside it. The title cost more width than it
            earned — the panel is already the Materials tab, and every row under it
            is a style group — and at the dock's reduced width it pushed the Library
            door off the right edge. Create takes its place and says the same noun,
            so the row lost a label rather than an action.
            Its inset matches the Library door's, so the two buttons sit on the
            same gutter from either end. */}
        <Button
          variant={cover ? "ghost" : "outline"}
          size="xs"
          onClick={() => setRenaming(onCreateGroup())}
          className={cover ? COVER_ACTION : "min-w-0 border-line-strong bg-surface-raised text-muted-foreground hover:bg-white/5 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"}
        >
          {/* First to give up room. Truncating a label whose glyph still says
              "folder, plus" costs less than pushing the Library door off-panel. */}
          {cover && <FolderPlus />}
          <span className="truncate">{t.materials.newGroup}</span>
          {!cover && <FolderPlus />}
        </Button>
        {/* At the right end: the toolbar's one switch, apart from its one action. */}
        <span className="flex-1" />
        {onToggleSavedLooks && (
          <Button
            variant={cover ? "ghost" : "outline"}
            size="icon-xs"
            onClick={onToggleSavedLooks}
            aria-label={looksSaved ? t.materials.looksSaved : t.materials.saveLooks}
            className={cn(
              "shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
              cover
                ? "border-0 bg-transparent shadow-none hover:bg-transparent"
                : "border-line-strong bg-surface-raised hover:bg-white/5",
              looksSaved ? (cover ? "text-foreground" : "text-blue-400") : "text-muted-foreground hover:text-foreground",
            )}
          >
            {looksSaved ? <BookmarkCheck /> : <Bookmark />}
          </Button>
        )}
      </div>

      {/* Scrollable, but scrollbar hidden (wheel/trackpad scroll works) so rows can sit close */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "px-4 pt-2",
              // The list scrolls under the model tabs and the toolbar. Off the
              // cover it is contained, so a panel's end does not scroll the page.
              "no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
              !cover && "overscroll-contain",
              dense ? "pb-2" : "pb-3.5",
            )}
            onMouseLeave={() => onHover(null)}
            {...pressHandlers}
            onContextMenuCapture={(e) => {
              if (!(e.target as HTMLElement).closest("[data-ctx]")) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
          >
          {ordered.map((g) => {
            const open = expanded.has(g.id)
            const isActive = activeGroupId === g.id
            const isDrop = dropTarget === g.id
            return (
              <div key={g.id} className={cn("rounded-chip", isDrop && "ring-1 ring-foreground ring-inset")} {...dropZone(g.id, g.id)}>
                {/* Group row — single-click selects/deselects; chevron toggles collapse */}
                <div
                  data-ctx="row"
                  className={cn(
                    "group/hdr flex h-6 cursor-pointer items-center gap-1 rounded-chip pr-0.5 transition-colors",
                    !cover && (isActive ? "bg-blue-400/[0.1]" : "hover:bg-white/[0.04]"),
                  )}
                  onClick={() => {
                    // The chosen group is what the library beside the pane
                    // dresses; choosing opens it, so its materials show.
                    onSelectGroup?.(g.id)
                    if (!open) toggleCollapse(g.id)
                  }}
                  onContextMenu={() => setMenuTarget({ kind: "group", id: g.id })}
                >
                      <Button variant="bare"
                        className="flex h-full shrink-0 items-center px-0.5 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation() // chevron only collapses; don't toggle selection
                          toggleCollapse(g.id)
                        }}
                      >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </Button>

                      {renaming === g.id ? (
                        <Input
                          ref={renameRef}
                          defaultValue={shownLabel(g)}
                          className="h-5 min-w-0 flex-1 border-line-strong bg-white/5 px-1 text-xs font-medium md:text-xs"
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            // Left as shown, a translated default keeps its stored English.
                            if (e.target.value !== shownLabel(g)) onRenameGroup(g.id, e.target.value)
                            setRenaming(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                            if (e.key === "Escape") setRenaming(null)
                          }}
                        />
                      ) : (
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-xs font-medium select-none",
                            isActive ? (cover ? COVER_GROUP_CHOSEN : "text-blue-400") : "text-foreground",
                          )}
                        >
                          {shownLabel(g)}
                        </span>
                      )}

                      {/* What the group wears. The library beside the pane is
                          where another comes from. */}
                      <span
                        className={cn(
                          "min-w-0 max-w-[58%] truncate text-right text-xs",
                          "text-muted-foreground",
                        )}
                      >
                        {g.graph.name === ENGINE_DEFAULT_GRAPH
                          ? t.materials.defaultGraph
                          : GRAPH_LIBRARY.some((e) => e.name === g.graph.name)
                            ? builtinName("graph", g.graph, locale)
                            : g.graph.name}
                        {editedGroups.has(g.id) && ` · ${t.scene.edited}`}
                      </span>

                </div>

                {/* ── Children (indent guide) ── */}
                {open && (
                  <div className="ml-[10px] border-l border-line pl-1">
                    {sortedNames(g.materials).map((name, i) => {
                      const m = byName.get(name)
                      return m ? materialRow(m, g.id, name + "#" + i) : null
                    })}
                    {g.materials.length === 0 && (
                      <div className="px-2 py-1 pl-3 text-xs text-muted-foreground italic">{t.materials.dragHere}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Ungrouped section ── */}
          {ungrouped.length > 0 && (
            <div
              className={cn("mt-0.5 rounded-chip", dropTarget === UNGROUPED && "ring-1 ring-foreground ring-inset")}
              {...dropZone(UNGROUPED, null)}
            >
              <div
                className={cn(
                  "group/hdr flex h-6 cursor-pointer items-center gap-1 rounded-chip pr-0.5 transition-colors",
                  !cover && "hover:bg-white/[0.04]",
                )}
                onClick={() => toggleCollapse(UNGROUPED)}
              >
                <Button variant="bare"
                  className="flex h-full shrink-0 items-center px-0.5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapse(UNGROUPED)
                  }}
                >
                  {expanded.has(UNGROUPED) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </Button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs font-medium",
                    activeGroupId === UNGROUPED
                      ? cover
                        ? COVER_GROUP_CHOSEN
                        : "text-blue-400"
                      : "text-muted-foreground group-hover/hdr:text-foreground",
                  )}
                >
                  {t.materials.ungrouped}
                </span>
              </div>
              {expanded.has(UNGROUPED) && (
                <div className="ml-[10px] border-l border-line pl-1">{ungrouped.map((m, i) => materialRow(m, null, m.name + "#" + i))}</div>
              )}
            </div>
          )}

          {materials.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t.materials.empty}</div>
          )}

          </div>
        </ContextMenuTrigger>
        {/* Don't yank focus back on close */}
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {menuTarget?.kind === "group" &&
            (() => {
              const g = groups.find((x) => x.id === menuTarget.id)
              const locked = !g || isProtected(g)
              return (
                <>
                  {onEditGroupGraph && g && (
                    <ContextMenuItem onSelect={() => onEditGroupGraph(g.id)}>
                      <Workflow className="size-3.5" />
                      {t.materials.editGraph}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem disabled={locked} onSelect={() => setRenaming(menuTarget.id)}>
                    <Pencil className="size-3.5" />
                    {t.materials.rename}
                  </ContextMenuItem>
                  <ContextMenuItem variant="danger" disabled={locked} onSelect={() => onDeleteGroup(menuTarget.id)}>
                    <Trash2 className="size-3.5" />
                    {t.materials.delete}
                  </ContextMenuItem>
                </>
              )
            })()}
          {menuTarget?.kind === "material" &&
            (() => {
              // Live lookup — visibility may have changed since the menu was aimed.
              const m = byName.get(menuTarget.name)
              const visible = m?.visible ?? true
              // A selection can span groups: a group is only left off the list
              // when everything moving is already in it.
              const moving = movingWith(menuTarget.name)
              const from = new Set(moving.map((n) => groupOf.get(n) ?? null))
              const onlyIn = from.size === 1 ? [...from][0] : undefined
              return (
                <>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>{t.materials.moveTo}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {ordered
                        .filter((g) => g.id !== onlyIn)
                        .map((g) => (
                          <ContextMenuItem key={g.id} onSelect={() => onMoveMaterial(moving, g.id)}>
                            {shownLabel(g)}
                          </ContextMenuItem>
                        ))}
                      {onlyIn !== null && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => onMoveMaterial(moving, null)}>{t.materials.ungrouped}</ContextMenuItem>
                        </>
                      )}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => onToggleVisible(menuTarget.name)}>
                    {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {visible ? t.materials.hide : t.materials.show}
                  </ContextMenuItem>
                </>
              )
            })()}
        </ContextMenuContent>
      </ContextMenu>

    </>
  )
})
