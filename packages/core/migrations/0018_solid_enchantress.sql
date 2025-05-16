ALTER TABLE "public"."images" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."image_type";--> statement-breakpoint
CREATE TYPE "public"."image_type" AS ENUM('heroArt', 'icon', 'logo', 'banner', 'poster', 'boxArt', 'screenshot', 'backdrop');--> statement-breakpoint
ALTER TABLE "public"."images" ALTER COLUMN "type" SET DATA TYPE "public"."image_type" USING "type"::"public"."image_type";