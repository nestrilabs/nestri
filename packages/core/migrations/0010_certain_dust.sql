CREATE TYPE "public"."member_role" AS ENUM('child', 'adult');--> statement-breakpoint
CREATE TYPE "public"."steam_status" AS ENUM('online', 'offline', 'dnd', 'playing');--> statement-breakpoint
CREATE TABLE "steam_account_credentials" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_id" varchar(255) PRIMARY KEY NOT NULL,
	"refresh_token" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"username" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friends_list" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_id" varchar(255) NOT NULL,
	"friend_steam_id" varchar(255) NOT NULL,
	CONSTRAINT "friends_list_steam_id_friend_steam_id_pk" PRIMARY KEY("steam_id","friend_steam_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" char(30) NOT NULL,
	"team_id" char(30) NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30),
	"steam_id" varchar(255) NOT NULL,
	"role" "member_role" NOT NULL,
	CONSTRAINT "members_id_team_id_pk" PRIMARY KEY("id","team_id")
);
--> statement-breakpoint
CREATE TABLE "steam_accounts" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" char(30),
	"status" "steam_status" NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"real_name" varchar(255),
	"member_since" timestamp with time zone NOT NULL,
	"name" varchar(255) NOT NULL,
	"profile_url" varchar(255),
	"username" varchar(255) NOT NULL,
	"avatar_hash" varchar(255) NOT NULL,
	"limitations" json NOT NULL,
	CONSTRAINT "idx_steam_username" UNIQUE("username")
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
	"slug" varchar(255) NOT NULL,
	"max_members" bigint NOT NULL,
	CONSTRAINT "idx_team_invite_code" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"email" varchar(255) NOT NULL,
	"avatar_url" text,
	"last_login" timestamp with time zone NOT NULL,
	"name" varchar(255) NOT NULL,
	"polar_customer_id" varchar(255),
	CONSTRAINT "idx_user_email" UNIQUE("email")
);
--> statement-breakpoint
DROP TABLE "machine" CASCADE;--> statement-breakpoint
DROP TABLE "member" CASCADE;--> statement-breakpoint
DROP TABLE "steam" CASCADE;--> statement-breakpoint
DROP TABLE "subscription" CASCADE;--> statement-breakpoint
DROP TABLE "team" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
ALTER TABLE "steam_account_credentials" ADD CONSTRAINT "steam_account_credentials_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_list" ADD CONSTRAINT "friends_list_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_list" ADD CONSTRAINT "friends_list_friend_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("friend_steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_steam_id_steam_accounts_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("steam_id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "steam_accounts" ADD CONSTRAINT "steam_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_slug_steam_accounts_username_fk" FOREIGN KEY ("slug") REFERENCES "public"."steam_accounts"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_member_steam_id" ON "members" USING btree ("team_id","steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_member_user_id" ON "members" USING btree ("team_id","user_id") WHERE "members"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_team_slug" ON "teams" USING btree ("slug");