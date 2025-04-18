ALTER TABLE "subscription" ADD CONSTRAINT "subscription_id_team_id_pk" PRIMARY KEY("id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_id" ON "subscription" USING btree ("id");--> statement-breakpoint
CREATE INDEX "subscription_user_id" ON "subscription" USING btree ("user_id");