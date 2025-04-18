CREATE UNIQUE INDEX "steam_id" ON "steam" USING btree ("steam_id");--> statement-breakpoint
CREATE INDEX "steam_user_id" ON "steam" USING btree ("user_id");