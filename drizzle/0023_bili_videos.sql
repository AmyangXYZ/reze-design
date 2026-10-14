CREATE TABLE "bili_videos" (
	"bvid" text PRIMARY KEY NOT NULL,
	"aid" bigint NOT NULL,
	"mid" bigint NOT NULL,
	"author" text NOT NULL,
	"title" text NOT NULL,
	"published" timestamp NOT NULL,
	"found_at" timestamp DEFAULT now() NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"favorites" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"danmaku" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"counted_at" timestamp DEFAULT now() NOT NULL
);
