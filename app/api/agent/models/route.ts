// The models a person's own key can use, for the AI panel's model picker.
// The key passes through and is never stored or logged.

import { gate } from "@/lib/ai/gate"
import { routeOf } from "@/lib/ai/providers"
import type { Via } from "@/lib/ai/providers/presets"

export async function POST(request: Request) {
  const g = await gate(request)
  if (!g.ok) return Response.json({ error: g.error }, { status: g.status })
  const body = (await request.json().catch(() => ({}))) as { via?: Partial<Via> }
  const route = routeOf(body.via ?? {}, false)
  if ("error" in route) return Response.json({ error: route.error }, { status: 400 })
  try {
    const models = await route.provider.models(route.target)
    return Response.json({ models: [...new Set(models)].sort() })
  } catch (e) {
    const status = (e as { status?: number }).status
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: status === 401 || status === 403 ? 401 : 502 })
  }
}
