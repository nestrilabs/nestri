CREATE TABLE "member" (
	"id" char(30) NOT NULL,
	"team_id" char(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"time_seen" timestamp with time zone,
	"email" varchar(255) NOT NULL,
	CONSTRAINT "member_team_id_id_pk" PRIMARY KEY("team_id","id")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"plan_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"avatar_url" text,
	"name" varchar(255) NOT NULL,
	"discriminator" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"polar_customer_id" varchar(255),
	"flags" json DEFAULT '{}'::json,
	CONSTRAINT "user_polar_customer_id_unique" UNIQUE("polar_customer_id")
);
--> statement-breakpoint
CREATE INDEX "email_global" ON "member" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "member_email" ON "member" USING btree ("team_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "team_slug" ON "team" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email" ON "user" USING btree ("email");