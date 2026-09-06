-- Where a host actually is, so that a request authorised for it has somewhere
-- to go.
--
-- Until now this table said who owns a host, which team it belongs to and when
-- it was last seen, and nothing at all about how to reach it. A proxy that
-- authenticates a browser on a host's behalf can therefore authorise a request
-- perfectly and then have nowhere to send it.
--
-- **Reported, never assigned.** A host holds the secret half of this identity
-- and is the only thing that can know the public half first, so this column
-- records what a host says about itself on a call it already makes as itself.
-- Nothing here mints one. ref(d-0010)
--
-- Nullable, because "has never reported one" is a real state rather than an
-- error: every host registered before this column existed is in it, and null
-- reads as "not reachable yet". A default would read as an address and route
-- somewhere wrong.
--
-- Unique, because an endpoint id belongs to exactly one host. Two rows claiming
-- the same one would send a request addressed to one machine to another
-- machine's agent, which is the one mistake this column can make that the
-- authorisation in front of it cannot catch. Postgres allows many nulls under a
-- unique index, so the hosts that have never reported are unaffected.

ALTER TABLE "machine" ADD COLUMN "endpoint_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_endpoint_id_unique" ON "machine" USING btree ("endpoint_id");