CREATE TABLE "friend" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"steam_id" bigint NOT NULL,
	"friend_steam_id" bigint NOT NULL,
	CONSTRAINT "friend_steam_id_friend_steam_id_pk" PRIMARY KEY("steam_id","friend_steam_id")
);
--> statement-breakpoint
CREATE TABLE "steam_game_genre_relation" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"game_id" bigint NOT NULL,
	"genre_id" varchar(255) NOT NULL,
	CONSTRAINT "steam_game_genre_relation_game_id_genre_id_pk" PRIMARY KEY("game_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "steam_game_genre" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	CONSTRAINT "steam_game_genre_id_pk" PRIMARY KEY("id"),
	CONSTRAINT "idx_game_genre" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "steam_game" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"name" text NOT NULL,
	"is_free" boolean NOT NULL,
	"website_url" text NOT NULL,
	"legal_notice" text NOT NULL,
	"description" text NOT NULL,
	"release_date" timestamp with time zone NOT NULL,
	"native_linux" boolean NOT NULL,
	"app_id" bigint NOT NULL,
	"achievements" json NOT NULL,
	"is_single_player" boolean NOT NULL,
	"supports_steamcloud" boolean NOT NULL,
	"supports_familysharing" boolean NOT NULL,
	"reviews" text NOT NULL,
	"pegi" json NOT NULL,
	"proton_compatibility" bigint NOT NULL,
	"controller_support" varchar(255) NOT NULL,
	"system_requirement" json NOT NULL,
	"publishers" json NOT NULL,
	"developers" json NOT NULL,
	CONSTRAINT "steam_game_app_id_pk" PRIMARY KEY("app_id"),
	CONSTRAINT "idx_game_appid" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "steam_library" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"game_id" bigint NOT NULL,
	"steam_id" bigint NOT NULL,
	CONSTRAINT "steam_library_game_id_steam_id_pk" PRIMARY KEY("game_id","steam_id")
);
--> statement-breakpoint
CREATE TABLE "steam_credentials" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"refresh_token" text NOT NULL,
	"steam_id" bigint NOT NULL,
	"username" varchar(255) NOT NULL,
	CONSTRAINT "steam_credentials_steam_id_pk" PRIMARY KEY("steam_id")
);
--> statement-breakpoint
ALTER TABLE "steam" RENAME COLUMN "avatar_url" TO "profile_url";--> statement-breakpoint
DROP INDEX "steam_id";--> statement-breakpoint
DROP INDEX "steam_user_id";--> statement-breakpoint
ALTER TABLE "steam" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "steam" ALTER COLUMN "steam_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "steam" ADD CONSTRAINT "steam_steam_id_user_id_pk" PRIMARY KEY("steam_id","user_id");--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "avatar_hash" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "steam" ADD COLUMN "real_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "friend" ADD CONSTRAINT "friend_steam_id_steam_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend" ADD CONSTRAINT "friend_friend_steam_id_steam_steam_id_fk" FOREIGN KEY ("friend_steam_id") REFERENCES "public"."steam"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_game_genre_relation" ADD CONSTRAINT "steam_game_genre_relation_game_id_steam_game_app_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."steam_game"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_game_genre_relation" ADD CONSTRAINT "steam_game_genre_relation_genre_id_steam_game_genre_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."steam_game_genre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_library" ADD CONSTRAINT "steam_library_game_id_steam_game_app_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."steam_game"("app_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_library" ADD CONSTRAINT "steam_library_steam_id_steam_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam_credentials" ADD CONSTRAINT "steam_credentials_steam_id_steam_steam_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam"("steam_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_steam_credentials_id" ON "steam_credentials" USING btree ("steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_name_discriminator" ON "user" USING btree ("name","discriminator");--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "last_seen";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "last_game";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "country_code";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "steam_email";--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "limitation";--> statement-breakpoint
ALTER TABLE "steam" ADD CONSTRAINT "idx_steam_steam_id" UNIQUE("steam_id");