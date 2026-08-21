"use client"

// Materials panel — a VSCode-explorer-style tree over style groups (materials that share

import { memo, useEffect, useMemo, useRef, useState } from "react"
import type { StyleGroup } from "reze-engine"
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, FolderPlus, Pencil, Trash2, Workflow } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { QuickPick } from "@/components/scene/quick-pick"
import { GRAPH_LIBRARY, groupLabel, sameGraphLook } from "@/lib/materials"
import { communityQuickPickItems, quickPickItems, type GraphItem } from "@/lib/library"
import { useCommunity } from "@/hooks/use-community"
import { useDrafts } from "@/hooks/use-drafts"
import type { MaterialRow } from "@/hooks/use-engine"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const UNGROUPED = "\0ungrouped" // sentinel collapse-key / drop-target id for "no group"

// The engine's stock graph, shown as plain "Default"
const ENGINE_DEFAULT_GRAPH = "Principled BSDF"

// Eye/Hair own the special render classes
const isProtected = (g: StyleGroup) => g.renderClass === "eye" || g.renderClass === "hair"

// A compact tooltip'd icon button — the shared vocabulary for row + toolbar actions.
function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  side = "bottom",
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  danger?: boolean
  side?: "top" | "bottom"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10",
            danger ? "hover:text-red-400" : "hover:text-foreground",
            "disabled:opacity-30 disabled:hover:bg-transparent",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

// What the ONE shared context menu is pointed at.
type MenuTarget = { kind: "material"; name: string; groupId: string | null } | { kind: "group"; id: string }

// Memoized: the dock keeps tabs MOUNTED (see useKeepAlive in editor/dock.tsx)
export const MaterialsPanel = memo(function MaterialsPanel({
  modelTabs,
  onSelectModel,
  materials,
  groups,
  activeGroupId,
  onHover,
  onToggleVisible,
  onOpenLibrary,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onEditGroupGraph,
  onMoveMaterial,
  onPickGraph,
  dense,
}: {
  /** All loaded models — the strip only renders with 2+. The panel body always shows the ACTIVE */
  modelTabs: { id: string; file: string; active: boolean }[]
  onSelectModel: (id: string) => void
  materials: MaterialRow[]
  groups: StyleGroup[]
  /** The group the graph editor is currently bound */
  activeGroupId: string | null
  /** Hover a material to highlight it on the model (null clears). */
  onHover: (name: string | null) => void
  onToggleVisible: (name: string) => void
  /** Open the shader-graph library for a style group (browse / apply / edit its
   *  graph). Optional: a host without the library hides the door; the per-group
   *  QuickPick still assigns looks. */
  onOpenLibrary?: (groupId: string | null) => void
  /** Creates the group and returns its id — the panel opens rename mode on it. */
  onCreateGroup: () => string
  onRenameGroup: (id: string, label: string) => void
  onDeleteGroup: (id: string) => void
  /** Open the node-graph editor on a group's shader graph. Optional — hosts
   *  without the floating editor hide the edit affordances. */
  onEditGroupGraph?: (id: string) => void
  /** Reassign a material to a group (target=null → ungroup). */
  onMoveMaterial: (material: string, targetId: string | null) => void
  /** Apply a library shader graph to a style group by name */
  onPickGraph: (groupId: string, graphName: string) => void
  /** Trim the outer vertical padding. The default 3.5 rhythm exists to line the
   *  panel up with the Scene tab inside the dock; a panel that is a surface of
   *  its own already has the header's rule and its own rounded edge doing that
   *  work, and the full gutter reads as slack. */
  dense?: boolean
  /** Discard hand-made grouping and re-derive it from the scene document. */
}) {
  const t = useT()
  // On touch devices HTML5-draggable rows swallow swipes (drag starts instead of
  // scroll). Read at init — this panel only ever renders inside a mounted dock.
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
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

  // Every library graph, flat — the quick-switch list beside the full browser.
  // Community belongs here as much as it does for grades and effects; it was
  // simply never wired, so published graphs were invisible outside the browser.
  const graphDrafts = useDrafts<GraphItem>("graph").drafts
  const communityGraphs = useCommunity<GraphItem>("graph")
  const graphItems = useMemo(
    () => [
      ...quickPickItems(GRAPH_LIBRARY, graphDrafts, null).map((e) => ({
        id: e.name,
        label: e.name,
        section: e.owner === "local" ? ("local" as const) : ("builtin" as const),
      })),
      ...communityQuickPickItems(communityGraphs),
    ],
    [graphDrafts, communityGraphs],
  )
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
  const itemsForGroup = (g: StyleGroup) => {
    // The applied graph is always present — a selector that cannot show what is
    // selected is broken. Listed as local, not community: what falls through
    // here is a look carried by the scene, which the editor adopts as a draft,
    // and calling someone's unpublished work "community" was simply wrong.
    const base = graphItems.some((i) => i.id === g.graph.name)
      ? graphItems
      : [...graphItems, { id: g.graph.name, label: g.graph.name, section: "local" as const }]
    return editedGroups.has(g.id) ? base.map((i) => (i.id === g.graph.name ? { ...i, hint: t.scene.edited } : i)) : base
  }

  const byName = useMemo(() => new Map(materials.map((m) => [m.name, m])), [materials])
  const grouped = useMemo(() => new Set(groups.flatMap((g) => g.materials)), [groups])
  const ungrouped = useMemo(
    () => materials.filter((m) => !grouped.has(m.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [materials, grouped],
  )
  // Materials within a group render alphabetically, so a drop lands in a deterministic spot
  const sortedNames = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  // Display order: alphabetical by name.
  const libraryTarget = groups.some((g) => g.id === activeGroupId) ? activeGroupId : null
  const ordered = useMemo(
    () => [...groups].sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), undefined, { sensitivity: "base" })),
    [groups],
  )

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const endDrag = () => {
    setDragMat(null)
    setDropTarget(null)
  }
  const onDropTo = (targetId: string | null) => {
    if (dragMat) onMoveMaterial(dragMat, targetId)
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
          "group/row flex h-6 cursor-grab items-center gap-1.5 rounded pr-0.5 pl-1 transition-colors hover:bg-white/[0.05] active:cursor-grabbing",
          !m.visible && "opacity-45",
          dragMat === m.name && "opacity-40",
        )}
        onMouseEnter={() => onHover(m.name)}
        onMouseLeave={() => onHover(null)}
      >
        <Circle className="size-1.5 shrink-0 fill-current text-muted-foreground/60" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-hover/row:text-foreground">{m.name}</span>
        <button
          className={cn("shrink-0 text-muted-foreground hover:text-foreground", m.visible && "opacity-0 group-hover/row:opacity-100")}
          onClick={(e) => {
            e.stopPropagation()
            onToggleVisible(m.name)
          }}
        >
          {m.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
      </div>
    )
  }

  return (
    <>
      {/* ── Model strip (multi-model scenes): which model this panel edits ── */}
      {modelTabs.length > 1 && (
        <div className={cn("flex flex-wrap gap-1 px-4", dense ? "pt-2" : "pt-3.5")}>
          {modelTabs.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelectModel(m.id)}
              className={cn(
                "max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                m.active
                  ? "border-blue-400/40 bg-blue-400/10 text-foreground"
                  : "border-white/10 text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
              title={m.file}
            >
              {m.file.replace(/\.pmx$/i, "")}
            </button>
          ))}
        </div>
      )}
      {/* ── Section toolbar (VSCode explorer header): title + create/collapse ── */}
      {/* Same px-4 gutter and 3.5 vertical rhythm as the Scene tab, so the two panels line up */}
      <div
        className={cn("flex items-center gap-0.5 px-4", modelTabs.length > 1 ? "pt-1.5" : dense ? "pt-2" : "pt-3.5")}
      >
        {/* Same type as the Scene tab's Section titles */}
        <span className="shrink-0 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{t.materials.styleGroups}</span>
        {/* VSCode-style: a fresh group goes straight into rename mode (the row mounts this same */}
        {/* Create sits WITH the title it acts */}
        <IconAction icon={FolderPlus} label={t.materials.newGroup} onClick={() => setRenaming(onCreateGroup())} />
        <span className="flex-1" />
        {/* Library at the right end, matching Grade and Background. */}
        {onOpenLibrary && (
        <button
          onClick={() => onOpenLibrary(libraryTarget)}
          className="ml-1 flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-zinc-900 transition-colors hover:bg-white/90 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
        >
          <Workflow className="size-3.5" />
          {t.lab.cmd.graphLib}
        </button>
        )}
      </div>

      {/* Scrollable, but scrollbar hidden (wheel/trackpad scroll works) so rows can sit close */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-2",
              dense ? "pb-2" : "pb-3.5",
            )}
            onMouseLeave={() => onHover(null)}
            onContextMenuCapture={(e) => {
              if (!(e.target as HTMLElement).closest("[data-ctx]")) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
          >
          {ordered.map((g) => {
            const open = !collapsed.has(g.id)
            const isActive = activeGroupId === g.id
            const isDrop = dropTarget === g.id
            return (
              <div key={g.id} className={cn("rounded", isDrop && "ring-1 ring-blue-400/50 ring-inset")} {...dropZone(g.id, g.id)}>
                {/* Group row — single-click selects/deselects; chevron toggles collapse */}
                <div
                  data-ctx="row"
                  className={cn(
                    "group/hdr flex h-6 cursor-pointer items-center gap-1 rounded pr-0.5 transition-colors",
                    isActive ? "bg-blue-400/[0.1]" : "hover:bg-white/[0.04]",
                  )}
                  onClick={() => toggleCollapse(g.id)}
                  onContextMenu={() => setMenuTarget({ kind: "group", id: g.id })}
                >
                      <button
                        className="flex h-full shrink-0 items-center px-0.5 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation() // chevron only collapses; don't toggle selection
                          toggleCollapse(g.id)
                        }}
                      >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>

                      {renaming === g.id ? (
                        <Input
                          ref={renameRef}
                          defaultValue={groupLabel(g)}
                          className="h-5 min-w-0 flex-1 border-white/10 bg-white/5 px-1 text-xs font-medium md:text-xs"
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            onRenameGroup(g.id, e.target.value)
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
                            "min-w-0 flex-1 truncate text-xs font-medium",
                            isActive ? "text-blue-400" : "text-foreground",
                          )}
                        >
                          {groupLabel(g)}
                        </span>
                      )}

                      {/* The group's shader graph, switchable in place. */}
                      <span
                        className="flex min-w-0 max-w-[58%] justify-end"
                        // Reaching for the graph shouldn't fold the group away.
                        onClick={(e) => e.stopPropagation()}
                      >
                        <QuickPick
                          value={g.graph.name}
                          label={g.graph.name === ENGINE_DEFAULT_GRAPH ? t.materials.defaultGraph : undefined}
                          items={itemsForGroup(g)}
                          onPick={(name) => onPickGraph(g.id, name)}
                          onBrowse={onOpenLibrary ? () => onOpenLibrary(g.id) : undefined}
                          onEdit={onEditGroupGraph ? () => onEditGroupGraph(g.id) : undefined}
                          placeholder={g.graph.name}
                        />
                      </span>
                </div>

                {/* ── Children (indent guide) ── */}
                {open && (
                  <div className="ml-[10px] border-l border-white/[0.06] pl-1">
                    {sortedNames(g.materials).map((name, i) => {
                      const m = byName.get(name)
                      return m ? materialRow(m, g.id, name + "#" + i) : null
                    })}
                    {g.materials.length === 0 && (
                      <div className="px-2 py-1 pl-3 text-xs text-muted-foreground/60 italic">{t.materials.dragHere}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Ungrouped section ── */}
          {ungrouped.length > 0 && (
            <div
              className={cn("mt-0.5 rounded", dropTarget === UNGROUPED && "ring-1 ring-blue-400/50 ring-inset")}
              {...dropZone(UNGROUPED, null)}
            >
              <div
                className={cn(
                  "group/hdr flex h-6 cursor-pointer items-center gap-1 rounded pr-0.5 transition-colors",
                  "hover:bg-white/[0.04]",
                )}
                onClick={() => toggleCollapse(UNGROUPED)}
              >
                <button
                  className="flex h-full shrink-0 items-center px-0.5 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapse(UNGROUPED)
                  }}
                >
                  {collapsed.has(UNGROUPED) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs font-medium",
                    activeGroupId === UNGROUPED ? "text-blue-400" : "text-muted-foreground group-hover/hdr:text-foreground",
                  )}
                >
                  {t.materials.ungrouped}
                </span>
              </div>
              {!collapsed.has(UNGROUPED) && (
                <div className="ml-[10px] border-l border-white/[0.06] pl-1">{ungrouped.map((m, i) => materialRow(m, null, m.name + "#" + i))}</div>
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
              return (
                <>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>{t.materials.moveTo}</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {ordered
                        .filter((g) => g.id !== menuTarget.groupId)
                        .map((g) => (
                          <ContextMenuItem key={g.id} onSelect={() => onMoveMaterial(menuTarget.name, g.id)}>
                            {groupLabel(g)}
                          </ContextMenuItem>
                        ))}
                      {menuTarget.groupId && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => onMoveMaterial(menuTarget.name, null)}>{t.materials.ungrouped}</ContextMenuItem>
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
