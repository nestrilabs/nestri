CREATE TYPE "public"."linked_account_provider" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "linked_account" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"provider" "linked_account_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"profile" jsonb
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"user_id" char(30) NOT NULL,
	"role" "linked_account_provider" DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" char(30) NOT NULL,
	"billing_email" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "team_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text
);
--> statement-breakpoint
ALTER TABLE "linked_account" ADD CONSTRAINT "linked_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_account_provider_unique" ON "linked_account" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "linked_account_user_idx" ON "linked_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "team_member" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_member_team_idx" ON "team_member" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_member_user_idx" ON "team_member" USING btree ("user_id");