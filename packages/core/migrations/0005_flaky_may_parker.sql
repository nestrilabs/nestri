CREATE TABLE "access_token" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"owner_user_id" char(30) NOT NULL,
	"team_id" char(30),
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"owner_user_id" char(30) NOT NULL,
	"team_id" char(30),
	"label" text NOT NULL,
	"secret_hash" text NOT NULL,
	"last_seen" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_hash_unique" ON "access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "access_token_owner_idx" ON "access_token" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "access_token_team_idx" ON "access_token" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_secret_hash_unique" ON "machine" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "machine_owner_idx" ON "machine" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "machine_team_idx" ON "machine" USING btree ("team_id");