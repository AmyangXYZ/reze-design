CREATE TABLE "library_items" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"author" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"owner_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "library_items_kind_visibility_idx" ON "library_items" USING btree ("kind","visibility");--> statement-breakpoint
CREATE INDEX "library_items_owner_idx" ON "library_items" USING btree ("owner_id","created_at");