CREATE TYPE "public"."depot_status" AS ENUM('pending', 'downloading', 'complete', 'error', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."download_status" AS ENUM('pending', 'downloading', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "game_depot" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"game_id" char(30) NOT NULL,
	"depot_id" integer NOT NULL,
	"branch" text DEFAULT 'public' NOT NULL,
	"steam_manifest_id" text,
	"steam_build_id" integer,
	"installed_manifest_id" text,
	"installed_build_id" integer,
	"size_download" bigint,
	"size_on_disk" bigint,
	"status" "depot_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"oslist" text
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_app_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"short_description" text,
	"description" text,
	"developers" jsonb,
	"publishers" jsonb,
	"primary_genre" text,
	"genres" jsonb,
	"categories" jsonb,
	"oslist" jsonb,
	"size_download" bigint,
	"size_on_disk" bigint,
	"controller_support" text,
	"steam_deck_compat" text,
	"review_score_percent" smallint,
	"review_count" integer,
	"metacritic_score" smallint,
	"steam_change_number" integer,
	"public_build_id" integer,
	"release_date_utc" timestamp with time zone,
	"time_enriched" timestamp with time zone,
	CONSTRAINT "game_steam_app_id_unique" UNIQUE("steam_app_id")
);
--> statement-breakpoint
CREATE TABLE "user_download" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"game_id" char(30) NOT NULL,
	"status" "download_status" DEFAULT 'pending' NOT NULL,
	"progress_bytes" bigint DEFAULT 0,
	"total_bytes" bigint,
	"time_started" timestamp with time zone,
	"time_completed" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "user_library" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"game_id" char(30) NOT NULL,
	"playtime_2w" integer,
	"playtime_forever" integer,
	"last_played" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "linked_account" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "team_member" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "team_member" ALTER COLUMN "role" SET DATA TYPE "public"."team_member_role" USING "role"::text::"public"."team_member_role";--> statement-breakpoint
ALTER TABLE "team_member" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
DROP TYPE "public"."linked_account_provider";--> statement-breakpoint
CREATE TYPE "public"."linked_account_provider" AS ENUM('steam', 'ssh', 'discord');--> statement-breakpoint
ALTER TABLE "linked_account" ALTER COLUMN "provider" SET DATA TYPE "public"."linked_account_provider" USING "provider"::"public"."linked_account_provider";--> statement-breakpoint
ALTER TABLE "game_depot" ADD CONSTRAINT "game_depot_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_download" ADD CONSTRAINT "user_download_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_download" ADD CONSTRAINT "user_download_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_depot_unique" ON "game_depot" USING btree ("game_id","depot_id","branch");--> statement-breakpoint
CREATE INDEX "game_depot_game_idx" ON "game_depot" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_depot_updates_idx" ON "game_depot" USING btree ("game_id") WHERE "game_depot"."installed_manifest_id" is distinct from "game_depot"."steam_manifest_id";--> statement-breakpoint
CREATE UNIQUE INDEX "game_slug_unique" ON "game" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "game_app_id_unique" ON "game" USING btree ("steam_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_download_user_game_unique" ON "user_download" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "user_download_user_status_idx" ON "user_download" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_library_user_game_unique" ON "user_library" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "user_library_user_idx" ON "user_library" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_library_game_idx" ON "user_library" USING btree ("game_id");