// The database side of the content envelope.
//
// One table for every kind — grades, shader graphs, background effects and
// published scenes — because they differ only by `kind` and what sits in
// `payload`. That means one publish path, one permissions model, and a gallery
// that is a filtered query rather than a fourth code path.
//
// Built-ins are NOT here. They ship in content/*.json so a clone runs with no
// database; this table holds only what users publish. Their ids can't collide
// (built-in ids are hand-written, user ids generated), so the two merge at read
// time with no seeding step and no dedup.

import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import type { EffectPayload, GradePayload, GraphPayload, LibraryKind, ScenePayload } from "@/lib/library"
import { user } from "./auth-schema"

export type LibraryPayload = GradePayload | GraphPayload | EffectPayload | ScenePayload

/** `unlisted` is link-only: reachable by anyone holding the URL, absent from the
 *  gallery. That is what a "share this scene" link produces. */
export type Visibility = "private" | "unlisted" | "public"

export const libraryItems = pgTable(
  "library_items",
  {
    // ── Snapshot fields ──────────────────────────────────────────────────────
    // These travel inside scene documents, so their shape is frozen once scenes
    // are shared. Keep them identical to LibraryItem in lib/library.ts.
    id: text("id").primaryKey(),
    kind: text("kind").$type<LibraryKind>().notNull(),
    name: text("name").notNull(),
    /** Denormalised so rendering a snapshot needs no join. */
    author: text("author").notNull(),
    description: text("description").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    version: integer("version").notNull().default(1),
    payload: jsonb("payload").$type<LibraryPayload>().notNull(),

    // ── Server-only ──────────────────────────────────────────────────────────
    // Never leaves the database, so these can change freely.
    /** Deleting an account keeps its published items but orphans them, rather
     *  than silently breaking every scene that references one. */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    visibility: text("visibility").$type<Visibility>().notNull().default("private"),
    likeCount: integer("like_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The NAME is the human key — scene documents reference library content by it,
    // so it must be unique per kind. Ids stay machine-minted and opaque.
    uniqueIndex("library_items_kind_name_idx").on(t.kind, t.name),
    // The library browses by kind, and the gallery by kind within what's public.
    index("library_items_kind_visibility_idx").on(t.kind, t.visibility),
    // "Yours" — every item a user owns, newest first.
    index("library_items_owner_idx").on(t.ownerId, t.createdAt),
  ],
)

/**
 * Who liked what. The composite primary key IS the uniqueness rule — one like per
 * person per item, enforced by the database rather than by whoever remembers to
 * check. `library_items.like_count` is a denormalised cache of this, kept in step
 * inside the same transaction as the insert or delete.
 */
export const likes = pgTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemId] }),
    // "What has this person liked" — their own list, newest first.
    index("likes_user_idx").on(t.userId, t.createdAt),
  ],
)
