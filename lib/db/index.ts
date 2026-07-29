import "server-only"

// Drizzle over Neon's serverless driver.
//
// The WebSocket pool rather than the HTTP driver: HTTP is faster for one-shot
// queries but can't do transactions, and publishing (write the item, bump the
// counter) needs them — as does better-auth's adapter.

import { Pool, neonConfig } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-serverless"
import ws from "ws"
import * as authSchema from "./auth-schema"
import * as libSchema from "./schema"

const schema = { ...libSchema, ...authSchema }

// Node has no global WebSocket in every runtime the app might run under.
neonConfig.webSocketConstructor = ws

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is not set — run `vercel env pull .env.local`")

// The POOLED endpoint: serverless invocations are many and short-lived, and the
// unpooled one runs out of connections. Migrations use the unpooled string.
export const db = drizzle(new Pool({ connectionString }), { schema })
export { schema }
