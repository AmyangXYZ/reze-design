"use client"

// One place that turns a fetch into something the reader is told about.
//
// The libraries and the gallery all mutate the same way — PATCH a row, DELETE a
// row — and all of them used to end in `res.ok && applyIt()`. That is three
// separate silences: a refusal said nothing, a network failure said nothing,
// and a success said nothing either, so the only signal that anything had
// happened was the list changing under you, which is also exactly what a failed
// action looks like.
//
// Returning a BOOLEAN rather than throwing keeps the call sites flat: the
// common shape is "tell the reader, and update local state only if it worked",
// and a try/catch around every rename to express that would bury it.

import { useCallback } from "react"
import { toast } from "sonner"
import { apiError, type ApiErrorCode } from "@/lib/api-error"
import { useT } from "@/lib/i18n"

export function useReport() {
  const t = useT()

  return useCallback(
    async (run: Promise<Response>, success: string): Promise<boolean> => {
      const label: Record<ApiErrorCode, string> = {
        "name-taken": t.library.errNameTaken,
        "cannot-unpublish": t.library.errCannotUnpublish,
        "private-uses": t.library.errPrivateUses,
        unknown: t.library.errUnknown,
      }
      let res: Response
      try {
        res = await run
      } catch {
        // Offline, DNS, a dropped connection — distinct from a refusal, and
        // worth saying so: nothing is wrong with what you asked for.
        toast.error(t.library.errOffline)
        return false
      }
      if (res.ok) {
        toast.success(success)
        return true
      }
      const e = await apiError(res)
      toast.error(label[e.code], e.detail ? { description: e.detail } : undefined)
      return false
    },
    [t],
  )
}
