CREATE TABLE "install_token" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"created_by_user_id" char(30) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"machine_id" char(30)
);
--> statement-breakpoint
ALTER TABLE "install_token" ADD CONSTRAINT "install_token_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_token" ADD CONSTRAINT "install_token_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "install_token" ADD CONSTRAINT "install_token_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "install_token_hash_unique" ON "install_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "install_token_team_idx" ON "install_token" USING btree ("team_id");