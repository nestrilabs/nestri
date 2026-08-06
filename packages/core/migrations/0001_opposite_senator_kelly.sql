CREATE TABLE "pairing_code" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"code" text NOT NULL,
	"target_user_id" text NOT NULL,
	"new_fingerprint" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"is_claimed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_fingerprint" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"user_id" char(30) NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text,
	"last_seen" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_fingerprint" ADD CONSTRAINT "user_fingerprint_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_code_code_unique" ON "pairing_code" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pairing_code_target_user_idx" ON "pairing_code" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_fingerprint_fingerprint_unique" ON "user_fingerprint" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "user_fingerprint_user_idx" ON "user_fingerprint" USING btree ("user_id");