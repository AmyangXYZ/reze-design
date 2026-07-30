"use client"

// Local drafts for one library, merged with its built-ins.
//
// One hook for all three kinds so grades, effects and shader graphs behave
// identically — the inconsistency between them was the original complaint.
// Backed by a subscription rather than per-instance state: a draft created in
// the library dialog is immediately visible to the page's quick-pick, and to
// grade resolution, which looks drafts up by name.

import { useCallback, useMemo, useSyncExternalStore } from "react"
import {
  createDraft,
  draftsStore,
  loadDrafts,
  removeDraft,
  updateDraft,
  type DraftKind,
  type DraftPayload,
} from "@/lib/drafts"
import type { LibraryItem } from "@/lib/library"

/** Generic on the item type so each library gets its own narrowed kind back —
 *  drafts are stored untyped but a grade library only ever sees grades. */
export function useDrafts<T extends LibraryItem = LibraryItem>(kind: DraftKind) {
  const version = useSyncExternalStore(draftsStore.subscribe, draftsStore.getVersion, () => 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drafts = useMemo(() => loadDrafts()[kind] as T[], [kind, version])

  return {
    drafts,
    create: useCallback(
      (opts: { name: string; payload: DraftPayload; author: string; description?: string; tags?: string[] }) =>
        createDraft(kind, opts) as T,
      [kind],
    ),
    update: useCallback((id: string, patch: Partial<LibraryItem>) => updateDraft(kind, id, patch), [kind]),
    remove: useCallback((id: string) => removeDraft(kind, id), [kind]),
  }
}
