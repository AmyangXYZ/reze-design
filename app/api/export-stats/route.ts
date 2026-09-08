// What a finished video was made of, from a browser that opted in.
//
// Unauthenticated on purpose: exporting works logged out, and that is the common
// case, so requiring a session would measure only the minority who happen to be
// signed in. Nothing about the caller is read — not the session, not the address
// — and nothing about them is stored. The row is the scene's ingredients and a
// date. See lib/export-stats for the rule about what travels.
//
// The threat worth defending is COST, not vanity. An open endpoint that writes to
// Neon is a way to hold the compute awake, and awake hours are what the bill is
// made of — so every rejection below happens before a connection is opened, and a
// malformed body costs a JSON parse and nothing else.

import { NextResponse } from "next/server"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, schema, hasDatabase } from "@/lib/db"
import { MAX_EFFECTS, MAX_GRAPHS, MAX_MODELS } from "@/lib/export-stats"

const ASPECTS = ["16:9", "9:16", "2.39:1", "1:1", "4:3"]
const QUALITIES = ["1080p", "1440p", "4k"]

/** Nothing here is worth an error message. A client that gets this wrong is not
 *  a user with a problem to solve — it is a bug of ours or somebody poking. */
const OK = new NextResponse(null, { status: 204 })

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null

const strs = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.slice(0, cap).filter((s): s is string => typeof s === "string" && s.length <= 200) : []

const dim = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 8192 ? v : null

export async function POST(request: Request) {
  if (!hasDatabase) return OK

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return OK

  // Enums first, and they are the real guard: three string comparisons reject
  // anything hand-rolled before the database is touched at all.
  const aspect = str(body.aspect, 16)
  const quality = str(body.quality, 16)
  if (!aspect || !ASPECTS.includes(aspect) || !quality || !QUALITIES.includes(quality)) return OK

  const width = dim(body.width)
  const height = dim(body.height)
  const look = str(body.look, 32)
  if (!width || !height || !look) return OK

  const models = strs(body.models, MAX_MODELS)
  const graphs = strs(body.graphs, MAX_GRAPHS)
  const effects = Array.isArray(body.effects)
    ? body.effects
        .slice(0, MAX_EFFECTS)
        .flatMap((e) => {
          const id = str((e as { id?: unknown })?.id)
          if (!id) return []
          const params = (e as { params?: unknown }).params
          const keep = params && typeof params === "object" && !Array.isArray(params) ? params : undefined
          return [{ id, ...(keep ? { params: keep as Record<string, unknown> } : {}) }]
        })
    : []

  const gradeId = str(body.gradeId ?? (body.grade as { id?: unknown } | null)?.id)
  const rawIntensity = (body.grade as { intensity?: unknown } | null)?.intensity ?? body.gradeIntensity
  const gradeIntensity =
    typeof rawIntensity === "number" && Number.isFinite(rawIntensity) ? Math.max(0, Math.min(4, rawIntensity)) : null

  await db.insert(schema.exportStats).values({
    id: crypto.randomUUID(),
    aspect,
    quality,
    width,
    height,
    look,
    models,
    effects,
    graphs,
    gradeId,
    gradeIntensity,
  })

  // The counters the library reads. PUBLIC items only: a private item's tally is
  // visible to nobody, and refusing to move it means the open endpoint cannot be
  // used to inflate something before it is published. Ids that name nothing match
  // nothing, so garbage costs one indexed lookup.
  const touched = [...new Set([...effects.map((e) => e.id), ...graphs, ...(gradeId ? [gradeId] : [])])]
  if (touched.length > 0) {
    await db
      .update(schema.libraryItems)
      .set({ exportCount: sql`${schema.libraryItems.exportCount} + 1` })
      .where(and(inArray(schema.libraryItems.id, touched), eq(schema.libraryItems.visibility, "public")))
  }

  return OK
}
