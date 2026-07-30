CREATE TABLE "library_item_versions" (
	"item_id" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"changelog" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_item_versions_item_id_version_pk" PRIMARY KEY("item_id","version")
);
--> statement-breakpoint
CREATE TABLE "moderation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"item_id" text NOT NULL,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_uses" (
	"scene_id" text NOT NULL,
	"item_id" text NOT NULL,
	"item_version" integer NOT NULL,
	CONSTRAINT "scene_uses_scene_id_item_id_pk" PRIMARY KEY("scene_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "credits" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "forked_from_id" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "bundle_key" text;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "bundle_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "library_item_versions" ADD CONSTRAINT "library_item_versions_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_uses" ADD CONSTRAINT "scene_uses_scene_id_library_items_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_uses" ADD CONSTRAINT "scene_uses_item_id_library_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."library_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_uses_item_idx" ON "scene_uses" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "library_items" ADD CONSTRAINT "library_items_forked_from_id_library_items_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."library_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_items_new_idx" ON "library_items" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "library_items_top_idx" ON "library_items" USING btree ("kind","like_count");