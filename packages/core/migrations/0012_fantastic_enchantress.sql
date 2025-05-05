CREATE TABLE "machines" (
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
CREATE TABLE "members" (
	"id" char(30) NOT NULL,
	"team_id" char(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30),
	"steam_id" bigint,
	"role" text NOT NULL,
	CONSTRAINT "members_team_id_id_pk" PRIMARY KEY("team_id","id")
);
--> statement-breakpoint
CREATE TABLE "steam_account_credentials" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"refresh_token" text NOT NULL,
	"steam_id" bigint NOT NULL,
	"username" varchar(255) NOT NULL,
	CONSTRAINT "steam_account_credentials_steam_id_pk" PRIMARY KEY("steam_id"),
	CONSTRAINT "idx_steam_credentials_id" UNIQUE("steam_id")
);
--> statement-breakpoint
CREATE TABLE "steam_accounts" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_id" bigint NOT NULL,
	"user_id" char(30),
	"avatar_hash" varchar(255) NOT NULL,
	"persona_name" varchar(255) NOT NULL,
	"real_name" varchar(255) NOT NULL,
	"profile_url" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "steam_accounts_steam_id_pk" PRIMARY KEY("steam_id"),
	CONSTRAINT "idx_steam_steam_id" UNIQUE("steam_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"owner_id" char(30) NOT NULL,
	"invite_code" varchar(10) NOT NULL,
	"max_members" bigint NOT NULL,
	"machine_id" char(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"email" varchar(255) NOT NULL,
	"last_login" timestamp with time zone NOT NULL,
	"username" varchar(255) NOT NULL,
	"polar_customer_id" varchar(255),
	CONSTRAINT "idx_username" UNIQUE("username")
);
--> statement-breakpoint
DROP TABLE "friend" CASCADE;--> statement-breakpoint
DROP TABLE "steam_game_genre_relation" CASCADE;--> statement-breakpoint
DROP TABLE "steam_game_genre" CASCADE;--> statement-breakpoint
DROP TABLE "steam_game" CASCADE;--> statement-breakpoint
DROP TABLE "steam_library" CASCADE;--> statement-breakpoint
DROP TABLE "machine" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "steam_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "steam" CASCADE;--> statement-breakpoint
DROP TABLE "subscription" CASCADE;--> statement-breakpoint
DROP TABLE "team" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "steam_account_credentials" ADD CONSTRAINT "steam_account_credentials_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_accounts" ADD CONSTRAINT "steam_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_fingerprint" ON "machines" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_member_steam_id" ON "members" USING btree ("team_id","steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_email" ON "users" USING btree ("email");