ALTER TABLE "base_games" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "base_games" ADD COLUMN "links" text[];