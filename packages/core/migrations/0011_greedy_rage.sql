DROP INDEX "idx_steam_credentials_id";--> statement-breakpoint
ALTER TABLE "steam_credentials" ADD CONSTRAINT "idx_steam_credentials_id" UNIQUE("steam_id");