-- What a team has spent, and the record it is derived from.
--
-- Two tables because they answer different questions and are written at very
-- different rates. `burn_counter` is one row per team holding a running total
-- per window; `burn_segment` is the append-only record those totals come from.
-- The totals are disposable and can be rebuilt from the record, which is what
-- makes zeroing one a support action rather than data loss.
--
-- **Each total is stored beside the time it began.** A total whose stamp has
-- fallen outside its window reads as zero, so a window rolls clear without
-- anything running -- no schedule to misfire, and no race between a reset and a
-- write arriving together. The same rule on the way in is a single statement:
-- add to the total if the stamp is still inside the window, otherwise start
-- again from this amount.
--
-- Counters live apart from `team` on purpose. This row is written every time
-- anything ticks, while `team` is read on a great many paths with nothing to do
-- with billing, and keeping the hot write off the row everyone reads is worth
-- the join.
--
-- A segment is one stretch of one run at one unchanging rate. Not a row per
-- session, because a session's rate does not survive its own lifetime -- a
-- second run changes what the account spends per second while the first is
-- still going. Not a row per event either, because burn accrues continuously
-- against an envelope that is held rather than per thing consumed. So the rate
-- is stamped at the moment it applied and never edited, and the number shown is
-- the number billed because no later pass could reach a different one.
--
-- `rate_milli` is the per-second rate times a thousand, so fractional factors
-- never make any of this floating point.
--
-- The partial unique index is load-bearing: two open segments for one session
-- would double-count every tick, for as long as both stayed open, silently.
--
-- Sessions and teams are `restrict` on the segment, because deleting a run or a
-- team must not erase what it cost. ref(d-0048)

CREATE TABLE "burn_counter" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"five_hour_usage" bigint DEFAULT 0 NOT NULL,
	"five_hour_at" timestamp with time zone,
	"seven_day_usage" bigint DEFAULT 0 NOT NULL,
	"seven_day_at" timestamp with time zone,
	"thirty_day_usage" bigint DEFAULT 0 NOT NULL,
	"thirty_day_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "burn_segment" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"team_id" char(30) NOT NULL,
	"session_id" char(30) NOT NULL,
	"rate_milli" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "burn_counter" ADD CONSTRAINT "burn_counter_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_segment" ADD CONSTRAINT "burn_segment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_segment" ADD CONSTRAINT "burn_segment_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "burn_counter_team_unique" ON "burn_counter" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "burn_segment_team_idx" ON "burn_segment" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "burn_segment_session_idx" ON "burn_segment" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "burn_segment_one_open_per_session" ON "burn_segment" USING btree ("session_id") WHERE "burn_segment"."ended_at" is null;