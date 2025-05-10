CREATE TYPE "public"."compatibility" AS ENUM('high', 'mid', 'low', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('tag', 'genre', 'publisher', 'developer');--> statement-breakpoint
CREATE TYPE "public"."image_type" AS ENUM('heroArt', 'icon', 'logo', 'superHeroArt', 'poster', 'boxArt', 'screenshot', 'background');--> statement-breakpoint
CREATE TABLE "base_games" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"release_date" timestamp with time zone NOT NULL,
	"size" json NOT NULL,
	"description" text NOT NULL,
	"primary_genre" text NOT NULL,
	"controller_support" text,
	"compatibility" "compatibility" DEFAULT 'unknown' NOT NULL,
	"score" numeric(2, 1) NOT NULL,
	CONSTRAINT "idx_base_games_slug" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"slug" varchar(255) NOT NULL,
	"type" "category_type" NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_slug_type_pk" PRIMARY KEY("slug","type")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"base_game_id" varchar(255) NOT NULL,
	"category_slug" varchar(255) NOT NULL,
	"type" "category_type" NOT NULL,
	CONSTRAINT "games_base_game_id_category_slug_type_pk" PRIMARY KEY("base_game_id","category_slug","type")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"type" "image_type" NOT NULL,
	"image_hash" varchar(255) NOT NULL,
	"base_game_id" varchar(255) NOT NULL,
	"source_url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"file_size" integer NOT NULL,
	"dimensions" json NOT NULL,
	"extracted_color" json NOT NULL,
	CONSTRAINT "images_image_hash_type_base_game_id_position_pk" PRIMARY KEY("image_hash","type","base_game_id","position")
);
--> statement-breakpoint
CREATE TABLE "game_libraries" (
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"base_game_id" varchar(255) NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	CONSTRAINT "game_libraries_base_game_id_owner_id_pk" PRIMARY KEY("base_game_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "steam_accounts" RENAME COLUMN "steam_id" TO "id";--> statement-breakpoint
ALTER TABLE "steam_account_credentials" DROP CONSTRAINT "steam_account_credentials_steam_id_steam_accounts_steam_id_fk";
--> statement-breakpoint
ALTER TABLE "friends_list" DROP CONSTRAINT "friends_list_steam_id_steam_accounts_steam_id_fk";
--> statement-breakpoint
ALTER TABLE "friends_list" DROP CONSTRAINT "friends_list_friend_steam_id_steam_accounts_steam_id_fk";
--> statement-breakpoint
ALTER TABLE "members" DROP CONSTRAINT "members_steam_id_steam_accounts_steam_id_fk";
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_base_game_id_base_games_id_fk" FOREIGN KEY ("base_game_id") REFERENCES "public"."base_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_categories_fkey" FOREIGN KEY ("category_slug","type") REFERENCES "public"."categories"("slug","type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_base_game_id_base_games_id_fk" FOREIGN KEY ("base_game_id") REFERENCES "public"."base_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD CONSTRAINT "game_libraries_base_game_id_base_games_id_fk" FOREIGN KEY ("base_game_id") REFERENCES "public"."base_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_libraries" ADD CONSTRAINT "game_libraries_owner_id_steam_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_categories_type" ON "categories" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_games_category_slug" ON "games" USING btree ("category_slug");--> statement-breakpoint
CREATE INDEX "idx_games_category_type" ON "games" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_images_type" ON "images" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_images_game_id" ON "images" USING btree ("base_game_id");--> statement-breakpoint
CREATE INDEX "idx_game_libraries_owner_id" ON "game_libraries" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "steam_account_credentials" ADD CONSTRAINT "steam_account_credentials_steam_id_steam_accounts_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_list" ADD CONSTRAINT "friends_list_steam_id_steam_accounts_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends_list" ADD CONSTRAINT "friends_list_friend_steam_id_steam_accounts_id_fk" FOREIGN KEY ("friend_steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_steam_id_steam_accounts_id_fk" FOREIGN KEY ("steam_id") REFERENCES "public"."steam_accounts"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "idx_friends_list_friend_steam_id" ON "friends_list" USING btree ("friend_steam_id");