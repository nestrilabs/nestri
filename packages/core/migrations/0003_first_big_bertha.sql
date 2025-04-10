CREATE TABLE "machine" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"country" text NOT NULL,
	"timezone" text NOT NULL,
	"location" "point" NOT NULL,
	"fingerprint" varchar(32) NOT NULL,
	"country_code" varchar(2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "steam" RENAME COLUMN "country" TO "country_code";--> statement-breakpoint
DROP INDEX "global_steam_email";--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "time_seen" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "steam_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "last_game" json NOT NULL;--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "steam_email" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "limitation" json NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_fingerprint" ON "machine" USING btree ("fingerprint");--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "flags";