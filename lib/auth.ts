import "server-only"

// better-auth, running on our own functions against our own Postgres.
//
// A library rather than a service: the tables live in our schema, so `owner_id`
// on library_items points at a row we control. That is the piece worth keeping
// portable — every published item references a user, so identity is the most
// expensive thing to migrate later.

import { betterAuth } from "better-auth"
import { emailOTP } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { and, count, eq, gt, lt } from "drizzle-orm"
import { APIError, createAuthMiddleware, getIp } from "better-auth/api"
import { db } from "@/lib/db"
import { user, verification } from "@/lib/db/auth-schema"
import { suggest } from "@/lib/username"
import { sendSignInCode } from "@/lib/mail"

/** Only register a provider whose credentials actually exist, so a clone without
 *  OAuth secrets still boots and can use email + password. */
function social(id: "google" | "github") {
  const clientId = process.env[`${id.toUpperCase()}_CLIENT_ID`]
  const clientSecret = process.env[`${id.toUpperCase()}_CLIENT_SECRET`]
  return clientId && clientSecret ? { [id]: { clientId, clientSecret } } : {}
}

const CODE_COOLDOWN_MS = 60_000
const CODES_PER_IP_PER_HOUR = 10

/** Limits on sending a sign-in code, kept in the database because each serverless
 *  instance has its own memory — better-auth's built-in limiter is per instance.
 *  Only this one path touches the table, so session checks stay off the database.
 *  Per email: one code a minute, so nobody can flood an inbox. Per IP: ten an
 *  hour, so one script cannot spend the day's send quota on strangers. */
const limitCodeSends = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/email-otp/send-verification-otp") return
  const email = String(ctx.body?.email ?? "").toLowerCase()
  const now = new Date()

  // better-auth replaces this row on every send, so it dates the last one.
  const [last] = await db
    .select({ createdAt: verification.createdAt })
    .from(verification)
    .where(eq(verification.identifier, `sign-in-otp-${email}`))
    .limit(1)
  if (last && now.getTime() - last.createdAt.getTime() < CODE_COOLDOWN_MS) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "Wait a minute before asking for another code." })
  }

  const req = ctx.request ?? ctx.headers
  const ip = req ? getIp(req, ctx.context.options) : null
  if (!ip) return
  const key = `otp-ip:${ip}`
  await db.delete(verification).where(and(eq(verification.identifier, key), lt(verification.expiresAt, now)))
  const [{ n }] = await db
    .select({ n: count() })
    .from(verification)
    .where(and(eq(verification.identifier, key), gt(verification.expiresAt, now)))
  if (n >= CODES_PER_IP_PER_HOUR) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes from this network. Try again later." })
  }
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: key,
    value: "",
    expiresAt: new Date(now.getTime() + 3_600_000),
  })
})

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Derived from the request when unset, which breaks OAuth callbacks — they need
  // an absolute redirect URI that matches what the provider has registered.
  baseURL: process.env.BETTER_AUTH_URL,
  // No passwords. Google and GitHub verify email ownership themselves, and the
  // emailed code is itself the proof of ownership, so we owe no verification
  // flow and no password reset. The code reaches people Google and GitHub
  // cannot — mainland China, where both are blocked.
  emailAndPassword: { enabled: false },
  socialProviders: { ...social("google"), ...social("github") },
  plugins: process.env.RESEND_API_KEY
    ? [
        emailOTP({
          otpLength: 6,
          expiresIn: 600,
          // A code rather than a link: mail opened on a phone or in WeChat's
          // browser lands in a different cookie jar than the tab that asked, and
          // link-scanning mail gateways spend a one-time link before the person does.
          // In the language the site was showing: the dialog sends it along,
          // and a bare request falls back to the browser's own preference.
          sendVerificationOTP: async ({ email, otp, type }, ctx) => {
            if (type !== "sign-in") return
            const h = ctx?.headers
            const lang = h?.get("x-reze-locale") ?? h?.get("accept-language") ?? ""
            await sendSignInCode(email, otp, lang.toLowerCase().startsWith("zh") ? "zh" : "en")
          },
        }),
      ]
    : [],
  account: {
    // One email is one person, however they arrive. Safe because every one of
    // these proves the address before we see it.
    accountLinking: { enabled: true, trustedProviders: ["google", "github", "email-otp"] },
  },
  // The signed-in session rides in a signed cookie for five minutes, so the
  // session check every page makes reads the cookie instead of the database. A
  // ban or a revoked session reaches an open tab when that cookie expires.
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  user: {
    additionalFields: {
      banned: { type: "boolean", required: false, input: false },
      usernameChangedAt: { type: "date", required: false, input: false },
      // Assigned by the hook below, never accepted from the client — claiming a
      // handle goes through /api/username so it can be validated and checked.
      username: { type: "string", required: false, input: false },
    },
  },
  hooks: { before: limitCodeSends },
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
        // An all-digit one is a QQ number or a phone number — an identifier,
        // never a handle — so it gets a generic name to replace.
        before: async (u) => {
          const local = u.email.split("@")[0]
          return { data: { ...u, username: await suggest(/^\d+$/.test(local) ? "artist" : local) } }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
