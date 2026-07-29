import "server-only"

// Public handles. Lowercase and unique, because they end up in URLs
// (reze.design/<user>/<scene>) and as the author on everything published.

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"

export const USERNAME_MIN = 3
export const USERNAME_MAX = 24
/** Letters, digits, dash, underscore — nothing needing URL escaping. */
const SHAPE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/

/** Reserved so a handle can never shadow a route. */
const RESERVED = new Set([
  "api", "gallery", "library", "admin", "settings", "login", "logout", "signin", "signout",
  "new", "about", "help", "docs", "static", "assets", "public", "me", "you", "user", "scene",
])

export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX)
}

export function validate(name: string): string | null {
  if (name.length < USERNAME_MIN) return "too-short"
  if (name.length > USERNAME_MAX) return "too-long"
  if (!SHAPE.test(name)) return "bad-shape"
  if (RESERVED.has(name)) return "reserved"
  return null
}

export async function isTaken(name: string, exceptUserId?: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.username, name)).limit(1)
  return rows.length > 0 && rows[0].id !== exceptUserId
}

/** A free handle derived from whatever the provider gave us, with a numeric
 *  suffix when the obvious one is taken. Never derived from the email local part
 *  alone if a display name exists — emails leak more than people expect. */
export async function suggest(from: string): Promise<string> {
  const base = normalize(from) || "artist"
  const seed = base.length < USERNAME_MIN ? `${base}-artist`.slice(0, USERNAME_MAX) : base
  if (!validate(seed) && !(await isTaken(seed))) return seed
  for (let n = 2; n < 1000; n++) {
    const candidate = `${seed.slice(0, USERNAME_MAX - String(n).length - 1)}-${n}`
    if (!validate(candidate) && !(await isTaken(candidate))) return candidate
  }
  return `artist-${crypto.randomUUID().slice(0, 8)}`
}
