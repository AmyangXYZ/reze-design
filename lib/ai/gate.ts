// Who may reach a model through this server. Server only.

import { auth } from "@/lib/auth"
import { hasDatabase } from "@/lib/db"

/** Requests a minute, per account. A soft guard — memory is per instance —
 *  against a runaway loop, not a billing system. */
const PER_MINUTE = 40

const recent = new Map<string, number[]>()
export function overLimit(user: string): boolean {
  const now = Date.now()
  const hits = (recent.get(user) ?? []).filter((t) => now - t < 60_000)
  hits.push(now)
  recent.set(user, hits)
  return hits.length > PER_MINUTE
}

export type Gate = { ok: true; user: string; premium: boolean } | { ok: false; status: number; error: string }

/** Signed in — enough for your own connection; Premium on top for this
 *  server's key. Signing in is asked even for your own key because the
 *  request runs on this server, which must not be an open relay. A local dev
 *  server lets the developer through when it has no database, or when
 *  AGENT_DEV_OPEN=1 (for driving the editor headless); neither applies to a
 *  production build. */
export async function gate(request: Request): Promise<Gate> {
  if (process.env.NODE_ENV === "development" && process.env.AGENT_DEV_OPEN === "1") return { ok: true, user: "dev", premium: true }
  if (!hasDatabase) {
    return process.env.NODE_ENV === "development" ? { ok: true, user: "dev", premium: true } : { ok: false, status: 401, error: "unauthenticated" }
  }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return { ok: false, status: 401, error: "unauthenticated" }
  return { ok: true, user: session.user.id, premium: (session.user as { plan?: string }).plan === "premium" }
}

