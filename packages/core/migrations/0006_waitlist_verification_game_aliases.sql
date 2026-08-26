CREATE TYPE "public"."verification_kind" AS ENUM('email');--> statement-breakpoint
CREATE TABLE "verification" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"kind" "verification_kind" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "waitlist_entry" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"email" text NOT NULL,
	"source" text DEFAULT 'machines' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "aliases" text;--> statement-breakpoint
ALTER TABLE "verification" ADD CONSTRAINT "verification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_user_kind_idx" ON "verification" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entry_email_unique" ON "waitlist_entry" USING btree ("email");--> statement-breakpoint
CREATE INDEX "waitlist_entry_source_idx" ON "waitlist_entry" USING btree ("source");