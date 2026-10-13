CREATE TABLE "anime_mappings" (
	"anilist_id" integer PRIMARY KEY NOT NULL,
	"tmdb_id" integer,
	"tvdb_id" integer,
	"imdb_id" text,
	"media_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "anime_mappings_tmdb_idx" ON "anime_mappings" USING btree ("tmdb_id");--> statement-breakpoint
CREATE INDEX "anime_mappings_tvdb_idx" ON "anime_mappings" USING btree ("tvdb_id");--> statement-breakpoint
CREATE INDEX "anime_mappings_imdb_idx" ON "anime_mappings" USING btree ("imdb_id");