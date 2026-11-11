// The timeline's outliner: every track in the scene as one tree, grouped by
// WHO it belongs to. The scene's own tracks (camera, music, effects worn by
// everyone) come first; then each character with her motion, her morphs, her
// visibility and materials, and the effects that are hers alone; then the
// props with their holds. Which character a track belongs to is the first
// thing the tree says, because it is the first thing an edit needs to know.
//
// Pure: the panel hands it what the scene holds and which rows are open, and
// draws what comes back. Row ids are paths, so an open set survives edits.

import { BONE_GROUPS } from "@/lib/animation"

export type RowKind =
  | "scene"
  | "camera"
  | "character"
  | "stage"
  | "stageModel"
  | "motion"
  | "group"
  | "bone"
  | "morphs"
  | "morph"
  | "visibility"
  | "model"
  | "materials"
  | "material"
  | "effects"
  | "effect"
  | "prop"
  | "parent"
  | "overlays"
  | "overlay"

export type TimelineRow = {
  id: string
  kind: RowKind
  depth: number
  label: string
  /** The character or prop it belongs to; null for the scene's own. */
  owner: string | null
  /** What it names inside its owner: a bone, a morph, a material, a bone
   *  group, an effect's uid. */
  ref?: string
  /** Open or closed when it has rows under it; absent when it has none. */
  open?: boolean
  /** Keys on this bone or morph, for the count beside its name. */
  count?: number
}

export type RowSource = {
  cast: {
    id: string
    name: string
    /** Her bones and morphs, as the outliner lists them. */
    bones: readonly string[]
    morphs: readonly string[]
    materials: readonly string[]
  }[]
  /** Stage models and the parts they shipped with, in scene order. They have
   *  no motion of their own: visibility, by model and by material. */
  stages: { id: string; name: string; part: boolean; materials: readonly string[] }[]
  props: { id: string; name: string }[]
  /** `cast`: whether its code reads the characters — their bones, their
   *  silhouettes. Such an effect is on someone and belongs to them; one that
   *  does not (rain, fog, the lens) is the scene's. */
  effects: { uid: string; name: string; models?: readonly string[]; cast: boolean; keyCount?: number }[]
  camera: boolean
  /** The pictures over the frame, lowest first. */
  overlays?: { id: string; name: string; keyCount?: number }[]
}

/** Whether an effect is on a character: it reads the cast and is aimed at
 *  her, or at everyone. */
export function effectOn(e: { models?: readonly string[]; cast: boolean }, modelId: string): boolean {
  return e.cast && (!e.models || e.models.includes(modelId))
}

/** Her bones, sorted into the named groups (head down, as authored),
 *  with whatever no group lists last under "Other". */
export function boneGroupsOf(keyed: readonly string[]): { name: string; bones: string[] }[] {
  const left = new Set(keyed)
  const out: { name: string; bones: string[] }[] = []
  for (const [name, members] of Object.entries(BONE_GROUPS)) {
    if (!members) continue
    const bones = members.filter((b) => left.has(b))
    for (const b of bones) left.delete(b)
    if (bones.length) out.push({ name, bones })
  }
  if (left.size) out.push({ name: "Other", bones: [...left] })
  return out
}

export const SCENE_ROW = "scene"
export const STAGE_ROW = "stage"
export const charRow = (id: string) => `char/${id}`
export const propRow = (id: string) => `prop/${id}`
export const OVERLAYS_ROW = "overlays"

/**
 * The rows on screen, in order.
 *
 * ONE SECTION OPEN AT A TIME — the scene, a character or a prop, named by
 * `section` — and the rest fold to their headings. The open section is also
 * whose tracks are being edited, so opening Makima is the per-character
 * switch. Inside it, `open` holds the rows expanded: her motion and her
 * visibility stay closed until asked, since a rig is a hundred bones and a
 * model a hundred materials.
 */
export function buildRows(src: RowSource, section: string | null, open: ReadonlySet<string>, labels: RowLabels): TimelineRow[] {
  const rows: TimelineRow[] = []
  const isOpen = (id: string) => open.has(id)

  // The scene: camera, music, the effects everyone wears.
  const sceneFx = src.effects.filter((e) => !e.cast)
  const sceneOpen = section === SCENE_ROW
  rows.push({ id: SCENE_ROW, kind: "scene", depth: 0, label: labels.scene, owner: null, open: sceneOpen })
  if (sceneOpen) {
    if (src.camera) rows.push({ id: "scene/camera", kind: "camera", depth: 1, label: labels.camera, owner: null })
    pushEffects(rows, "scene/fx", null, sceneFx, isOpen, labels)
  }

  for (const c of src.cast) {
    const id = charRow(c.id)
    const cOpen = section === id
    rows.push({ id, kind: "character", depth: 0, label: c.name, owner: c.id, open: cOpen })
    if (!cOpen) continue

    const motion = `${id}/motion`
    const groups = boneGroupsOf(c.bones)
    const mOpen = isOpen(motion)
    rows.push({ id: motion, kind: "motion", depth: 1, label: labels.motion, owner: c.id, ...(groups.length ? { open: mOpen } : {}) })
    if (mOpen) {
      for (const g of groups) {
        const gid = `${motion}/${g.name}`
        const gOpen = isOpen(gid)
        rows.push({ id: gid, kind: "group", depth: 2, label: labels.group(g.name), owner: c.id, ref: g.name, open: gOpen })
        if (gOpen) for (const b of g.bones) rows.push({ id: `${gid}/${b}`, kind: "bone", depth: 3, label: b, owner: c.id, ref: b })
      }
    }

    const morphs = `${id}/morphs`
    const fOpen = isOpen(morphs)
    rows.push({ id: morphs, kind: "morphs", depth: 1, label: labels.morphs, owner: c.id, ...(c.morphs.length ? { open: fOpen } : {}) })
    if (fOpen) for (const m of c.morphs) rows.push({ id: `${morphs}/${m}`, kind: "morph", depth: 2, label: m, owner: c.id, ref: m })

    pushEffects(rows, `${id}/fx`, c.id, src.effects.filter((e) => effectOn(e, c.id)), isOpen, labels)

    // Visibility: the whole model first, then her materials under a row of
    // their own — when she is on stage, and what she is wearing.
    const vis = `${id}/vis`
    const vOpen = isOpen(vis)
    rows.push({ id: vis, kind: "visibility", depth: 1, label: labels.visibility, owner: c.id, open: vOpen })
    if (vOpen) {
      rows.push({ id: `${vis}/model`, kind: "model", depth: 2, label: c.name, owner: c.id })
      if (c.materials.length) {
        const mats = `${vis}/mats`
        const mOpen = isOpen(mats)
        rows.push({ id: mats, kind: "materials", depth: 2, label: labels.materials, owner: c.id, open: mOpen })
        if (mOpen) for (const m of c.materials) rows.push({ id: `${mats}/${m}`, kind: "material", depth: 3, label: m, owner: c.id, ref: m })
      }
    }

  }

  // The stage: one section for every stage model, each its visibility, opening
  // to its materials.
  if (src.stages.length) {
    const sOpen = section === STAGE_ROW
    rows.push({ id: STAGE_ROW, kind: "stage", depth: 0, label: labels.stage, owner: null, open: sOpen })
    if (sOpen)
      for (const m of src.stages) {
        const id = `stage/${m.id}`
        const mOpen = isOpen(id)
        rows.push({ id, kind: "stageModel", depth: 1, label: m.name, owner: m.id, ...(m.materials.length ? { open: mOpen } : {}) })
        if (mOpen) for (const mat of m.materials) rows.push({ id: `${id}/${mat}`, kind: "material", depth: 2, label: mat, owner: m.id, ref: mat })
      }
  }

  // The overlays: one section, a row each, top of the stack first.
  if (src.overlays?.length) {
    const oOpen = section === OVERLAYS_ROW
    rows.push({ id: OVERLAYS_ROW, kind: "overlays", depth: 0, label: labels.overlays, owner: null, open: oOpen })
    if (oOpen)
      for (const o of [...src.overlays].reverse())
        rows.push({ id: `${OVERLAYS_ROW}/${o.id}`, kind: "overlay", depth: 1, label: o.name, owner: null, ref: o.id, ...(o.keyCount ? { count: o.keyCount } : {}) })
  }

  for (const p of src.props) {
    const id = propRow(p.id)
    const pOpen = section === id
    rows.push({ id, kind: "prop", depth: 0, label: p.name, owner: p.id, open: pOpen })
    if (pOpen) rows.push({ id: `${id}/parent`, kind: "parent", depth: 1, label: labels.parent, owner: p.id })
  }
  return rows
}

/** A section's effects, under one row of their own that opens to list them —
 *  the scene's, or the character effects the dock has her ticked in. None, no
 *  row. */
function pushEffects(
  rows: TimelineRow[],
  id: string,
  owner: string | null,
  effects: RowSource["effects"],
  isOpen: (id: string) => boolean,
  labels: RowLabels,
) {
  if (effects.length === 0) return
  const open = isOpen(id)
  rows.push({ id, kind: "effects", depth: 1, label: labels.effects, owner, open })
  if (open)
    for (const e of effects) rows.push({ id: `fx/${e.uid}`, kind: "effect", depth: 2, label: e.name, owner, ref: e.uid, ...(e.keyCount ? { count: e.keyCount } : {}) })
}

export type RowLabels = {
  scene: string
  stage: string
  camera: string
  motion: string
  morphs: string
  visibility: string
  parent: string
  effects: string
  materials: string
  overlays: string
  group: (name: string) => string
}

/** Whether a row is a section heading: the scene, a character, a prop. */
export const isSection = (row: TimelineRow) => row.depth === 0

/** A row inside the open section opened or closed. Sections are not in this
 *  set: opening one is choosing `section`, which folds the one before. */
export function toggleRow(open: ReadonlySet<string>, row: TimelineRow): Set<string> {
  const next = new Set(open)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  return next
}

/**
 * A character effect copied to another character: an independent copy aimed
 * at her alone — same dials, curves and clips to start from — right after the
 * original. If the original was on her too she leaves it, so she is never
 * drawn twice. The copy comes back without a uid, so the list's own stamping
 * gives it one.
 */
export function copyEffectTo<T extends { uid?: string; models?: string[] }>(list: readonly T[], uid: string, to: string, castIds: readonly string[]): T[] {
  const at = list.findIndex((e) => e.uid === uid)
  if (at < 0) return [...list]
  const original = list[at]
  const { uid: _uid, ...body } = original
  void _uid
  const on = original.models ?? [...castIds]
  const next = [...list]
  if (on.includes(to)) next[at] = { ...original, models: on.filter((m) => m !== to) }
  next.splice(at + 1, 0, { ...body, models: [to] } as T)
  return next
}

/**
 * A character effect moved from one character to another: she leaves it and
 * the other joins. Aimed at the whole cast afterwards, it goes back to
 * everyone (no list), as an effect nobody aimed reads.
 */
export function moveEffectTo<T extends { uid?: string; models?: string[] }>(list: readonly T[], uid: string, from: string, to: string, castIds: readonly string[]): T[] {
  return list.map((e) => {
    if (e.uid !== uid) return e
    const models = [...new Set([...(e.models ?? castIds).filter((m) => m !== from), to])]
    if (castIds.every((c) => models.includes(c))) {
      const { models: _m, ...body } = e
      void _m
      return body as T
    }
    return { ...e, models }
  })
}
