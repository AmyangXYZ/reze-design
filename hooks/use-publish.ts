"use client"

// Publishing a PRESET — a grade, a background effect, a shader graph.
//
// Distinct from sharing a scene: a preset is pure data, so it needs no asset
// upload and publishes in one request. Shared across the three editors so they
// behave identically rather than each growing its own version.

import { useState } from "react"
import { useSession } from "@/lib/auth-client"
import type { LibraryItem, LibraryKind } from "@/lib/library"

export function usePublish(kind: Exclude<LibraryKind, "scene">) {
  const { data: session } = useSession()
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [failed, setFailed] = useState(false)

  const [nameTaken, setNameTaken] = useState(false)

  /** Resolves with the created row, or null on failure. */
  const publish = async (
    name: string,
    payload: unknown,
    extra?: { description?: string; tags?: string[]; id?: string; forkedFromId?: string },
  ): Promise<LibraryItem | null> => {
    if (!session || publishing) return null
    setPublishing(true)
    setFailed(false)
    setNameTaken(false)
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name, payload, ...extra }),
      })
      if (res.status === 409) {
        setNameTaken(true)
        return null
      }
      if (!res.ok) throw new Error(String(res.status))
      const { item } = (await res.json()) as { item: LibraryItem }
      setPublished(true)
      // Long enough to register, short enough that the button returns to being
      // usable — publishing again after an edit is normal.
      setTimeout(() => setPublished(false), 2000)
      return item
    } catch {
      setFailed(true)
      return null
    } finally {
      setPublishing(false)
    }
  }

  return { signedIn: !!session, publishing, published, failed, nameTaken, publish }
}
