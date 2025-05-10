ALTER TABLE "games" DROP CONSTRAINT "games_categories_fkey";
--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_categories_fkey" FOREIGN KEY ("category_slug","type") REFERENCES "public"."categories"("slug","type") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_games_category_slug_type" ON "games" USING btree ("category_slug","type");