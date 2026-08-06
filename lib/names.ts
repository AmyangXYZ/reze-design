// What a kind is already called — one list, three libraries.
//
// A name is the human key: the quick switch matches a group to a library row by
// name, and applying one looks it up by name. So the namespace is the WHOLE
// kind — built-ins, published community work, and your own drafts — and every
// place that accepts a typed name has to ask the same question of the same list.
// Asking three slightly different questions is how one name came to mean two
// things depending on which list you were looking at.

import { BACKGROUND_EFFECTS } from "@/lib/background-effects"
import { GRADE_PRESETS } from "@/lib/grade"
import { GRAPH_LIBRARY } from "@/lib/materials"
import { communityItems } from "@/hooks/use-community"
import { loadDrafts, nextDraftName, type DraftKind } from "@/lib/drafts"
import { conflictingName, type LibraryItem } from "@/lib/library"

const BUILTINS: Record<DraftKind, LibraryItem[]> = {
  grade: GRADE_PRESETS,
  effect: BACKGROUND_EFFECTS,
  graph: GRAPH_LIBRARY,
}

/**
 * A free name for a LOCAL DRAFT — the default a save dialog offers.
 *
 * Only the draft itself may keep its name, because only the draft is the thing
 * being written. Editing anything else — a built-in, someone's published work,
 * or your OWN published work — produces a local copy first, and a local copy
 * answering to the same name as the row it came from is exactly the duplicate
 * this rule exists to prevent: two entries, one name, and no way to tell which
 * the quick switch means.
 *
 * Suffixing is for suggestions only; it is never applied to a name someone typed.
 */
export function freeName(kind: DraftKind, wanted: string, draftId?: string): string {
  return nextDraftName(wanted, [
    ...BUILTINS[kind].map((i) => i.name),
    ...communityItems(kind).map((i) => i.name),
    ...loadDrafts()[kind].filter((d) => d.id !== draftId).map((d) => d.name),
  ])
}

/**
 * What publishing under `wanted` would collide with, if anything.
 *
 * Every draft is publishable; a name already spoken for is the one thing that
 * stops it, and the dialog says which thing. Two rows, one name, is the state
 * the library must never reach — the editor picks a look BY name.
 *
 * Local drafts are not consulted. Publishing PROMOTES the draft into the row it
 * is about to write, so it cannot collide with itself, and no two drafts of a
 * kind share a name anyway. `itemId` is the row being written — republishing
 * your own item under its own name writes that item's next version, and a row is
 * not a collision with itself.
 *
 * The server applies the same rule (lib/db/names.ts) and is the one that counts;
 * this is so the answer arrives while the name is still being typed.
 */
export function publishClash(kind: DraftKind, wanted: string, itemId?: string): string | undefined {
  return conflictingName(wanted, [
    ...BUILTINS[kind].filter((i) => i.id !== itemId).map((i) => i.name),
    ...communityItems(kind).filter((i) => i.id !== itemId).map((i) => i.name),
  ])
}
