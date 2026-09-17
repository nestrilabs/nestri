-- The name a host is reached at, so that its id does not have to be.
--
-- Until now the edge matched a Host header against `machine.id`. That worked,
-- and disclosed three things it should not have. Ids here are monotonic, so an
-- id in a hostname tells anyone who reads a URL roughly when that machine was
-- registered and where it falls among its owner's others. An id is the primary
-- key, so a name that has to change -- because it was scraped, shared with the
-- wrong person, or simply disliked -- could only change by re-registering the
-- machine, which is changing its identity to fix its name. And the hostname is
-- also the OAuth audience and the cookie's scope, so the id travelled into
-- redirect URLs, browser history and every access log between the edge and the
-- issuer. ref(d-0019)
--
-- Unique, because a name addresses one machine. This index is also the whole of
-- "the two key spaces must not collide" for as long as machines are the only
-- things carrying a name. When boxes get one, the two must share a single index
-- rather than hold one each, or the guarantee becomes a check somebody has to
-- remember.
--
-- **Three steps, not one.** Generated as `ADD COLUMN "slug" text NOT NULL`,
-- which fails against any table that already has rows, and a default would be
-- worse than the failure: every existing row would take the same name, the
-- unique index would reject them, and a shared value on a routing key is the
-- one thing that must never exist even for an instant. So the column arrives
-- nullable, every row without a name gets one, and only then is it required.
--
-- The backfill is deterministic rather than random, so re-running it produces
-- the same names instead of a second set. These are not minted names and are
-- not meant to be pretty -- they exist so the constraint can be applied. Every
-- row registered after this gets a real one from the control plane.

ALTER TABLE "machine" ADD COLUMN "slug" text;--> statement-breakpoint

UPDATE "machine"
SET "slug" = 'host-' || substr(md5("id"), 1, 6) || '-' ||
             lpad(((('x' || substr(md5("id"), 9, 8))::bit(32)::bigint) % 10000)::text, 4, '0')
WHERE "slug" IS NULL;--> statement-breakpoint

ALTER TABLE "machine" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "machine_slug_unique" ON "machine" USING btree ("slug");
