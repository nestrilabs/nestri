-- A device authorization grant, while it is still in flight.
--
-- Short-lived state that would sit happily in a cache, in a table anyway. The
-- reason is not durability. Each transition here has to happen exactly once
-- while two parties are touching the same row — a browser somebody is clicking
-- through, and a program on another machine polling every few seconds — and a
-- store that can only read and write whole records cannot promise that: the
-- poll reads, the browser approves, the poll writes back what it read, and the
-- approval is gone. Here, approving is one conditional update and redeeming is
-- one delete that returns what it deleted, so neither can undo the other.
--
-- `device_code_hash` and not the code. The device code is the credential the
-- tokens are handed to, so what is kept is enough to recognise it and not
-- enough to present it. `user_code` is stored as written, because it is read
-- off one screen and typed into another by the person looking at both, and it
-- lives for minutes.
--
-- Rows are swept when a new grant is created rather than on a schedule. A grant
-- lives ten minutes and that is the only statement that adds one, so the table
-- stays bounded by how many sign-ins are in flight.

CREATE TYPE "public"."device_grant_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "device_grant" (
	"id" char(30) PRIMARY KEY NOT NULL,
	"time_created" timestamp with time zone DEFAULT now() NOT NULL,
	"time_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"time_deleted" timestamp with time zone,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_id" text NOT NULL,
	"status" "device_grant_status" DEFAULT 'pending' NOT NULL,
	"poll_interval" integer NOT NULL,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"subject" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_grant_device_code_unique" ON "device_grant" USING btree ("device_code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "device_grant_user_code_unique" ON "device_grant" USING btree ("user_code");