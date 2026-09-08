CREATE TABLE "export_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date DEFAULT now() NOT NULL,
	"aspect" text NOT NULL,
	"quality" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"look" text NOT NULL,
	"models" text[] DEFAULT '{}' NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"graphs" text[] DEFAULT '{}' NOT NULL,
	"grade_id" text,
	"grade_intensity" real
);
--> statement-breakpoint
ALTER TABLE "library_items" ADD COLUMN "export_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "export_stats_day_idx" ON "export_stats" USING btree ("day");