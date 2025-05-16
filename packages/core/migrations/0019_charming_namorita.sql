/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'steam_account_credentials'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "steam_account_credentials" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "source_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "steam_account_credentials" ADD CONSTRAINT "steam_account_credentials_steam_id_id_pk" PRIMARY KEY("steam_id","id");--> statement-breakpoint
ALTER TABLE "steam_account_credentials" ADD COLUMN "id" char(30) NOT NULL;