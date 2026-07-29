import { config } from "dotenv"
import type { Config } from "drizzle-kit"

// drizzle-kit runs outside Next, so it doesn't pick up .env.local on its own.
config({ path: ".env.local" })

export default {
  schema: ["./lib/db/schema.ts", "./lib/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  // UNPOOLED: migrations need a real session, which the pooler can't give them.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
} satisfies Config
