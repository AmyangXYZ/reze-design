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

/**
 * Whether this deployment has a database at all.
 *
 * A clone with no `.env.local` is a supported way to run this: the editor, the
 * libraries' built-in content and the whole render/export path need no server.
 * So importing this module must never throw — a thrown import is a 500 the caller
 * can't catch, and it fails `next build` while collecting page data. Routes check
 * this flag and answer with an honest empty result instead.
 */
export const hasDatabase = !!connectionString

// The POOLED endpoint: serverless invocations are many and short-lived, and the
// unpooled one runs out of connections. Migrations use the unpooled string.
// Constructing a Pool opens no socket, so this is free when there is nothing to
// connect to and nothing will ever query it.
export const db = drizzle(new Pool({ connectionString }), { schema })
export { schema }
