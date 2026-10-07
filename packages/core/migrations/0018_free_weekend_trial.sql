CREATE TABLE "trial_claim" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30),
	"user_id" char(30),
	"email" text NOT NULL,
	"steam_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_claim" ADD CONSTRAINT "trial_claim_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claim" ADD CONSTRAINT "trial_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claim_email_unique" ON "trial_claim" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claim_steam_unique" ON "trial_claim" USING btree ("steam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claim_team_unique" ON "trial_claim" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "trial_claim_user_idx" ON "trial_claim" USING btree ("user_id");