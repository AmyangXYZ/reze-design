import "server-only"

// Who can moderate.
//
// An env var rather than a column: no migration, no bootstrap problem (the first
// admin has to come from somewhere), and it can change without a deploy. If roles
// ever need to be richer than yes/no, that's the point to move it into the table.

import { auth } from "@/lib/auth"

const ADMINS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMINS.has(email.toLowerCase())
}

/**
 * The session if it belongs to an admin, otherwise null. Every admin route must
 * call this — hiding the UI is not access control.
 */
export async function requireAdmin(headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) return null
  // Matching an UNVERIFIED address would let anyone who can claim the string
  // become an admin. Social sign-in always verifies, so this is belt-and-braces
  // against a future provider that doesn't.
  if (!session.user.emailVerified) return null
  return isAdminEmail(session.user.email) ? session : null
}
