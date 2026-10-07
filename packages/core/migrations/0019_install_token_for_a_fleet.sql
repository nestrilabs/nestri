ALTER TABLE "install_token" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "install_token" ADD COLUMN "organisation_id" char(30);--> statement-breakpoint
ALTER TABLE "install_token" ADD CONSTRAINT "install_token_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_token" ADD CONSTRAINT "install_token_one_owner" CHECK (("install_token"."team_id" is null) != ("install_token"."organisation_id" is null));