import "server-only"

// better-auth, running on our own functions against our own Postgres.
//
// A library rather than a service: the tables live in our schema, so `owner_id`
// on library_items points at a row we control. That is the piece worth keeping
// portable — every published item references a user, so identity is the most
// expensive thing to migrate later.

import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { eq } from "drizzle-orm"
import { APIError } from "better-auth/api"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { suggest } from "@/lib/username"

/** Only register a provider whose credentials actually exist, so a clone without
 *  OAuth secrets still boots and can use email + password. */
function social(id: "google" | "github") {
  const clientId = process.env[`${id.toUpperCase()}_CLIENT_ID`]
  const clientSecret = process.env[`${id.toUpperCase()}_CLIENT_SECRET`]
  return clientId && clientSecret ? { [id]: { clientId, clientSecret } } : {}
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Derived from the request when unset, which breaks OAuth callbacks — they need
  // an absolute redirect URI that matches what the provider has registered.
  baseURL: process.env.BETTER_AUTH_URL,
  // Social only. Both providers verify email ownership themselves, which removes
  // two features we would otherwise owe every user — email verification and
  // password reset — along with the mail provider both of them need.
  emailAndPassword: { enabled: false },
  socialProviders: { ...social("google"), ...social("github") },
  account: {
    // Same email through Google and GitHub is the same person, not two accounts.
    // Safe here because both providers verify email ownership themselves.
    accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
  },
  user: {
    additionalFields: {
      banned: { type: "boolean", required: false, input: false },
      usernameChangedAt: { type: "date", required: false, input: false },
      // Assigned by the hook below, never accepted from the client — claiming a
      // handle goes through /api/username so it can be validated and checked.
      username: { type: "string", required: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Enforced at session creation, so a ban takes effect at the next sign-in
        // rather than only at the routes that remember to check.
        before: async (session) => {
          const [u] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, session.userId)).limit(1)
          if (u?.banned) throw new APIError("FORBIDDEN", { message: "This account is suspended." })
          return { data: session }
        },
      },
    },
    user: {
      create: {
        // Everyone gets a handle immediately, so nothing published is ever
        // authored by an email address or an empty string.
        // Derived from the EMAIL LOCAL PART, never the provider's display name:
        // Google hands us people's real names, and an artist publishing under
        // their legal name because of a default is a bad thing to do to them.
        // The local part is usually already a handle, and it is never shown.
        before: async (u) => ({ data: { ...u, username: await suggest(u.email.split("@")[0]) } }),
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
