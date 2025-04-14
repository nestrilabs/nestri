ALTER TABLE "steam" RENAME COLUMN "time_seen" TO "last_seen";--> statement-breakpoint
DROP INDEX "steam_email";--> statement-breakpoint
ALTER TABLE "steam" DROP CONSTRAINT "steam_user_id_id_pk";--> statement-breakpoint
ALTER TABLE "steam" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_user_id_id_pk" PRIMARY KEY("user_id","id");--> statement-breakpoint
ALTER TABLE "machine" ADD COLUMN "user_id" char(30);--> statement-breakpoint
ALTER TABLE "steam" ADD CONSTRAINT "steam_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "steam" DROP COLUMN "email";