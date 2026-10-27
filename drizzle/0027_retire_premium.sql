DROP TABLE "ai_usage" CASCADE;--> statement-breakpoint
DROP TABLE "export_stats" CASCADE;--> statement-breakpoint
ALTER TABLE "library_items" DROP COLUMN "nsfw";--> statement-breakpoint
ALTER TABLE "library_items" DROP COLUMN "export_count";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "plan";