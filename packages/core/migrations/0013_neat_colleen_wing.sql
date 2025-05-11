CREATE TYPE "public"."controller_support" AS ENUM('full', 'unknown');--> statement-breakpoint
ALTER TABLE "base_games" ALTER COLUMN "controller_support" SET DATA TYPE controller_support;--> statement-breakpoint
ALTER TABLE "base_games" ALTER COLUMN "controller_support" SET NOT NULL;