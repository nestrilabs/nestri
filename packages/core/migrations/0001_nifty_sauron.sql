DROP INDEX "team_slug";--> statement-breakpoint
CREATE UNIQUE INDEX "slug" ON "team" USING btree ("slug");