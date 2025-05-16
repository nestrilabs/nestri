ALTER TABLE "game_libraries" ADD COLUMN "time_acquired" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD COLUMN "last_played" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD COLUMN "total_playtime" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD COLUMN "is_family_shared" boolean NOT NULL;