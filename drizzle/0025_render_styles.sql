CREATE TABLE "render_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"name_zh" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"staging" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_styles_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
ALTER TABLE "render_styles" ADD CONSTRAINT "render_styles_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
