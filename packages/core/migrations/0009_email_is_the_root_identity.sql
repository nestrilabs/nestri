-- One address, one account. ref(d-0048)
--
-- Runs against a database in which every user was created by signing in with a
-- gaming account, which means most rows have no email at all and nothing has
-- ever stopped two rows from sharing one. Three consequences, in order:
--
--   1. The column is normalized first. The address is about to become an
--      identity, so `Ada@Example.com ` and `ada@example.com` have to stop
--      being two of them. Trimming and lower-casing happens here once; the
--      code that writes the column does the same thing on the way in.
--   2. Duplicates are separated before the index exists, because
--      `CREATE UNIQUE INDEX` fails outright on the first pair it meets, and a
--      migration that dies half way through is worse than one that decides.
--   3. The index is partial. A null email is not a value, so the accounts that
--      have none do not collide with each other — which is the only reason a
--      unique index can land on these rows at all.

UPDATE "user"
SET "email" = lower(btrim("email"))
WHERE "email" IS NOT NULL
	AND "email" <> lower(btrim("email"));--> statement-breakpoint

-- Where two accounts claim one address, the older keeps it.
--
-- Nothing is deleted: both accounts survive, with their games, their hardware
-- and their team. What the newer one loses is the address, and `email_verified`
-- goes back to false to say so — the next sign-in asks for an address and the
-- person supplies one, which is a prompt rather than a loss.
--
-- The older row wins because its address has been in use longest, so it is the
-- one a receipt or a reset was most likely sent to. `id` breaks a tie on
-- `time_created`, so the choice is total and re-running this changes nothing.
UPDATE "user" u
SET "email" = NULL, "email_verified" = false
WHERE u."email" IS NOT NULL
	AND u."time_deleted" IS NULL
	AND EXISTS (
		SELECT 1 FROM "user" older
		WHERE older."email" = u."email"
			AND older."time_deleted" IS NULL
			AND (older."time_created", older."id") < (u."time_created", u."id")
	);--> statement-breakpoint

CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email") WHERE email is not null and time_deleted is null;--> statement-breakpoint

-- There is no constraint here for the cap on how many gaming accounts one
-- person may connect, and there cannot be one.
--
-- A unique index makes a value unique; it cannot count the rows that share a
-- foreign key, so no index shape says "at most four of these". The cap is
-- enforced in application code, and a direct write to `linked_account` can
-- exceed it. This is written where the schema is read so that nobody looks for
-- the rule here, fails to find it, and concludes there is not one. Rows
-- already over the cap are left alone: the limit governs connecting another,
-- not keeping what is already connected.

-- Below is not part of the above, and carries no reason of its own.
--
-- It records which attempt holds a run: the agent generates an opaque value
-- per claim, the row remembers the first one to arrive, and every later write
-- has to present it. Nullable and unbackfilled, because a run nobody has
-- claimed genuinely has no holder, and never cleared, because a finished run
-- still has to say which attempt ran it. The endpoint that reads and writes it
-- arrives separately; it is here because a schema change has one owner at a
-- time.
ALTER TABLE "session" ADD COLUMN "claim_token" text;
