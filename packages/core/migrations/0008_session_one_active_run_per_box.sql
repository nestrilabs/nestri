-- A box runs one thing at a time, and now the database is what says so.
--
-- `POST /session` reads `session.activeForBox` and refuses when something is
-- already running, but the read and the insert are two statements. Two requests
-- that both read "nothing is running" before either inserts each get a row, and
-- `/machine/jobs` then hands the host the same box to start twice. A partial
-- unique index on the same predicate the read asks about makes the second
-- insert fail instead. ref(d-0048)
--
-- The index cannot be created while any box already has two unstopped runs, so
-- the duplicates are resolved first. Keeping the newest is the only choice that
-- matches what a person saw: their most recent request is the one they are
-- waiting on. The older rows are stopped rather than deleted, because a session
-- is the billing unit and rows that were once real do not vanish from it.
--
-- `ended` and not `failed`: nothing about these runs failed. They were work
-- nobody picked up, and `failed` carries a reason there is none of.
UPDATE "session" s
SET "state" = 'ended', "time_stopped" = now()
WHERE s."time_stopped" IS NULL
	AND s."time_deleted" IS NULL
	AND EXISTS (
		SELECT 1 FROM "session" newer
		WHERE newer."box_id" = s."box_id"
			AND newer."time_stopped" IS NULL
			AND newer."time_deleted" IS NULL
			AND (newer."time_created", newer."id") > (s."time_created", s."id")
	);--> statement-breakpoint

CREATE UNIQUE INDEX "session_box_active_unique" ON "session" USING btree ("box_id") WHERE time_stopped is null and time_deleted is null;
