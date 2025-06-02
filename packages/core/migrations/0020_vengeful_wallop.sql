ALTER TABLE "steam_account_credentials" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "steam_account_credentials" CASCADE;--> statement-breakpoint
ALTER TABLE "game_libraries" RENAME COLUMN "owner_id" TO "owner_steam_id";--> statement-breakpoint
ALTER TABLE "teams" RENAME COLUMN "owner_id" TO "owner_steam_id";--> statement-breakpoint
ALTER TABLE "steam_accounts" DROP CONSTRAINT "idx_steam_username";--> statement-breakpoint
ALTER TABLE "game_libraries" DROP CONSTRAINT "game_libraries_owner_id_steam_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "teams" DROP CONSTRAINT "teams_slug_steam_accounts_username_fk";
--> statement-breakpoint
DROP INDEX "idx_team_slug";--> statement-breakpoint
DROP INDEX "idx_game_libraries_owner_id";--> statement-breakpoint
ALTER TABLE "game_libraries" DROP CONSTRAINT "game_libraries_base_game_id_owner_id_pk";--> statement-breakpoint
ALTER TABLE "game_libraries" ALTER COLUMN "last_played" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD CONSTRAINT "game_libraries_base_game_id_owner_steam_id_pk" PRIMARY KEY("base_game_id","owner_steam_id");--> statement-breakpoint
ALTER TABLE "game_libraries" ADD CONSTRAINT "game_libraries_owner_steam_id_steam_accounts_id_fk" FOREIGN KEY ("owner_steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_steam_id_steam_accounts_id_fk" FOREIGN KEY ("owner_steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_game_libraries_owner_id" ON "game_libraries" USING btree ("owner_steam_id");--> statement-breakpoint
ALTER TABLE "game_libraries" DROP COLUMN "time_acquired";--> statement-breakpoint
ALTER TABLE "game_libraries" DROP COLUMN "is_family_shared";--> statement-breakpoint
ALTER TABLE "steam_accounts" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN "slug";