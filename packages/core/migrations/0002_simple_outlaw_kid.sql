CREATE TABLE "steam" (
	"id" char(30) NOT NULL,
	"user_id" char(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"avatar_url" text NOT NULL,
	"access_token" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"country" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"persona_name" varchar(255) NOT NULL,
	CONSTRAINT "steam_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE INDEX "global_steam_email" ON "steam" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "steam_email" ON "steam" USING btree ("user_id","email");