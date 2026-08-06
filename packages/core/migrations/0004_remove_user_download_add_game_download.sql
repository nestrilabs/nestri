CREATE TYPE "public"."game_download_status" AS ENUM('pending', 'verifying', 'downloading', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "game_download" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"host_id" text NOT NULL,
	"game_id" char(30) NOT NULL,
	"status" "game_download_status" DEFAULT 'pending' NOT NULL,
	"progress_bytes" bigint DEFAULT 0,
	"total_bytes" bigint,
	"time_started" timestamp with time zone,
	"time_completed" timestamp with time zone,
	"error_message" text
);--> statement-breakpoint
ALTER TABLE "game_download" ADD CONSTRAINT "game_download_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_download_host_game_unique" ON "game_download" USING btree ("host_id","game_id");--> statement-breakpoint
CREATE INDEX "game_download_game_idx" ON "game_download" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_download_host_status_idx" ON "game_download" USING btree ("host_id","status");--> statement-breakpoint
DROP TABLE "user_download";--> statement-breakpoint
DROP TYPE "public"."download_status";
