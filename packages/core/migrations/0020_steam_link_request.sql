CREATE TABLE "steam_link_request" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "steam_link_request" ADD CONSTRAINT "steam_link_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "steam_link_request_nonce_unique" ON "steam_link_request" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "steam_link_request_user_idx" ON "steam_link_request" USING btree ("user_id");