// The database side of the content envelope.
//
// One table for every kind — grades, shader graphs, background effects and
// published scenes — because they differ only by `kind` and what sits in
// `payload`. That means one publish path, one permissions model, and a gallery
// that is a filtered query rather than a fourth code path.
//
// Built-ins are seeded here like anything else — they are simply presets authored
// by the admin account. They also ship in content/*.json, so a clone with no
// database still renders and a reference resolves offline; the uuid is the same on
// both sides, so the two merge with no dedup.

import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
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
    /** LATEST version number. Every value ever published is kept in
     *  library_item_versions; documents pin the exact one they used. */
    version: integer("version").notNull().default(1),
    /** The latest version's payload, denormalised so reading current content is
     *  one row rather than a join. Versions are the source of truth. */
    payload: jsonb("payload").$type<LibraryPayload>().notNull(),

    // ── Server-only ──────────────────────────────────────────────────────────
    // Never leaves the database, so these can change freely.
    /** Deleting an account keeps its published items but orphans them, rather
     *  than silently breaking every scene that references one. */
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    visibility: text("visibility").$type<Visibility>().notNull().default("private"),
    likeCount: integer("like_count").notNull().default(0),
    /** Scene page loads. Cheap counter — a raw event table can come later if the
     *  question ever gets more specific than "how many". */
    viewCount: integer("view_count").notNull().default(0),
    /** Published scenes using this preset, denormalised from scene_uses. */
    usageCount: integer("usage_count").notNull().default(0),

    // ── Scenes only ──────────────────────────────────────────────────────────
    /** 借物表 — free text, required at publish. A scene redistributes other
     *  people's models and motions; this is where that is acknowledged. */
    credits: text("credits").notNull().default(""),
    /** Derived from someone else's item — a scene opened from a share link, or a
     *  preset edited out of the library. Recorded automatically; there is no fork
     *  button, publishing IS the fork. */
    forkedFromId: text("forked_from_id").references((): AnyPgColumn => libraryItems.id, { onDelete: "set null" }),
    /** R2 object key and size of the asset bundle. Columns, not payload fields,
     *  because quotas and orphan cleanup are queries over them. */
    bundleKey: text("bundle_key"),
    bundleBytes: integer("bundle_bytes").notNull().default(0),

    /** Soft delete: the item leaves the library but its versions stay, so scenes
     *  already pinned to one keep rendering. Hard delete is moderation only. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unique per AUTHOR, not globally: scene documents only ever reference
    // built-in names (community content travels by value), so two artists both
    // publishing a "Neon" grade is fine — what would be confusing is one artist
    // owning two. Scenes are exempt entirely; their URLs use short ids.
    uniqueIndex("library_items_owner_kind_name_idx")
      .on(t.ownerId, t.kind, t.name)
      .where(sql`${t.kind} <> 'scene'`),
    // The library browses by kind, and the gallery by kind within what's public.
    index("library_items_kind_visibility_idx").on(t.kind, t.visibility),
    // "Yours" — every item a user owns, newest first.
    index("library_items_owner_idx").on(t.ownerId, t.createdAt),
    // The two orderable sorts. "Hot" is computed from like_count and age, so it
    // rides the same indexes rather than needing a stored score.
    index("library_items_new_idx").on(t.kind, t.createdAt),
    index("library_items_top_idx").on(t.kind, t.likeCount),
  ],
)

/**
 * Every value a preset has ever been published at, immutable once written.
 *
 * This is what lets a scene pin `{ id, version }` and render the same forever
 * while its author keeps iterating — npm's lesson, and the reason deleting an
 * item is a soft delete: the versions outlive it so dependent scenes survive.
 *
 * Scenes get no rows here. Nothing imports a scene, so there is nothing to pin.
 */
export const libraryItemVersions = pgTable(
  "library_item_versions",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    payload: jsonb("payload").$type<LibraryPayload>().notNull(),
    /** What changed, in the author's words. Optional — most edits are a tweak. */
    changelog: text("changelog"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.version] })],
)

/**
 * Which presets a published scene pins, extracted from its document at publish.
 *
 * Read both directions: "what does this scene use" (credits, attribution) and
 * "what uses this preset" (usage_count). Extracted rather than scanned out of
 * JSON at query time, which was ambiguous once names stopped being unique.
 */
export const sceneUses = pgTable(
  "scene_uses",
  {
    sceneId: text("scene_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    itemVersion: integer("item_version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sceneId, t.itemId] }),
    // "Which scenes use this preset", for the usage counter and the preset page.
    index("scene_uses_item_idx").on(t.itemId),
  ],
)

/**
 * Who removed what, and why. Moderation without a record is unaccountable — the
 * first disputed takedown is the one you wish you had logged.
 */
export const moderationLog = pgTable("moderation_log", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  /** Not a foreign key: the row survives the item it describes. */
  itemId: text("item_id").notNull(),
  action: text("action").$type<"soft_delete" | "hard_delete" | "restore" | "ban" | "unban">().notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

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
