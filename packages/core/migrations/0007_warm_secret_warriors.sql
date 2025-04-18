CREATE TABLE "subscription" (
	"id" char(30) NOT NULL,
	"user_id" char(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"standing" text NOT NULL,
	"plan_type" text NOT NULL,
	"tokens" integer NOT NULL,
	"product_id" varchar(255),
	"subscription_id" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;