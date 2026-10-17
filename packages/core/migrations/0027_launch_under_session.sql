CREATE TYPE "public"."launch_state" AS ENUM('requested', 'running', 'ended', 'failed');--> statement-breakpoint
CREATE TABLE "launch" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"session_id" char(30) NOT NULL,
	"game_id" char(30) NOT NULL,
	"state" "launch_state" DEFAULT 'requested' NOT NULL,
	"first" boolean DEFAULT false NOT NULL,
	"time_started" timestamp with time zone,
	"time_stopped" timestamp with time zone,
	"time_stop_requested" timestamp with time zone,
	"error_message" text,
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "launch" ADD CONSTRAINT "launch_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch" ADD CONSTRAINT "launch_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "launch_session_idx" ON "launch" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "launch_state_idx" ON "launch" USING btree ("state");--> statement-breakpoint
-- Every run that has not stopped gets its first launch, so the rule "the last
-- launch over stops the run" holds for runs that began before launches did.
INSERT INTO "launch" ("id", "session_id", "game_id", "state", "first", "time_started")
SELECT 'lch_' || substr(md5(random()::text || s."id"), 1, 26), s."id", s."game_id",
	(CASE WHEN s."state" = 'live' THEN 'running' ELSE 'requested' END)::"launch_state",
	true, s."time_started"
FROM "session" s
WHERE s."time_stopped" IS NULL AND s."time_deleted" IS NULL;
