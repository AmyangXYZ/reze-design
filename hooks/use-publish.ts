"use client"

// Publishing a PRESET — a grade, a background effect, a shader graph.
//
// Distinct from sharing a scene: a preset is pure data, so it needs no asset
// upload and publishes in one request. Shared across the three editors so they
// behave identically rather than each growing its own version.

import { useState } from "react"
import { useSession } from "@/lib/auth-client"
import type { LibraryKind } from "@/lib/library"

export function usePublish(kind: Exclude<LibraryKind, "scene">) {
  const { data: session } = useSession()
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)
  const [failed, setFailed] = useState(false)

  const publish = async (name: string, payload: unknown, extra?: { description?: string; tags?: string[] }) => {
    if (!session || publishing) return
    setPublishing(true)
    setFailed(false)
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name, payload, ...extra }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setPublished(true)
      // Long enough to register, short enough that the button returns to being
      // usable — publishing again after an edit is normal.
      setTimeout(() => setPublished(false), 2000)
    } catch {
      setFailed(true)
    } finally {
      setPublishing(false)
    }
  }

  return { signedIn: !!session, publishing, published, failed, publish }
}
