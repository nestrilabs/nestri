CREATE TABLE "checkout_room" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"subscription_id" text NOT NULL,
	"requested_model" text NOT NULL,
	"placed_model" text,
	"substituted" boolean DEFAULT false NOT NULL,
	"box_id" char(30)
);
--> statement-breakpoint
ALTER TABLE "checkout_room" ADD CONSTRAINT "checkout_room_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_room" ADD CONSTRAINT "checkout_room_box_id_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."box"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_room_subscription_idx" ON "checkout_room" USING btree ("subscription_id");