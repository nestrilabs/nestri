ALTER TABLE "public"."categories" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "public"."games" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."category_type";--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('tag', 'genre', 'publisher', 'developer', 'categorie', 'franchise');--> statement-breakpoint
ALTER TABLE "public"."categories" ALTER COLUMN "type" SET DATA TYPE "public"."category_type" USING "type"::"public"."category_type";--> statement-breakpoint
ALTER TABLE "public"."games" ALTER COLUMN "type" SET DATA TYPE "public"."category_type" USING "type"::"public"."category_type";