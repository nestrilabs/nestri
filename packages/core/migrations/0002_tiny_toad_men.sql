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
CREATE UNIQUE INDEX "machine_fingerprint" ON "machine" USING btree ("fingerprint");